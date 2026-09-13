import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents, browserSessionGrants, browserSessions } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { browserProvider } from "@/lib/providers";
import type { BrowserResourcePolicy } from "@/lib/providers/browser";
import type { AgentPrincipal } from "@/lib/types";

const DEFAULT_POLICY: BrowserResourcePolicy = { ttlSeconds: 30 * 60, operationTimeoutMs: 15_000, maxExtractChars: 100_000, network: "PUBLIC_ONLY" };

function browserPolicy(input: Partial<BrowserResourcePolicy> = {}): BrowserResourcePolicy {
  const policy = { ...DEFAULT_POLICY, ...input };
  if (policy.ttlSeconds < 60 || policy.ttlSeconds > 86_400) throw new RelayError("INVALID_INPUT", "Browser TTL must be between 60 seconds and 24 hours.");
  if (policy.operationTimeoutMs < 500 || policy.operationTimeoutMs > 60_000) throw new RelayError("INVALID_INPUT", "Browser operation timeout is outside Relay policy.");
  if (policy.maxExtractChars < 1_000 || policy.maxExtractChars > 500_000) throw new RelayError("INVALID_INPUT", "Browser extraction limit is outside Relay policy.");
  return policy;
}

function navigationUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RelayError("INVALID_INPUT", "Browser navigation requires a valid URL.", "browser.navigate");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RelayError("INVALID_INPUT", "Browser navigation supports HTTP and HTTPS only.", "browser.navigate");
  }
  return url.toString();
}

function publicSession(row: typeof browserSessions.$inferSelect) {
  return { id: row.id, ownerAgentId: row.ownerAgentId, status: row.status, currentUrl: row.currentUrl, createdAt: row.createdAt, expiresAt: row.expiresAt, lastUsedAt: row.lastUsedAt };
}

async function accessibleSession(principal: AgentPrincipal, browserSessionId: string) {
  const [session] = await db().select().from(browserSessions).where(and(eq(browserSessions.id, browserSessionId), eq(browserSessions.accountId, principal.accountId))).limit(1);
  if (!session) throw new RelayError("INVALID_INPUT", "Browser session not found.", undefined, 404);
  if (session.ownerAgentId !== principal.agentId) {
    const [grant] = await db().select({ id: browserSessionGrants.browserSessionId }).from(browserSessionGrants).where(and(eq(browserSessionGrants.browserSessionId, browserSessionId), eq(browserSessionGrants.accountId, principal.accountId), eq(browserSessionGrants.agentId, principal.agentId))).limit(1);
    if (!grant) throw new RelayError("CAPABILITY_DENIED", "This Agent is not permitted to access the browser session.", undefined, 403);
  }
  if (new Date(session.expiresAt).getTime() <= Date.now() || session.status === "EXPIRED" || session.status === "DESTROYED") {
    if (session.providerSessionId && session.status !== "DESTROYED") await browserProvider().close({ resourceId: session.providerSessionId }).catch(() => undefined);
    await db().update(browserSessions).set({ status: "EXPIRED", providerSessionId: null, lastUsedAt: now() }).where(and(eq(browserSessions.id, browserSessionId), eq(browserSessions.accountId, principal.accountId)));
    throw new RelayError("INVALID_INPUT", "Browser session has expired.", undefined, 410);
  }
  if (!session.providerSessionId) throw new RelayError("PROVIDER_ERROR", "Browser provider session is unavailable.", undefined, 502);
  return session;
}

export async function createBrowserSession(principal: AgentPrincipal, input: Partial<BrowserResourcePolicy> = {}) {
  const policy = browserPolicy(input);
  const provider = browserProvider();
  const created = await provider.create(policy);
  const timestamp = now();
  try {
    const [session] = await db().insert(browserSessions).values({ id: id("brw"), accountId: principal.accountId, ownerAgentId: principal.agentId, provider: provider.id, providerSessionId: created.resourceId, status: "RUNNING", createdAt: timestamp, expiresAt: new Date(Date.now() + policy.ttlSeconds * 1000).toISOString(), lastUsedAt: timestamp, resourcePolicy: policy }).returning();
    return publicSession(session);
  } catch (error) {
    await provider.close(created).catch(() => undefined);
    throw error;
  }
}

async function touch(browserSessionId: string, accountId: string, currentUrl?: string) {
  await db().update(browserSessions).set({ lastUsedAt: now(), ...(currentUrl ? { currentUrl } : {}) }).where(and(eq(browserSessions.id, browserSessionId), eq(browserSessions.accountId, accountId)));
}

