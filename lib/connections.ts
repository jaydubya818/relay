import { and, asc, eq, sql } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { db, withTransaction } from "@/lib/db";
import { capabilityGrants, connectionCredentials, connections } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { githubProvider } from "@/lib/connectors/github";

export async function listConnections(accountId: string) {
  return db().select({
    id: connections.id, provider: connections.provider, displayName: connections.displayName,
    status: connections.status, externalAccountId: connections.externalAccountId, scopes: connections.scopes,
    createdAt: connections.createdAt, updatedAt: connections.updatedAt,
    agentsWithAccess: sql<number>`(select count(distinct ${capabilityGrants.agentId}) from ${capabilityGrants} where ${capabilityGrants.accountId} = ${connections.accountId} and ${capabilityGrants.capability} like lower(${connections.provider}) || '.%' and ${capabilityGrants.effect} = 'ALLOW')`.mapWith(Number),
  }).from(connections).where(eq(connections.accountId, accountId)).orderBy(asc(connections.provider));
}

export async function connectGitHub(accountId: string, token: string) {
  const health = await githubProvider.health(token);
  if (!health.ok) throw new RelayError("PROVIDER_ERROR", health.message ?? "GitHub connection failed.", undefined, 400);
  const timestamp = now();
  return withTransaction(async (transaction) => {
    const [existing] = await transaction.select({ id: connections.id }).from(connections).where(and(eq(connections.accountId, accountId), eq(connections.provider, "GITHUB"))).limit(1);
    const connectionId = existing?.id ?? id("conn");
    await transaction.insert(connections).values({ id: connectionId, accountId, provider: "GITHUB", displayName: health.displayName ?? "GitHub", status: "CONNECTED", externalAccountId: health.externalAccountId, scopes: [], createdAt: timestamp, updatedAt: timestamp }).onConflictDoUpdate({ target: [connections.accountId, connections.provider], set: { displayName: health.displayName ?? "GitHub", status: "CONNECTED", externalAccountId: health.externalAccountId, updatedAt: timestamp } });
    await transaction.insert(connectionCredentials).values({ connectionId, encryptedAccessToken: encryptSecret(token), updatedAt: timestamp }).onConflictDoUpdate({ target: connectionCredentials.connectionId, set: { encryptedAccessToken: encryptSecret(token), updatedAt: timestamp } });
    return { id: connectionId, ...health };
  });
}

export async function disconnectGitHub(accountId: string) {
  const [connection] = await db().select({ id: connections.id }).from(connections).where(and(eq(connections.accountId, accountId), eq(connections.provider, "GITHUB"))).limit(1);
  if (!connection) return new RelayError("CONNECTION_REQUIRED", "GitHub is not connected.", undefined, 404);
  return withTransaction(async (transaction) => {
    await transaction.delete(connectionCredentials).where(eq(connectionCredentials.connectionId, connection.id));
    await transaction.update(connections).set({ status: "DISCONNECTED", updatedAt: now() }).where(and(eq(connections.id, connection.id), eq(connections.accountId, accountId)));
  });
}

export async function githubSecret(accountId: string) {
  const [row] = await db().select({ encryptedSecret: connectionCredentials.encryptedAccessToken }).from(connections).innerJoin(connectionCredentials, eq(connectionCredentials.connectionId, connections.id)).where(and(eq(connections.accountId, accountId), eq(connections.provider, "GITHUB"), eq(connections.status, "CONNECTED"))).limit(1);
  if (!row) throw new RelayError("CONNECTION_REQUIRED", "Connect GitHub in Relay before using this capability.", "github.repo.read", 409);
  return decryptSecret(row.encryptedSecret);
}

export async function testGitHub(accountId: string) {
  return githubProvider.health(await githubSecret(accountId));
}
