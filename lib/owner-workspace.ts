// Account-scoped presentation reads. Mutations and authorization stay in existing services.
import { and, count, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { activities, agents, agentCredentials, capabilityGrants, connectionCredentials, connections, approvalRequests, v2Tasks } from "@/lib/db/schema";
import { listAgents } from "@/lib/agents";
import { listConnections } from "@/lib/connections";
import { operatorContext } from "@/lib/v2/dashboard";
import { RelayError } from "@/lib/errors";
import type { SessionUser } from "@/lib/types";

export function capabilityProvider(capability: string) {
  if (capability.startsWith("github.")) return "GITHUB";
  if (/^(email|calendar)\./.test(capability)) return "GOOGLE";
  if (capability.startsWith("factory.")) return "MYFACTORY";
  return "RELAY";
}

export async function ownerDirectory(accountId: string) {
  const [rows, grants, credentials, recent] = await Promise.all([
    listAgents(accountId),
    db().select({ agentId: capabilityGrants.agentId, capability: capabilityGrants.capability, effect: capabilityGrants.effect }).from(capabilityGrants).where(eq(capabilityGrants.accountId, accountId)),
    db().select({ agentId: agentCredentials.agentId, expiresAt: agentCredentials.expiresAt, revokedAt: agentCredentials.revokedAt }).from(agentCredentials).where(eq(agentCredentials.accountId, accountId)),
    db().selectDistinctOn([activities.agentId], { agentId: activities.agentId, action: activities.action, status: activities.status, createdAt: activities.createdAt }).from(activities).where(eq(activities.accountId, accountId)).orderBy(activities.agentId, desc(activities.createdAt), desc(activities.id)),
  ]);
  const now = Date.now();
  return rows.map((agent) => {
    const allowed = grants.filter((grant) => grant.agentId === agent.id && grant.effect === "ALLOW").map((grant) => grant.capability);
    const own = credentials.filter((credential) => credential.agentId === agent.id && !credential.revokedAt);
    const valid = own.filter((credential) => !credential.expiresAt || Date.parse(credential.expiresAt) > now);
    return { ...agent, allowed, services: [...new Set(allowed.map(capabilityProvider).filter((provider) => provider !== "RELAY"))],
      credentialState: valid.length ? "ACTIVE" : own.length ? "EXPIRED" : "NOT_CONFIGURED",
      expiring: valid.some((credential) => credential.expiresAt && Date.parse(credential.expiresAt) < now + 7 * 86400000),
      recent: recent.find((item) => item.agentId === agent.id) ?? null };
  });
}

export async function ownerConnections(accountId: string) {
  const [rows, auth, successes] = await Promise.all([
    listConnections(accountId),
    db().select({ id: connections.id, present: connectionCredentials.connectionId, expiresAt: connectionCredentials.tokenExpiresAt, refreshable: sql<boolean>`${connectionCredentials.encryptedRefreshToken} is not null` }).from(connections)
      .leftJoin(connectionCredentials, eq(connectionCredentials.connectionId, connections.id)).where(eq(connections.accountId, accountId)),
    db().select({ provider: sql<string>`upper(${activities.provider})`, createdAt: sql<string>`max(${activities.createdAt})` }).from(activities)
      .where(and(eq(activities.accountId, accountId), eq(activities.status, "SUCCESS"))).groupBy(sql`upper(${activities.provider})`),
  ]);
  return rows.map((row) => {
    const credential = auth.find((item) => item.id === row.id);
    const state = row.status === "CONNECTED" && !credential?.present ? "REQUIRES_SETUP"
      : row.status === "CONNECTED" && credential?.expiresAt && Date.parse(credential.expiresAt) <= Date.now() && !credential.refreshable ? "AUTHENTICATION_EXPIRED" : row.status;
    return { ...row, state, authentication: !credential?.present ? "No credential stored" : state === "AUTHENTICATION_EXPIRED" ? "Credential expired; reconnection required" : credential.refreshable ? "Refreshable session; validity checked on use" : "Credential stored; validity checked on use",
      lastSuccess: successes.find((item) => item.provider?.toUpperCase() === row.provider.toUpperCase())?.createdAt ?? null };
  });
}

export async function ownerOperations(user: SessionUser, asOf = new Date().toISOString()) {
  try { await operatorContext(user.accountId, user.id); }
  catch (error) {
    if (error instanceof RelayError && error.status === 403) return null;
    throw error; // An unavailable database must never look like an empty account.
  }
  const [[running], [pending]] = await Promise.all([
    db().select({ value: count() }).from(v2Tasks).where(and(eq(v2Tasks.accountId, user.accountId), eq(v2Tasks.status, "RUNNING"))),
    db().select({ value: count() }).from(approvalRequests).where(and(eq(approvalRequests.accountId, user.accountId), eq(approvalRequests.status, "PENDING"), gte(approvalRequests.expiresAt, asOf))),
  ]);
  return { running: running.value, pending: pending.value };
}

export type ActivityFilters = Record<string, string | undefined>;
export async function ownerRecentCounts(accountId: string, since: string) {
  const rows = await db().select({ status: activities.status, value: count() }).from(activities)
    .where(and(eq(activities.accountId, accountId), gte(activities.createdAt, since))).groupBy(activities.status);
  return { failures: rows.find((row) => row.status === "FAILED")?.value ?? 0, denials: rows.find((row) => row.status === "DENIED")?.value ?? 0 };
}
export function validSince(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value ? value : undefined;
}
export function validDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : undefined;
}
export async function ownerActivity(accountId: string, filters: ActivityFilters = {}) {
  const conditions: SQL[] = [eq(activities.accountId, accountId)];
  if (filters.agent) conditions.push(eq(activities.agentId, filters.agent));
  if (filters.capability) conditions.push(eq(activities.capability, filters.capability));
  if (filters.provider) conditions.push(sql`upper(${activities.provider}) = ${filters.provider.toUpperCase()}`);
  const status = filters.status;
  if (status === "SUCCESS" || status === "DENIED" || status === "FAILED" || status === "BLOCKED") conditions.push(eq(activities.status, status));
  const from = validDate(filters.from), to = validDate(filters.to);
  const since = !from && !to ? validSince(filters.since) : undefined;
  if (since) conditions.push(gte(activities.createdAt, since));
  if (from) conditions.push(gte(activities.createdAt, `${from}T00:00:00.000Z`));
  if (to) conditions.push(lt(activities.createdAt, new Date(Date.parse(to) + 86400000).toISOString()));
  if (filters.q?.trim()) {
    const term = `%${filters.q.trim().slice(0, 160).replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(or(ilike(agents.name, term), ilike(activities.action, term), ilike(activities.capability, term), ilike(activities.resourceId, term))!);
  }
  const where = and(...conditions);
  const [total] = await db().select({ value: count() }).from(activities).leftJoin(agents, and(eq(agents.id, activities.agentId), eq(agents.accountId, accountId))).where(where);
  const pages = Math.max(1, Math.ceil(total.value / 20));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(filters.page) || 1)));
  const rows = await db().select({ id: activities.id, agentId: activities.agentId, agentName: agents.name, sessionId: activities.sessionId,
    capability: activities.capability, provider: activities.provider, resourceType: activities.resourceType, resourceId: activities.resourceId,
    action: activities.action, status: activities.status, durationMs: activities.durationMs, createdAt: activities.createdAt, metadata: activities.metadata,
  }).from(activities).leftJoin(agents, and(eq(agents.id, activities.agentId), eq(agents.accountId, accountId))).where(where)
    .orderBy(desc(activities.createdAt), desc(activities.id)).limit(20).offset((page - 1) * 20);
  return { rows, total: total.value, page, pages };
}

// Filter before applying the existing 100-row presentation bound. Never use the
// latest unfiltered rows to represent the Home metric's matching records.
export async function ownerRunningTasks(user: SessionUser) {
  await operatorContext(user.accountId, user.id);
  return db().select({ id: v2Tasks.id, agentId: v2Tasks.agentId, status: v2Tasks.status, attemptCount: v2Tasks.attemptCount, maxAttempts: v2Tasks.maxAttempts, updatedAt: v2Tasks.updatedAt })
    .from(v2Tasks).where(and(eq(v2Tasks.accountId, user.accountId), eq(v2Tasks.status, "RUNNING"))).orderBy(desc(v2Tasks.createdAt)).limit(100);
}
export async function ownerPendingApprovals(user: SessionUser, asOf: string) {
  await operatorContext(user.accountId, user.id);
  const cutoff = validSince(asOf) ?? new Date().toISOString();
  return db().select({ id: approvalRequests.id, actionIntentId: approvalRequests.actionIntentId, agentId: approvalRequests.agentId, taskId: approvalRequests.taskId, riskClass: approvalRequests.riskClass, effectClass: approvalRequests.effectClass, summary: approvalRequests.summary, consequence: approvalRequests.consequence, displayEvidence: approvalRequests.displayEvidence, allowedScopes: approvalRequests.allowedScopes, status: approvalRequests.status, expiresAt: approvalRequests.expiresAt })
    .from(approvalRequests).where(and(eq(approvalRequests.accountId, user.accountId), eq(approvalRequests.status, "PENDING"), gte(approvalRequests.expiresAt, cutoff))).orderBy(desc(approvalRequests.createdAt)).limit(100);
}
