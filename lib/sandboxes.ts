import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents, sandboxGrants, sandboxes } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { sandboxProvider } from "@/lib/providers";
import type { SandboxResourcePolicy } from "@/lib/providers/sandbox";
import type { AgentPrincipal } from "@/lib/types";

const DEFAULT_POLICY: SandboxResourcePolicy = {
  ttlSeconds: 30 * 60,
  timeoutMs: 30_000,
  cpuLimit: 1,
  memoryMb: 512,
  maxOutputBytes: 256 * 1024,
  network: "NONE",
};

export function sandboxPolicy(input: Partial<SandboxResourcePolicy> = {}): SandboxResourcePolicy {
  const policy = { ...DEFAULT_POLICY, ...input };
  if (policy.ttlSeconds < 60 || policy.ttlSeconds > 86_400) throw new RelayError("INVALID_INPUT", "Sandbox TTL must be between 60 seconds and 24 hours.");
  if (policy.timeoutMs < 100 || policy.timeoutMs > 120_000) throw new RelayError("INVALID_INPUT", "Sandbox timeout must be between 100 ms and 120 seconds.");
  if (policy.cpuLimit <= 0 || policy.cpuLimit > 4 || policy.memoryMb < 64 || policy.memoryMb > 4096) throw new RelayError("INVALID_INPUT", "Sandbox resource limits are outside Relay policy.");
  if (policy.maxOutputBytes < 1024 || policy.maxOutputBytes > 1024 * 1024) throw new RelayError("INVALID_INPUT", "Sandbox output limit is outside Relay policy.");
  if (policy.network === "RESTRICTED") throw new RelayError("INVALID_INPUT", "Restricted network allowlists are not yet configured. Use NONE or OPEN explicitly.");
  return policy;
}

function publicSandbox(row: typeof sandboxes.$inferSelect) {
  return { id: row.id, ownerAgentId: row.ownerAgentId, status: row.status, createdAt: row.createdAt, expiresAt: row.expiresAt, lastUsedAt: row.lastUsedAt, resourcePolicy: row.resourcePolicy };
}

async function accessibleSandbox(principal: AgentPrincipal, sandboxId: string) {
  const [resource] = await db().select().from(sandboxes).where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.accountId, principal.accountId))).limit(1);
  if (!resource) throw new RelayError("INVALID_INPUT", "Sandbox not found.", undefined, 404);
  if (resource.ownerAgentId !== principal.agentId) {
    const [grant] = await db().select({ sandboxId: sandboxGrants.sandboxId }).from(sandboxGrants).where(and(eq(sandboxGrants.sandboxId, sandboxId), eq(sandboxGrants.accountId, principal.accountId), eq(sandboxGrants.agentId, principal.agentId))).limit(1);
    if (!grant) throw new RelayError("CAPABILITY_DENIED", "This Agent is not permitted to access the sandbox.", undefined, 403);
  }
  if (new Date(resource.expiresAt).getTime() <= Date.now() || resource.status === "EXPIRED" || resource.status === "DESTROYED") {
    if (resource.providerResourceId && resource.status !== "DESTROYED") await sandboxProvider().destroy({ resourceId: resource.providerResourceId }).catch(() => undefined);
    await db().update(sandboxes).set({ status: "EXPIRED", lastUsedAt: now() }).where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.accountId, principal.accountId)));
    throw new RelayError("INVALID_INPUT", "Sandbox has expired.", undefined, 410);
  }
  if (!resource.providerResourceId) throw new RelayError("PROVIDER_ERROR", "Sandbox provider resource is unavailable.", undefined, 502);
  return resource;
}

export async function createSandbox(principal: AgentPrincipal, sessionId: string, input: Partial<SandboxResourcePolicy> = {}) {
  const policy = sandboxPolicy(input);
  const provider = sandboxProvider();
  const created = await provider.create(policy);
  const timestamp = now();
  const sandboxId = id("sbx");
  try {
    const [row] = await db().insert(sandboxes).values({ id: sandboxId, accountId: principal.accountId, ownerAgentId: principal.agentId, createdBySession: sessionId, status: "RUNNING", provider: provider.id, providerResourceId: created.resourceId, createdAt: timestamp, expiresAt: new Date(Date.now() + policy.ttlSeconds * 1000).toISOString(), lastUsedAt: timestamp, resourcePolicy: policy }).returning();
    return publicSandbox(row);
  } catch (error) {
    await provider.destroy(created).catch(() => undefined);
    throw error;
  }
}

