import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { db, withTransaction } from "@/lib/db";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { githubProvider } from "@/lib/connectors/github";

export function listConnections(accountId: string) {
  return db().prepare(`
    SELECT c.id, c.provider, c.display_name displayName, c.status, c.external_account_id externalAccountId,
      c.created_at createdAt, c.updated_at updatedAt,
      (SELECT COUNT(DISTINCT g.agent_id) FROM capability_grants g WHERE g.account_id = c.account_id AND g.capability LIKE 'github.%' AND g.effect = 'ALLOW') agentsWithAccess
    FROM connections c WHERE c.account_id = ? ORDER BY c.provider
  `).all(accountId) as any[];
}

export async function connectGitHub(accountId: string, token: string) {
  const health = await githubProvider.health(token);
  if (!health.ok) throw new RelayError("PROVIDER_ERROR", health.message ?? "GitHub connection failed.", undefined, 400);
  const timestamp = now();
  return withTransaction(() => {
    const existing = db().prepare("SELECT id FROM connections WHERE account_id = ? AND provider = 'GITHUB'").get(accountId) as { id: string } | undefined;
    const connectionId = existing?.id ?? id("conn");
    db().prepare(`
      INSERT INTO connections (id, account_id, provider, display_name, status, external_account_id, created_at, updated_at)
      VALUES (?, ?, 'GITHUB', ?, 'CONNECTED', ?, ?, ?)
      ON CONFLICT(account_id, provider) DO UPDATE SET display_name = excluded.display_name, status = 'CONNECTED', external_account_id = excluded.external_account_id, updated_at = excluded.updated_at
    `).run(connectionId, accountId, health.displayName ?? "GitHub", health.externalAccountId ?? null, timestamp, timestamp);
    db().prepare(`INSERT INTO connection_credentials (connection_id, encrypted_secret, updated_at) VALUES (?, ?, ?) ON CONFLICT(connection_id) DO UPDATE SET encrypted_secret = excluded.encrypted_secret, updated_at = excluded.updated_at`)
      .run(connectionId, encryptSecret(token), timestamp);
    return { id: connectionId, ...health };
  });
}

export function disconnectGitHub(accountId: string) {
  const connection = db().prepare("SELECT id FROM connections WHERE account_id = ? AND provider = 'GITHUB'").get(accountId) as { id: string } | undefined;
  if (!connection) return new RelayError("CONNECTION_REQUIRED", "GitHub is not connected.", undefined, 404);
  return withTransaction(() => {
    db().prepare("DELETE FROM connection_credentials WHERE connection_id = ?").run(connection.id);
    db().prepare("UPDATE connections SET status = 'DISCONNECTED', updated_at = ? WHERE id = ?").run(now(), connection.id);
  });
}

export function githubSecret(accountId: string) {
  const row = db().prepare(`
    SELECT cc.encrypted_secret encryptedSecret FROM connections c
    JOIN connection_credentials cc ON cc.connection_id = c.id
    WHERE c.account_id = ? AND c.provider = 'GITHUB' AND c.status = 'CONNECTED'
  `).get(accountId) as { encryptedSecret: string } | undefined;
  if (!row) throw new RelayError("CONNECTION_REQUIRED", "Connect GitHub in Relay before using this capability.", "github.repo.read", 409);
  return decryptSecret(row.encryptedSecret);
}

export async function testGitHub(accountId: string) {
  return githubProvider.health(githubSecret(accountId));
}