export async function navigateBrowser(principal: AgentPrincipal, browserSessionId: string, url: string) {
  const session = await accessibleSession(principal, browserSessionId);
  const policy = browserPolicy(session.resourcePolicy as Partial<BrowserResourcePolicy>);
  const result = await browserProvider().navigate({ resourceId: session.providerSessionId! }, navigationUrl(url), policy);
  await touch(browserSessionId, principal.accountId, result.url);
  return result;
}

export async function clickBrowser(principal: AgentPrincipal, browserSessionId: string, selector: string) {
  const session = await accessibleSession(principal, browserSessionId);
  await browserProvider().click({ resourceId: session.providerSessionId! }, selector, browserPolicy(session.resourcePolicy as Partial<BrowserResourcePolicy>));
  await touch(browserSessionId, principal.accountId);
  return { ok: true };
}

export async function typeBrowser(principal: AgentPrincipal, browserSessionId: string, selector: string, text: string) {
  const session = await accessibleSession(principal, browserSessionId);
  await browserProvider().type({ resourceId: session.providerSessionId! }, selector, text, browserPolicy(session.resourcePolicy as Partial<BrowserResourcePolicy>));
  await touch(browserSessionId, principal.accountId);
  return { ok: true };
}

export async function extractBrowser(principal: AgentPrincipal, browserSessionId: string, selector?: string) {
  const session = await accessibleSession(principal, browserSessionId);
  const result = await browserProvider().extract({ resourceId: session.providerSessionId! }, selector, browserPolicy(session.resourcePolicy as Partial<BrowserResourcePolicy>));
  await touch(browserSessionId, principal.accountId, result.url);
  return result;
}

export async function screenshotBrowser(principal: AgentPrincipal, browserSessionId: string) {
  const session = await accessibleSession(principal, browserSessionId);
  const content = await browserProvider().screenshot({ resourceId: session.providerSessionId! }, browserPolicy(session.resourcePolicy as Partial<BrowserResourcePolicy>));
  await touch(browserSessionId, principal.accountId);
  return { mediaType: "image/png", contentBase64: Buffer.from(content).toString("base64"), bytes: content.byteLength };
}

export async function closeBrowserSession(principal: AgentPrincipal, browserSessionId: string) {
  const session = await accessibleSession(principal, browserSessionId);
  await browserProvider().close({ resourceId: session.providerSessionId! });
  await db().update(browserSessions).set({ status: "DESTROYED", providerSessionId: null, lastUsedAt: now() }).where(and(eq(browserSessions.id, browserSessionId), eq(browserSessions.accountId, principal.accountId)));
  return { id: browserSessionId, status: "DESTROYED" as const };
}

export async function shareBrowserSession(accountId: string, browserSessionId: string, agentId: string) {
  const [[session], [agent]] = await Promise.all([
    db().select({ id: browserSessions.id }).from(browserSessions).where(and(eq(browserSessions.id, browserSessionId), eq(browserSessions.accountId, accountId), eq(browserSessions.status, "RUNNING"))).limit(1),
    db().select({ id: agents.id }).from(agents).where(and(eq(agents.id, agentId), eq(agents.accountId, accountId), eq(agents.status, "ACTIVE"))).limit(1),
  ]);
  if (!session || !agent) throw new RelayError("INVALID_INPUT", "Browser session or Agent not found.", undefined, 404);
  await db().insert(browserSessionGrants).values({ browserSessionId, accountId, agentId, createdAt: now() }).onConflictDoNothing();
}

export async function listBrowserSessions(accountId: string) {
  return db().select({ id: browserSessions.id, ownerAgentId: browserSessions.ownerAgentId, ownerAgentName: agents.name, status: browserSessions.status, currentUrl: browserSessions.currentUrl, createdAt: browserSessions.createdAt, expiresAt: browserSessions.expiresAt, lastUsedAt: browserSessions.lastUsedAt }).from(browserSessions).innerJoin(agents, and(eq(agents.id, browserSessions.ownerAgentId), eq(agents.accountId, browserSessions.accountId))).where(eq(browserSessions.accountId, accountId)).orderBy(asc(browserSessions.createdAt));
}

export async function cleanupExpiredBrowserSessions() {
  const expired = await db().select().from(browserSessions).where(and(inArray(browserSessions.status, ["CREATING", "RUNNING", "STOPPED"]), lte(browserSessions.expiresAt, now())));
  for (const session of expired) {
    if (session.providerSessionId) await browserProvider().close({ resourceId: session.providerSessionId }).catch(() => undefined);
    await db().update(browserSessions).set({ status: "EXPIRED", providerSessionId: null, lastUsedAt: now() }).where(eq(browserSessions.id, session.id));
  }
  return expired.length;
}
