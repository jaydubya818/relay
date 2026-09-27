import { sql } from "drizzle-orm";
import { db, withTransaction, type RelayDatabase } from "@/lib/db";
import { RelayError } from "@/lib/errors";
import { now } from "@/lib/ids";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";

type Queryable = Pick<RelayDatabase, "execute">;
export type BetaRetirementPlan = {
  accountId: string;
  state: "ACTIVE" | "RETIRED";
  agents: number;
  activeSessions: number;
  activeCredentials: number;
  activeAgentIdentities: number;
  activeDelegations: number;
  activeGrants: number;
  pendingInvites: number;
  relationships: number;
  queuedDeliveries: number;
  publishedKnowledge: number;
  historicalReceipts: number;
  privateDataObjects: number;
  unsupportedResources: number;
  policy: "RETIRE_ONLY";
};

async function planInDatabase(database: Queryable, accountId: string): Promise<BetaRetirementPlan> {
  const result = await database.execute(sql`
    SELECT a.id, a.disposable_beta, a.retired_at,
      (SELECT count(*) FROM agents WHERE account_id=a.id) AS agents,
      ((SELECT count(*) FROM user_sessions WHERE account_id=a.id AND revoked_at IS NULL AND expires_at>now()) +
       (SELECT count(*) FROM agent_sessions WHERE account_id=a.id AND status='ACTIVE' AND (expires_at IS NULL OR expires_at>now()))) AS active_sessions,
      (SELECT count(*) FROM agent_credentials WHERE account_id=a.id AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())) AS active_credentials,
      (SELECT count(*) FROM federation_agents WHERE account_id=a.id AND availability<>'REVOKED') AS active_agent_identities,
      (SELECT count(*) FROM federation_message_delegations WHERE (account_id=a.id OR grantee_account_id=a.id) AND revoked_at IS NULL AND expires_at>now()) AS active_delegations,
      (SELECT count(*) FROM federation_grants WHERE (account_id=a.id OR grantee_account_id=a.id) AND status='ACTIVE') AS active_grants,
      (SELECT count(*) FROM beta_invites WHERE account_id=a.id AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now()) AS pending_invites,
      (SELECT count(*) FROM federation_relationships WHERE account_id=a.id OR subject=a.id) AS relationships,
      (SELECT count(*) FROM federation_requests WHERE (account_id=a.id OR target_account_id=a.id) AND status IN ('CREATED','AUTHORIZED','DELIVERED','WAITING','ACCEPTED','RUNNING')) AS queued_deliveries,
      (SELECT count(*) FROM published_views WHERE account_id=a.id AND status='ACTIVE') AS published_knowledge,
      (SELECT count(*) FROM federation_requests WHERE (account_id=a.id OR target_account_id=a.id) AND status IN ('COMPLETED','DENIED','REJECTED','FAILED','CANCELLED')) AS historical_receipts,
      (SELECT count(*) FROM memories WHERE account_id=a.id AND forgotten_at IS NULL) AS private_data_objects,
      ((SELECT count(*) FROM connections WHERE account_id=a.id) +
       (SELECT count(*) FROM communication_connections WHERE account_id=a.id) +
       (SELECT count(*) FROM connector_connections WHERE account_id=a.id) +
       (SELECT count(*) FROM sandboxes WHERE account_id=a.id AND status NOT IN ('DESTROYED','EXPIRED')) +
       (SELECT count(*) FROM browser_sessions WHERE account_id=a.id AND status NOT IN ('DESTROYED','EXPIRED')) +
       (SELECT count(*) FROM v2_tasks WHERE account_id=a.id AND status NOT IN ('SUCCEEDED','FAILED','CANCELLED','DEAD_LETTERED')) +
       (SELECT count(*) FROM service_clients sc JOIN account_memberships am ON am.principal_id=sc.principal_id WHERE am.account_id=a.id AND sc.revoked_at IS NULL)) AS unsupported_resources
    FROM accounts a WHERE a.id=${accountId}`);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row || row.disposable_beta !== true) throw new RelayError("CAPABILITY_DENIED", "Only an invited disposable beta account can be retired here.", undefined, 403);
  return {
    accountId, state: row.retired_at ? "RETIRED" : "ACTIVE", policy: "RETIRE_ONLY",
    agents: Number(row.agents), activeSessions: Number(row.active_sessions), activeCredentials: Number(row.active_credentials),
    activeAgentIdentities: Number(row.active_agent_identities), activeDelegations: Number(row.active_delegations),
    activeGrants: Number(row.active_grants), pendingInvites: Number(row.pending_invites),
    relationships: Number(row.relationships), queuedDeliveries: Number(row.queued_deliveries),
    publishedKnowledge: Number(row.published_knowledge), historicalReceipts: Number(row.historical_receipts),
    privateDataObjects: Number(row.private_data_objects), unsupportedResources: Number(row.unsupported_resources),
  };
}

export async function planDisposableBetaRetirement(accountId: string) {
  return planInDatabase(db(), accountId);
}

