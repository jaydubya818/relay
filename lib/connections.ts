import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { db, withTransaction } from "@/lib/db";
import { capabilityGrants, connectionCredentials, connections } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { githubProvider } from "@/lib/connectors/github";
import { googleProvider } from "@/lib/connectors/google";

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

export async function connectGoogle(accountId: string, token: string, options: { refreshToken?: string; expiresAt?: string; scopes?: string[] } = {}) {
  const health = await googleProvider.health(token);
  if (!health.ok) throw new RelayError("PROVIDER_ERROR", health.message ?? "Google connection failed.", undefined, 400);
  const timestamp = now();
  return withTransaction(async (transaction) => {
    const [existing] = await transaction.select({ id: connections.id }).from(connections).where(and(eq(connections.accountId, accountId), eq(connections.provider, "GOOGLE"))).limit(1);
    const connectionId = existing?.id ?? id("conn");
    const encryptedAccessToken = encryptSecret(token);
    const encryptedRefreshToken = options.refreshToken ? encryptSecret(options.refreshToken) : undefined;
    await transaction.insert(connections).values({ id: connectionId, accountId, provider: "GOOGLE", displayName: health.displayName ?? "Google Workspace", status: "CONNECTED", externalAccountId: health.externalAccountId, scopes: options.scopes ?? [], createdAt: timestamp, updatedAt: timestamp }).onConflictDoUpdate({ target: [connections.accountId, connections.provider], set: { displayName: health.displayName ?? "Google Workspace", status: "CONNECTED", externalAccountId: health.externalAccountId, scopes: options.scopes ?? [], updatedAt: timestamp } });
    await transaction.insert(connectionCredentials).values({ connectionId, encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt: options.expiresAt, updatedAt: timestamp }).onConflictDoUpdate({ target: connectionCredentials.connectionId, set: { encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt: options.expiresAt, updatedAt: timestamp } });
    return { id: connectionId, ...health };
  });
}

export async function disconnectGoogle(accountId: string) {
  const [connection] = await db().select({ id: connections.id }).from(connections).where(and(eq(connections.accountId, accountId), eq(connections.provider, "GOOGLE"))).limit(1);
  if (!connection) throw new RelayError("CONNECTION_REQUIRED", "Google Workspace is not connected.", undefined, 404);
  await withTransaction(async (transaction) => {
    await transaction.delete(connectionCredentials).where(eq(connectionCredentials.connectionId, connection.id));
    await transaction.update(connections).set({ status: "DISCONNECTED", updatedAt: now() }).where(and(eq(connections.id, connection.id), eq(connections.accountId, accountId)));
  });
}

export async function googleSecret(accountId: string, capability: "email.search" | "email.read" | "calendar.event.list" | "calendar.event.read" | "calendar.availability.read") {
  const [row] = await db().select({ connectionId: connections.id, connectionUpdatedAt: connections.updatedAt, encryptedSecret: connectionCredentials.encryptedAccessToken, encryptedRefreshToken: connectionCredentials.encryptedRefreshToken, tokenExpiresAt: connectionCredentials.tokenExpiresAt }).from(connections).innerJoin(connectionCredentials, eq(connectionCredentials.connectionId, connections.id)).where(and(eq(connections.accountId, accountId), eq(connections.provider, "GOOGLE"), inArray(connections.status, ["CONNECTED", "ERROR"]))).limit(1);
  if (!row) throw new RelayError("CONNECTION_REQUIRED", "Connect Google Workspace in Relay before using this capability.", capability, 409);
  if (!row.tokenExpiresAt || new Date(row.tokenExpiresAt).getTime() > Date.now() + 60_000) return decryptSecret(row.encryptedSecret);
  if (!row.encryptedRefreshToken) throw new RelayError("CONNECTION_REQUIRED", "Reconnect Google Workspace to restore offline access.", capability, 409);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new RelayError("CONNECTION_REQUIRED", "Google OAuth refresh is not configured.", capability, 503);
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: decryptSecret(row.encryptedRefreshToken), grant_type: "refresh_token" }), cache: "no-store" });
  const refreshed = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  const accessToken = refreshed.access_token;
  if (!response.ok || !accessToken) {
    const [current] = await db().select({ encryptedSecret: connectionCredentials.encryptedAccessToken, tokenExpiresAt: connectionCredentials.tokenExpiresAt }).from(connections).innerJoin(connectionCredentials, eq(connectionCredentials.connectionId, connections.id)).where(and(eq(connections.id, row.connectionId), eq(connections.accountId, accountId), eq(connections.status, "CONNECTED"))).limit(1);
    if (current?.tokenExpiresAt && new Date(current.tokenExpiresAt).getTime() > Date.now() + 60_000) return decryptSecret(current.encryptedSecret);
    await db().update(connections).set({ status: "ERROR", updatedAt: now() }).where(and(eq(connections.id, row.connectionId), eq(connections.accountId, accountId), eq(connections.updatedAt, row.connectionUpdatedAt), inArray(connections.status, ["CONNECTED", "ERROR"])));
    throw new RelayError("CONNECTION_REQUIRED", refreshed.error_description ?? "Google authorization expired. Reconnect Google Workspace.", capability, 409);
  }
  const timestamp = now();
  await withTransaction(async (transaction) => {
    const updatedCredential = await transaction.update(connectionCredentials).set({ encryptedAccessToken: encryptSecret(accessToken), ...(refreshed.refresh_token ? { encryptedRefreshToken: encryptSecret(refreshed.refresh_token) } : {}), tokenExpiresAt: new Date(Date.now() + Number(refreshed.expires_in ?? 3600) * 1000).toISOString(), updatedAt: timestamp }).where(eq(connectionCredentials.connectionId, row.connectionId)).returning({ connectionId: connectionCredentials.connectionId });
    if (updatedCredential.length === 0) throw new RelayError("CONNECTION_REQUIRED", "Connect Google Workspace in Relay before using this capability.", capability, 409);
    const recovered = await transaction.update(connections).set({ status: "CONNECTED", updatedAt: timestamp }).where(and(eq(connections.id, row.connectionId), eq(connections.accountId, accountId), inArray(connections.status, ["CONNECTED", "ERROR"]))).returning({ id: connections.id });
    if (recovered.length === 0) throw new RelayError("CONNECTION_REQUIRED", "Connect Google Workspace in Relay before using this capability.", capability, 409);
  });
  return accessToken;
}

export async function testGoogle(accountId: string) {
  return googleProvider.health(await googleSecret(accountId, "email.read"));
}