export async function execSandbox(principal: AgentPrincipal, sandboxId: string, command: string) {
  if (!command.trim() || command.length > 10_000) throw new RelayError("INVALID_INPUT", "A bounded sandbox command is required.");
  const resource = await accessibleSandbox(principal, sandboxId);
  const policy = sandboxPolicy(resource.resourcePolicy as Partial<SandboxResourcePolicy>);
  const result = await sandboxProvider().exec({ resourceId: resource.providerResourceId! }, command, policy);
  await db().update(sandboxes).set({ lastUsedAt: now() }).where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.accountId, principal.accountId)));
  return result;
}

export async function readSandboxFile(principal: AgentPrincipal, sandboxId: string, path: string) {
  const resource = await accessibleSandbox(principal, sandboxId);
  const maxBytes = 1024 * 1024;
  const content = await sandboxProvider().readFile({ resourceId: resource.providerResourceId! }, path, maxBytes);
  await db().update(sandboxes).set({ lastUsedAt: now() }).where(eq(sandboxes.id, sandboxId));
  return { path, content: Buffer.from(content).toString("utf8") };
}

export async function writeSandboxFile(principal: AgentPrincipal, sandboxId: string, path: string, content: string) {
  const bytes = Buffer.from(content, "utf8");
  if (bytes.byteLength > 1024 * 1024) throw new RelayError("INVALID_INPUT", "Sandbox file exceeds the write limit.", undefined, 413);
  const resource = await accessibleSandbox(principal, sandboxId);
  await sandboxProvider().writeFile({ resourceId: resource.providerResourceId! }, path, bytes);
  await db().update(sandboxes).set({ lastUsedAt: now() }).where(eq(sandboxes.id, sandboxId));
  return { path, bytes: bytes.byteLength };
}

export async function listSandboxFiles(principal: AgentPrincipal, sandboxId: string, path = "") {
  const resource = await accessibleSandbox(principal, sandboxId);
  const files = await sandboxProvider().listFiles({ resourceId: resource.providerResourceId! }, path);
  await db().update(sandboxes).set({ lastUsedAt: now() }).where(eq(sandboxes.id, sandboxId));
  return files;
}

export async function destroySandbox(principal: AgentPrincipal, sandboxId: string) {
  const resource = await accessibleSandbox(principal, sandboxId);
  await sandboxProvider().destroy({ resourceId: resource.providerResourceId! });
  await db().update(sandboxes).set({ status: "DESTROYED", providerResourceId: null, lastUsedAt: now() }).where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.accountId, principal.accountId)));
  return { id: sandboxId, status: "DESTROYED" as const };
}

export async function shareSandbox(accountId: string, sandboxId: string, agentId: string) {
  const [[resource], [agent]] = await Promise.all([
    db().select({ id: sandboxes.id }).from(sandboxes).where(and(eq(sandboxes.id, sandboxId), eq(sandboxes.accountId, accountId), eq(sandboxes.status, "RUNNING"))).limit(1),
    db().select({ id: agents.id }).from(agents).where(and(eq(agents.id, agentId), eq(agents.accountId, accountId), eq(agents.status, "ACTIVE"))).limit(1),
  ]);
  if (!resource || !agent) throw new RelayError("INVALID_INPUT", "Sandbox or Agent not found.", undefined, 404);
  await db().insert(sandboxGrants).values({ sandboxId, accountId, agentId, createdAt: now() }).onConflictDoNothing();
}

export async function listSandboxes(accountId: string) {
  return db().select({ id: sandboxes.id, ownerAgentId: sandboxes.ownerAgentId, ownerAgentName: agents.name, status: sandboxes.status, provider: sandboxes.provider, createdAt: sandboxes.createdAt, expiresAt: sandboxes.expiresAt, lastUsedAt: sandboxes.lastUsedAt, resourcePolicy: sandboxes.resourcePolicy }).from(sandboxes).innerJoin(agents, and(eq(agents.id, sandboxes.ownerAgentId), eq(agents.accountId, sandboxes.accountId))).where(eq(sandboxes.accountId, accountId)).orderBy(asc(sandboxes.createdAt));
}

export async function cleanupExpiredSandboxes() {
  const expired = await db().select().from(sandboxes).where(and(inArray(sandboxes.status, ["CREATING", "RUNNING", "STOPPED"]), lte(sandboxes.expiresAt, now())));
  for (const resource of expired) {
    if (resource.providerResourceId) await sandboxProvider().destroy({ resourceId: resource.providerResourceId }).catch(() => undefined);
    await db().update(sandboxes).set({ status: "EXPIRED", providerResourceId: null, lastUsedAt: now() }).where(eq(sandboxes.id, resource.id));
  }
  return expired.length;
}