/** One database transaction is the recovery boundary: a crash rolls back every step. */
export async function retireDisposableBetaAccount(input: { accountId: string; ownerUserId: string; signer: AuditSigner }) {
  return withTransaction(async (transaction) => {
    // Every federation request/grant/publication takes this same owner lock.
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`federation:${input.accountId}`}, 0))`);
    const owner = await transaction.execute(sql`SELECT id FROM users WHERE id=${input.ownerUserId} AND account_id=${input.accountId} AND role='OWNER'`);
    if (!owner.rows.length) throw new RelayError("CAPABILITY_DENIED", "Only this beta account's owner may retire it.", undefined, 403);
    await transaction.execute(sql`SELECT id FROM accounts WHERE id=${input.accountId} FOR UPDATE`);
    const plan = await planInDatabase(transaction, input.accountId);
    if (plan.state === "RETIRED") return { accountId: input.accountId, state: "RETIRED" as const, idempotentReplay: true, plan };
    if (plan.unsupportedResources) throw new RelayError("INVALID_INPUT", "External resources or active work must be retired before this beta account.", undefined, 409);

    const timestamp = now();
    // Fence first, then revoke every supported authority before committing.
    await transaction.execute(sql`UPDATE accounts SET retired_at=${timestamp},retired_by_user_id=${input.ownerUserId},updated_at=${timestamp} WHERE id=${input.accountId} AND retired_at IS NULL`);
    await transaction.execute(sql`UPDATE beta_invites SET revoked_at=${timestamp},revoked_by_user_id=${input.ownerUserId} WHERE account_id=${input.accountId} AND consumed_at IS NULL AND revoked_at IS NULL`);
    await transaction.execute(sql`UPDATE user_sessions SET revoked_at=${timestamp} WHERE account_id=${input.accountId} AND revoked_at IS NULL`);
    await transaction.execute(sql`UPDATE agent_credentials SET revoked_at=${timestamp} WHERE account_id=${input.accountId} AND revoked_at IS NULL`);
    await transaction.execute(sql`UPDATE agent_sessions SET status='REVOKED' WHERE account_id=${input.accountId} AND status='ACTIVE'`);
    await transaction.execute(sql`UPDATE federation_message_delegations SET revoked_at=${timestamp} WHERE (account_id=${input.accountId} OR grantee_account_id=${input.accountId}) AND revoked_at IS NULL`);
    await transaction.execute(sql`UPDATE federation_agents SET availability='REVOKED',primary_agent=false,updated_at=${timestamp} WHERE account_id=${input.accountId} AND availability<>'REVOKED'`);
    await transaction.execute(sql`UPDATE agents SET status='DISABLED',updated_at=${timestamp} WHERE account_id=${input.accountId} AND status<>'DISABLED'`);
    await transaction.execute(sql`UPDATE federation_grants SET status='REVOKED',updated_at=${timestamp} WHERE (account_id=${input.accountId} OR grantee_account_id=${input.accountId}) AND status='ACTIVE'`);
    await transaction.execute(sql`UPDATE published_views SET status='REVOKED',updated_at=${timestamp} WHERE account_id=${input.accountId} AND status<>'REVOKED'`);
    await transaction.execute(sql`UPDATE federation_relationships SET trust='BLOCKED',updated_at=${timestamp} WHERE account_id=${input.accountId} OR subject=${input.accountId}`);
    await transaction.execute(sql`UPDATE federation_requests SET status=CASE WHEN status IN ('COMPLETED','DENIED','REJECTED','FAILED','CANCELLED','EXPIRED') THEN status ELSE 'CANCELLED' END,
      inbox_status=CASE WHEN status IN ('COMPLETED','DENIED','REJECTED','FAILED','CANCELLED','EXPIRED') THEN inbox_status ELSE 'REJECTED' END,
      encrypted_payload=NULL,encrypted_result=NULL,updated_at=${timestamp}
      WHERE account_id=${input.accountId} OR target_account_id=${input.accountId}`);
    await transaction.execute(sql`UPDATE control_outbox SET cancelled_at=${timestamp}
      WHERE published_at IS NULL AND cancelled_at IS NULL AND
        (account_id=${input.accountId} OR (aggregate_type='federation_request' AND aggregate_id IN
          (SELECT id FROM federation_requests WHERE account_id=${input.accountId} OR target_account_id=${input.accountId})))`);
    await transaction.execute(sql`UPDATE memories SET content='',forgotten_at=${timestamp},updated_at=${timestamp} WHERE account_id=${input.accountId} AND forgotten_at IS NULL`);
    await transaction.execute(sql`UPDATE account_memberships SET status='REMOVED',updated_at=${timestamp} WHERE account_id=${input.accountId} AND status='ACTIVE'`);
    const verified = await planInDatabase(transaction, input.accountId);
    if (verified.state !== "RETIRED" || [verified.activeSessions, verified.activeCredentials,
      verified.activeAgentIdentities, verified.activeDelegations, verified.activeGrants,
      verified.pendingInvites, verified.queuedDeliveries, verified.publishedKnowledge,
      verified.privateDataObjects].some((count) => count !== 0)) {
      throw new Error("Beta account retirement verification failed; all changes were rolled back.");
    }
    await appendAuditRecordInTransaction(transaction, {
      accountId: input.accountId, eventType: "beta.account.retired", outcome: "RETIRED",
      details: { agents: plan.agents, grants: plan.activeGrants, invitations: plan.pendingInvites, requests: plan.queuedDeliveries, preservedHistoricalReceipts: plan.historicalReceipts },
    }, input.signer);
    return { accountId: input.accountId, state: "RETIRED" as const, idempotentReplay: false, plan };
  });
}
