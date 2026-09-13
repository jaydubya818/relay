import { createAgentSecret, hashSecret } from "@/lib/crypto";
import { db, withTransaction } from "@/lib/db";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { CAPABILITIES, type CapabilityName } from "@/lib/types";

export function listAgents(accountId: string) {
  return db().prepare(`
    SELECT a.id, a.name, a.description, a.status, a.created_at createdAt, a.updated_at updatedAt,
      MAX(c.last_used_at) lastActiveAt,
      SUM(CASE WHEN c.revoked_at IS NULL THEN 1 ELSE 0 END) activeCredentials
    FROM agents a LEFT JOIN agent_credentials c ON c.agent_id = a.id
    WHERE a.account_id = ? GROUP BY a.id ORDER BY a.created_at
  `).all(accountId) as any[];
}

export function getAgent(accountId: string, agentId: string) {
  const agent = db().prepare(`
    SELECT id, name, description, status, created_at createdAt, updated_at updatedAt
    FROM agents WHERE id = ? AND account_id = ?
  `).get(agentId, accountId) as any;
  if (!agent) throw new RelayError("INVALID_INPUT", "Agent not found.", undefined, 404);
  const grants = db().prepare("SELECT capability, effect FROM capability_grants WHERE agent_id = ? ORDER BY capability").all(agentId);
  const credentials = db().prepare(`SELECT id, name, prefix, created_at createdAt, expires_at expiresAt, revoked_at revokedAt, last_used_at lastUsedAt FROM agent_credentials WHERE agent_id = ? ORDER BY created_at DESC`).all(agentId);
  return { ...agent, grants, credentials };
}

export function createAgent(accountId: string, input: { name: string; description?: string; capabilities?: CapabilityName[] }) {
  const timestamp = now();
  const agentId = id("agt");
  return withTransaction(() => {
    db().prepare("INSERT INTO agents (id, account_id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)").run(agentId, accountId, input.name.trim(), input.description?.trim() ?? "", timestamp, timestamp);
    for (const capability of input.capabilities ?? ["memory.read", "memory.write"]) {
      setCapabilityGrant(accountId, agentId, capability, "ALLOW");
    }
    const credential = issueCredential(accountId, agentId, "Primary");
    return { agentId, credential: credential.secret };
  });
}

export function issueCredential(accountId: string, agentId: string, name: string) {
  getAgent(accountId, agentId);
  const secret = createAgentSecret();
  const credentialId = id("cred");
  db().prepare(`INSERT INTO agent_credentials (id, account_id, agent_id, name, secret_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(credentialId, accountId, agentId, name, hashSecret(secret), secret.slice(0, 12), now());
  return { id: credentialId, secret, prefix: secret.slice(0, 12) };
}

export function rotateCredential(accountId: string, agentId: string) {
  return withTransaction(() => {
    db().prepare("UPDATE agent_credentials SET revoked_at = ? WHERE account_id = ? AND agent_id = ? AND revoked_at IS NULL").run(now(), accountId, agentId);
    return issueCredential(accountId, agentId, "Rotated credential");
  });
}

export function revokeCredential(accountId: string, agentId: string, credentialId?: string) {
  const result = credentialId
    ? db().prepare("UPDATE agent_credentials SET revoked_at = ? WHERE id = ? AND agent_id = ? AND account_id = ? AND revoked_at IS NULL").run(now(), credentialId, agentId, accountId)
    : db().prepare("UPDATE agent_credentials SET revoked_at = ? WHERE agent_id = ? AND account_id = ? AND revoked_at IS NULL").run(now(), agentId, accountId);
  return result.changes > 0;
}

export function updateAgentStatus(accountId: string, agentId: string, status: "ACTIVE" | "DISABLED") {
  const result = db().prepare("UPDATE agents SET status = ?, updated_at = ? WHERE id = ? AND account_id = ?").run(status, now(), agentId, accountId);
  if (!result.changes) throw new RelayError("INVALID_INPUT", "Agent not found.", undefined, 404);
}

export function setCapabilityGrant(accountId: string, agentId: string, capability: CapabilityName, effect: "ALLOW" | "DENY") {
  if (!CAPABILITIES.includes(capability)) throw new RelayError("INVALID_INPUT", "Unknown capability.");
  const agent = db().prepare("SELECT id FROM agents WHERE id = ? AND account_id = ?").get(agentId, accountId);
  if (!agent) throw new RelayError("INVALID_INPUT", "Agent not found.", undefined, 404);
  db().prepare(`
    INSERT INTO capability_grants (id, account_id, agent_id, capability, effect, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, capability) DO UPDATE SET effect = excluded.effect
  `).run(id("grant"), accountId, agentId, capability, effect, now());
}
