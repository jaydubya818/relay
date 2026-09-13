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

export async function connectGitHub(accountId: string, token: string, options: { refreshToken?: string; expiresAt?: string; scopes?: string[] } = {}) {
  const health = await githubProvider.health(token);
  if (!health.ok) throw new RelayError("PROVIDER_ERROR", health.message ?? "GitHub connection failed.", undefined, 400);
  const timestamp = now();
  return withTransaction(async (transaction) => {
    const [existing] = await transaction.select({ id: connections.id }).from(connections).where(and(eq(connections.accountId, accountId), eq(connections.provider, "GITHUB"))).limit(1);
    const connectionId = existing?.id ?? id("conn");
    const scopes = options.scopes ?? [];
    const encryptedAccessToken = encryptSecret(token);
    const encryptedRefreshToken = options.refreshToken ? encryptSecret(options.refreshToken) : undefined;
    await transaction.insert(connections).values({ id: connectionId, accountId, provider: "GITHUB", displayName: health.displayName ?? "GitHub", status: "CONNECTED", externalAccountId: health.externalAccountId, scopes, createdAt: timestamp, updatedAt: timestamp }).onConflictDoUpdate({ target: [connections.accountId, connections.provider], set: { displayName: health.displayName ?? "GitHub", status: "CONNECTED", externalAccountId: health.externalAccountId, scopes, updatedAt: timestamp } });
    await transaction.insert(connectionCredentials).values({ connectionId, encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt: options.expiresAt, updatedAt: timestamp }).onConflictDoUpdate({ target: connectionCredentials.connectionId, set: { encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt: options.expiresAt, updatedAt: timestamp } });
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
  const [row] = await db().select({ connectionId: connections.id, encryptedSecret: connectionCredentials.encryptedAccessToken, encryptedRefreshToken: connectionCredentials.encryptedRefreshToken, tokenExpiresAt: connectionCredentials.tokenExpiresAt }).from(connections).innerJoin(connectionCredentials, eq(connectionCredentials.connectionId, connections.id)).where(and(eq(connections.accountId, accountId), eq(connections.provider, "GITHUB"), eq(connections.status, "CONNECTED"))).limit(1);
  if (!row) throw new RelayError("CONNECTION_REQUIRED", "Connect GitHub in Relay before using this capability.", "github.repo.read", 409);
  if (row.tokenExpiresAt && new Date(row.tokenExpiresAt).getTime() <= Date.now() + 60_000) {
    if (!row.encryptedRefreshToken) throw new RelayError("CONNECTION_REQUIRED", "Reconnect GitHub before using this capability.", "github.repo.read", 409);
    return refreshGitHubSecret(accountId, row.connectionId, decryptSecret(row.encryptedRefreshToken));
  }
  return decryptSecret(row.encryptedSecret);
}

async function refreshGitHubSecret(accountId: string, connectionId: string, refreshToken: string) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new RelayError("CONNECTION_REQUIRED", "GitHub OAuth refresh is not configured.", "github.repo.read", 503);
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }),
    cache: "no-store",
  });
  const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !result.access_token) {
    await db().update(connections).set({ status: "ERROR", updatedAt: now() }).where(and(eq(connections.id, connectionId), eq(connections.accountId, accountId)));
    throw new RelayError("CONNECTION_REQUIRED", result.error_description ?? "GitHub authorization expired. Reconnect GitHub.", "github.repo.read", 409);
  }
  const encryptedAccessToken = encryptSecret(result.access_token);
  const encryptedRefreshToken = result.refresh_token ? encryptSecret(result.refresh_token) : encryptSecret(refreshToken);
  const tokenExpiresAt = result.expires_in ? new Date(Date.now() + result.expires_in * 1000).toISOString() : undefined;
  await db().update(connectionCredentials).set({ encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt, updatedAt: now() }).where(eq(connectionCredentials.connectionId, connectionId));
  return result.access_token;
}

export async function testGitHub(accountId: string) {
  return githubProvider.health(await githubSecret(accountId));
}
