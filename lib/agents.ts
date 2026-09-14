import { and, asc, desc, eq, isNull, max, sql } from "drizzle-orm";
import { createAgentSecret, hashSecret } from "@/lib/crypto";
import { db, withTransaction } from "@/lib/db";
import { agentCredentials, agents, capabilityGrants } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { CAPABILITIES, type CapabilityName } from "@/lib/types";

export async function listAgents(accountId: string) {
  return db()
    .select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      status: agents.status,
      createdAt: agents.createdAt,
      updatedAt: agents.updatedAt,
      lastActiveAt: max(agentCredentials.lastUsedAt),
      activeCredentials: sql<number>`count(${agentCredentials.id}) filter (where ${isNull(agentCredentials.revokedAt)})`.mapWith(Number),
    })
    .from(agents)
    .leftJoin(agentCredentials, eq(agentCredentials.agentId, agents.id))
    .where(eq(agents.accountId, accountId))
    .groupBy(agents.id)
    .orderBy(asc(agents.createdAt));
}

export async function getAgent(accountId: string, agentId: string) {
  const [agent] = await db()
    .select({ id: agents.id, name: agents.name, description: agents.description, status: agents.status, createdAt: agents.createdAt, updatedAt: agents.updatedAt })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.accountId, accountId)))
    .limit(1);
  if (!agent) throw new RelayError("INVALID_INPUT", "Agent not found.", undefined, 404);
  const [grants, credentials] = await Promise.all([
    db().select({ capability: capabilityGrants.capability, effect: capabilityGrants.effect }).from(capabilityGrants).where(and(eq(capabilityGrants.accountId, accountId), eq(capabilityGrants.agentId, agentId))).orderBy(asc(capabilityGrants.capability)),
    db().select({ id: agentCredentials.id, name: agentCredentials.name, prefix: agentCredentials.prefix, createdAt: agentCredentials.createdAt, expiresAt: agentCredentials.expiresAt, revokedAt: agentCredentials.revokedAt, lastUsedAt: agentCredentials.lastUsedAt }).from(agentCredentials).where(and(eq(agentCredentials.accountId, accountId), eq(agentCredentials.agentId, agentId))).orderBy(desc(agentCredentials.createdAt)),
  ]);
  return { ...agent, grants, credentials };
}

export async function createAgent(accountId: string, input: { name: string; description?: string; capabilities?: CapabilityName[] }) {
  const timestamp = now();
  const agentId = id("agt");
  return withTransaction(async (transaction) => {
    await transaction.insert(agents).values({ id: agentId, accountId, name: input.name.trim(), description: input.description?.trim() ?? "", status: "ACTIVE", createdAt: timestamp, updatedAt: timestamp });
    for (const capability of input.capabilities ?? ["memory.read", "memory.write"]) {
      await transaction.insert(capabilityGrants).values({ id: id("grant"), accountId, agentId, capability, effect: "ALLOW", createdAt: timestamp });
    }
    const credential = createCredentialRecord(accountId, agentId, "Primary", timestamp);
    await transaction.insert(agentCredentials).values(credential.record);
    return { agentId, credential: credential.secret };
  });
}

function createCredentialRecord(accountId: string, agentId: string, name: string, timestamp = now()) {
  const secret = createAgentSecret();
  return {
    secret,
    record: { id: id("cred"), accountId, agentId, name, secretHash: hashSecret(secret), prefix: secret.slice(0, 12), createdAt: timestamp },
  };
}

export async function issueCredential(accountId: string, agentId: string, name: string) {
  await getAgent(accountId, agentId);
  const credential = createCredentialRecord(accountId, agentId, name);
  await db().insert(agentCredentials).values(credential.record);
  return { id: credential.record.id, secret: credential.secret, prefix: credential.record.prefix };
}

export async function rotateCredential(accountId: string, agentId: string) {
  return withTransaction(async (transaction) => {
    const [agent] = await transaction.select({ id: agents.id }).from(agents).where(and(eq(agents.id, agentId), eq(agents.accountId, accountId))).limit(1);
    if (!agent) throw new RelayError("INVALID_INPUT", "Agent not found.", undefined, 404);
    const timestamp = now();
    await transaction.update(agentCredentials).set({ revokedAt: timestamp }).where(and(eq(agentCredentials.accountId, accountId), eq(agentCredentials.agentId, agentId), isNull(agentCredentials.revokedAt)));
    const credential = createCredentialRecord(accountId, agentId, "Rotated credential", timestamp);
    await transaction.insert(agentCredentials).values(credential.record);
    return { id: credential.record.id, secret: credential.secret, prefix: credential.record.prefix };
  });
}

export async function revokeCredential(accountId: string, agentId: string, credentialId?: string) {
  const conditions = [eq(agentCredentials.accountId, accountId), eq(agentCredentials.agentId, agentId), isNull(agentCredentials.revokedAt)];
  if (credentialId) conditions.push(eq(agentCredentials.id, credentialId));
  const revoked = await db().update(agentCredentials).set({ revokedAt: now() }).where(and(...conditions)).returning({ id: agentCredentials.id });
  return revoked.length > 0;
}

export async function updateAgentStatus(accountId: string, agentId: string, status: "ACTIVE" | "DISABLED") {
  const updated = await db().update(agents).set({ status, updatedAt: now() }).where(and(eq(agents.id, agentId), eq(agents.accountId, accountId))).returning({ id: agents.id });
  if (!updated.length) throw new RelayError("INVALID_INPUT", "Agent not found.", undefined, 404);
}

export async function setCapabilityGrant(accountId: string, agentId: string, capability: CapabilityName, effect: "ALLOW" | "DENY") {
  if (!CAPABILITIES.includes(capability)) throw new RelayError("INVALID_INPUT", "Unknown capability.");
  const [agent] = await db().select({ id: agents.id }).from(agents).where(and(eq(agents.id, agentId), eq(agents.accountId, accountId))).limit(1);
  if (!agent) throw new RelayError("INVALID_INPUT", "Agent not found.", undefined, 404);
  await db().insert(capabilityGrants).values({ id: id("grant"), accountId, agentId, capability, effect, createdAt: now() }).onConflictDoUpdate({ target: [capabilityGrants.agentId, capabilityGrants.capability], set: { effect } });
}
