import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, withTransaction, type RelayDatabase } from "@/lib/db";
import { accountMemberships, agents, auditRecords, principals } from "@/lib/db/schema";
import { lockActiveAccount } from "@/lib/account-fence";
import { canonicalHash } from "@/lib/v2/contracts";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { assertBinding, assertBindingIdentity, IntegrationError, integrationBindingSchema, integrationScopeSchema, type IntegrationBinding, type IntegrationProviderAdapter, type IntegrationScope } from "./contracts";
import { integrationConnections, integrationReceipts } from "./schema";

const requestKey = z.string().min(8).max(255);
export function connectionWhere(scope: IntegrationScope, connectionId?: string) {
  return and(eq(integrationConnections.accountId, scope.accountId), eq(integrationConnections.ownerPrincipalId, scope.ownerPrincipalId),
    eq(integrationConnections.installationId, scope.installationId), eq(integrationConnections.agentId, scope.agentId),
    connectionId ? eq(integrationConnections.id, connectionId) : undefined);
}

/** Canonical account, membership and agent records remain the local authority. */
export async function lockIntegrationScope(transaction: RelayDatabase, input: IntegrationScope, requireActiveAgent = true) {
  const scope = integrationScopeSchema.parse(input);
  await lockActiveAccount(transaction, scope.accountId);
  const owner = await transaction.select({ id: principals.id }).from(principals)
    .innerJoin(accountMemberships, eq(accountMemberships.principalId, principals.id))
    .where(and(eq(principals.id, scope.ownerPrincipalId), eq(principals.type, "HUMAN"), eq(principals.status, "ACTIVE"),
      eq(accountMemberships.accountId, scope.accountId), eq(accountMemberships.status, "ACTIVE"), eq(accountMemberships.role, "OWNER"))).for("share");
  const agent = await transaction.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.id, scope.agentId), eq(agents.accountId, scope.accountId), requireActiveAgent ? eq(agents.status, "ACTIVE") : undefined)).for("share");
  if (!owner.length || !agent.length) throw new IntegrationError("SCOPE_UNAVAILABLE");
}

export class IntegrationConnectionStore {
  constructor(private readonly signer: AuditSigner) {}

  private async evidence(transaction: RelayDatabase, scope: IntegrationScope, eventType: string, code: string, connectionId: string, requestHash?: string) {
    await appendAuditRecordInTransaction(transaction, { accountId: scope.accountId, actorPrincipalId: scope.ownerPrincipalId,
      agentId: scope.agentId, provider: "composio", eventType, outcome: code,
      details: { connectionId, scopeDigest: canonicalHash(scope), ...(requestHash ? { requestHash } : {}) } }, this.signer);
  }

  /** Internal lifecycle completion, never accepts a browser-supplied provider status.
   * Caller has completed owner consent. Provider resolution must match the exact scope.
   * No live caller is installed at this checkpoint. */
  async persistConfirmed(scope: IntegrationScope, input: IntegrationBinding, key: string, adapter: Pick<IntegrationProviderAdapter, "connectionStatus">) {
    const binding = assertBinding(scope, integrationBindingSchema.parse(input));
    if (binding.status !== "CONNECTED" || binding.revokedAt || binding.authorityVersion !== 1) throw new IntegrationError("INVALID_INITIAL_BINDING");
    requestKey.parse(key);
    key = `connect:${key}`;
    const requestHash = canonicalHash(binding);
    return withTransaction(async transaction => {
      await lockIntegrationScope(transaction, scope);
      const replay = await transaction.select().from(integrationReceipts).where(and(eq(integrationReceipts.accountId, scope.accountId), eq(integrationReceipts.key, key)));
      if (replay[0]) {
        if (replay[0].requestHash !== requestHash) throw new IntegrationError("IDEMPOTENCY_CONFLICT");
        // A replay never resurrects a subsequently revoked record.
        const [current] = await transaction.select().from(integrationConnections).where(connectionWhere(scope, binding.connectionId));
        if (!current) throw new IntegrationError("CONNECTION_UNAVAILABLE");
        return current.binding;
      }
      const status = await adapter.connectionStatus(scope, binding);
      if (status.connectedAccountId !== binding.connectedAccountId || status.status !== "ACTIVE" || status.disabled) throw new IntegrationError("PROVIDER_NOT_CONNECTED");
      await transaction.insert(integrationConnections).values({ id: binding.connectionId, accountId: scope.accountId,
        ownerPrincipalId: scope.ownerPrincipalId, agentId: scope.agentId, installationId: scope.installationId,
        connectedAccountId: binding.connectedAccountId, binding });
      await transaction.insert(integrationReceipts).values({ accountId: scope.accountId, key, requestHash, result: { code: "CONNECTED", connectionId: binding.connectionId } });
      await this.evidence(transaction, scope, "integration.connection.confirmed", "CONNECTED", binding.connectionId, requestHash);
      return binding;
    });
  }

  /** Commit local denial and canonical evidence BEFORE any upstream revoke request. */
  async revokeLocal(scope: IntegrationScope, connectionId: string) {
    return withTransaction(async transaction => {
      await lockIntegrationScope(transaction, scope, false);
      const [record] = await transaction.select().from(integrationConnections).where(connectionWhere(scope, connectionId)).for("update");
      if (!record) throw new IntegrationError("CONNECTION_UNAVAILABLE");
      if (record.binding.revokedAt) return record.binding;
      const binding: IntegrationBinding = { ...record.binding, status: "REVOKED", revokedAt: new Date().toISOString(), authorityVersion: record.binding.authorityVersion + 1 };
      await transaction.update(integrationConnections).set({ binding, providerRevocation: "PENDING", updatedAt: new Date().toISOString() }).where(connectionWhere(scope, connectionId));
      await this.evidence(transaction, scope, "integration.connection.revoked", "LOCAL_DENIAL_PROVIDER_PENDING", connectionId);
      return binding;
    });
  }

  async reconcileRevocation(scope: IntegrationScope, connectionId: string, adapter: IntegrationProviderAdapter) {
    const binding = await this.revokeLocal(scope, connectionId);
    const [current] = await db().select().from(integrationConnections).where(connectionWhere(scope, connectionId));
    if (current.providerRevocation === "CONFIRMED") return "CONFIRMED" as const;
    const { providerRevocation } = await adapter.revoke(scope, binding);
    return withTransaction(async transaction => {
      await lockIntegrationScope(transaction, scope, false);
      const [record] = await transaction.select().from(integrationConnections).where(connectionWhere(scope, connectionId)).for("update");
      // Confirmation is monotone; a late timeout cannot undo confirmed revocation.
      if (record.providerRevocation === "CONFIRMED") return "CONFIRMED" as const;
      if (providerRevocation === "CONFIRMED") {
        await transaction.update(integrationConnections).set({ providerRevocation }).where(connectionWhere(scope, connectionId));
        await this.evidence(transaction, scope, "integration.connection.provider-revoked", "CONFIRMED", connectionId);
      }
      return providerRevocation;
    });
  }

  /** Internal sink AFTER signature verification and authoritative provider-ID resolution.
   * Stores only a digest. Events carry no execution authority and cannot reconnect. */
  async recordVerifiedEvent(scope: IntegrationScope, connectionId: string, event: { webhookId: string; payloadHash: string }) {
    z.object({ webhookId: z.string().min(1).max(255), payloadHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict().parse(event);
    const key = `event:${canonicalHash(event.webhookId)}`;
    const requestHash = canonicalHash({ scope, connectionId, ...event });
    return withTransaction(async transaction => {
      await lockIntegrationScope(transaction, scope);
      const [record] = await transaction.select().from(integrationConnections).where(connectionWhere(scope, connectionId));
      if (!record) throw new IntegrationError("CONNECTION_UNAVAILABLE");
      assertBinding(scope, record.binding);
      const [existing] = await transaction.select().from(integrationReceipts).where(and(eq(integrationReceipts.accountId, scope.accountId), eq(integrationReceipts.key, key)));
      if (existing) {
        if (existing.requestHash !== requestHash) throw new IntegrationError("EVENT_REPLAY_CONFLICT");
        return "DUPLICATE" as const;
      }
      const count = await transaction.execute(sql`SELECT count(*)::int AS count FROM ${auditRecords}
        WHERE account_id = ${scope.accountId} AND event_type = 'integration.event.received'
        AND occurred_at > now() - interval '1 minute'`);
      if (Number(count.rows[0]?.count) >= 60) throw new IntegrationError("EVENT_RATE_LIMITED");
      await transaction.insert(integrationReceipts).values({ accountId: scope.accountId, key, requestHash, result: { code: "RECORDED", connectionId } });
      await this.evidence(transaction, scope, "integration.event.received", "NO_AUTHORITY", connectionId, requestHash);
      return "RECORDED" as const;
    });
  }

  async recordDenial(scope: IntegrationScope, connectionId: string, key: string, requestHash: string, code: string) {
    requestKey.parse(key);
    key = `read:${key}`;
    return withTransaction(async transaction => {
      await lockIntegrationScope(transaction, scope);
      const [existing] = await transaction.select().from(integrationReceipts).where(and(eq(integrationReceipts.accountId, scope.accountId), eq(integrationReceipts.key, key)));
      if (existing) {
        if (existing.requestHash !== requestHash) throw new IntegrationError("IDEMPOTENCY_CONFLICT");
        return existing.result;
      }
      const result = { code, connectionId };
      await transaction.insert(integrationReceipts).values({ accountId: scope.accountId, key, requestHash, result });
      await this.evidence(transaction, scope, "integration.execution.denied", code, connectionId, requestHash);
      return result;
    });
  }
}

export async function readIntegrationConnection(scope: IntegrationScope, connectionId: string) {
  return withTransaction(async transaction => {
    await lockIntegrationScope(transaction, scope);
    const [record] = await transaction.select().from(integrationConnections).where(connectionWhere(scope, connectionId));
    if (!record) throw new IntegrationError("CONNECTION_UNAVAILABLE");
    return assertBindingIdentity(scope, record.binding);
  });
}

export async function ownerIntegrationConnections(accountId: string, ownerPrincipalId: string) {
  return db().select().from(integrationConnections).where(and(eq(integrationConnections.accountId, accountId),
    eq(integrationConnections.ownerPrincipalId, ownerPrincipalId))).orderBy(desc(integrationConnections.updatedAt)).limit(100);
}

export async function integrationStorageReady() {
  const result = await db().execute(sql`SELECT to_regclass('public.integration_connections') AS relation`);
  return Boolean(result.rows[0]?.relation);
}
