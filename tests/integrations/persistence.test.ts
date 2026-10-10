import { readFile } from "node:fs/promises";
import { sql, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshDatabase, cleanupDatabase, secondAccount } from "../helpers";
import { db } from "@/lib/db";
import { createAgent } from "@/lib/agents";
import { accountMemberships, accounts, agents, capabilityGrants, principals } from "@/lib/db/schema";
import { createLocalEd25519Signer } from "@/lib/v2/evidence/crypto";
import { listAuditRecords, verifyAuditRecords } from "@/lib/v2/evidence/audit";
import { canonicalHash } from "@/lib/v2/contracts";
import { consumerResource } from "@/lib/integrations/consumer";
import { providerUserId, type IntegrationBinding, type IntegrationScope } from "@/lib/integrations/contracts";
import { IntegrationConnectionStore, readIntegrationConnection } from "@/lib/integrations/persistence";
import { IntegrationGateway, type DiscoveryProjection } from "@/lib/integrations/gateway";
import { integrationConnections } from "@/lib/integrations/schema";
import { binding as template, fixture, qualification } from "./fixtures";

let scope: IntegrationScope;
let binding: IntegrationBinding;
let secret: string;
let signer: ReturnType<typeof createLocalEd25519Signer>;
let store: IntegrationConnectionStore;
let provider: ReturnType<typeof fixture>;
let projection: DiscoveryProjection;
beforeEach(async () => {
  const owner = await freshDatabase();
  await db().execute(sql.raw(await readFile("lib/integrations/qualification.sql", "utf8")));
  const agent = await createAgent(owner.accountId, { name: "Synthetic Research Agent", capabilities: ["github.repo.read"] });
  secret = agent.credential;
  scope = { accountId: owner.accountId, ownerPrincipalId: owner.principalId, agentId: agent.agentId, installationId: "installation_synthetic" };
  binding = { ...template, ...scope, providerUserId: providerUserId(scope) };
  signer = createLocalEd25519Signer(); store = new IntegrationConnectionStore(signer); provider = fixture();
  projection = { scope, connectionId: binding.connectionId, authorityVersion: 1, ownerPolicyRevision: 1, relayPolicyRevision: "synthetic-policy-1",
    validUntil: new Date(Date.now() + 60_000).toISOString(), ownerEnabled: true, organizationEnabled: true, harnessIds: ["research-fixture"],
    tools: [{ slug: qualification.slug, version: qualification.version, schemaHash: qualification.schemaHash, capability: "github.repo.read", effect: "READ", requiredScopes: ["repo:read"] }] };
});
afterEach(cleanupDatabase);
const persist = () => store.persistConfirmed(scope, binding, "synthetic-connect-1", provider.adapter);
const gateway = () => new IntegrationGateway(provider.adapter, store, { async restrictions() { return projection; } });
const discovery = () => ({ scope, connectionId: binding.connectionId, harnessId: "research-fixture", query: "ISSUES" });
function request() {
  const input = { schemaVersion: "relay.integration-read.v1" as const, scope, connectionId: binding.connectionId, toolkit: binding.toolkit,
    tool: qualification.slug, toolVersion: qualification.version, toolSchemaHash: qualification.schemaHash,
    authorityVersion: 1, ownerPolicyRevision: 1, relayPolicyRevision: "synthetic-policy-1", harnessId: "research-fixture", effect: "READ" as const,
    targetResource: "assigned-issues", expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const material = { capability: { name: "github.repo.read", version: "1.0" }, resource: consumerResource(input, "synthetic-read-1"), parameters: { per_page: 10 } };
  return { ...input, action: { schemaVersion: "relay.action-intent.v2", id: "act_synthetic1", accountId: scope.accountId, agentId: scope.agentId,
    runtimeClientId: "rtc_synthetic1", taskId: "tsk_synthetic1", createdAt: new Date().toISOString(), idempotencyKey: "synthetic-read-1", ...material, canonicalHash: canonicalHash(material) } };
}

describe("PostgreSQL provider lifecycle and bounded Golden Journey", () => {
  it("persists provider-confirmed metadata once under concurrent duplicate consent completions", async () => {
    const results = await Promise.all([persist(), persist(), persist()]);
    expect(results.every(result => result.connectionId === binding.connectionId)).toBe(true);
    expect(provider.sdk.connectedAccounts.list).toHaveBeenCalledTimes(1);
    expect(await readIntegrationConnection(scope, binding.connectionId)).toEqual(binding);
    const data = JSON.stringify(await db().select().from(integrationConnections));
    expect(data).not.toContain("access_token"); expect(data).not.toContain("secret-do-not-return");
    expect(await listAuditRecords(scope.accountId)).toHaveLength(1);
    await expect(store.persistConfirmed(scope, { ...binding, scopes: [] }, "synthetic-connect-1", provider.adapter)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
  it.each(["accountId", "ownerPrincipalId", "agentId", "installationId"] as const)("denies a substituted %s", async key => {
    await persist();
    await expect(readIntegrationConnection({ ...scope, [key]: "foreign" }, binding.connectionId)).rejects.toThrow();
    await expect(store.revokeLocal({ ...scope, [key]: "foreign" }, binding.connectionId)).rejects.toThrow();
  });
  it("rejects an empty connection selector without broadening the query", async () => {
    await persist();
    await expect(readIntegrationConnection(scope, "")).rejects.toThrow();
    await expect(store.revokeLocal(scope, "")).rejects.toThrow();
    expect((await readIntegrationConnection(scope, binding.connectionId)).status).toBe("CONNECTED");
  });
  it("rejects a canonical agent belonging to another account before provider lookup", async () => {
    const foreign = await createAgent(await secondAccount(), { name: "Other Agent" });
    const changed = { ...scope, agentId: foreign.agentId };
    await expect(store.persistConfirmed(changed, { ...binding, ...changed, providerUserId: providerUserId(changed) }, "foreign-connect-1", provider.adapter)).rejects.toThrow("SCOPE_UNAVAILABLE");
    expect(provider.sdk.connectedAccounts.list).not.toHaveBeenCalled();
  });
  it("isolates two valid owners of the same account", async () => {
    await persist();
    await db().insert(principals).values({ id: "prn_other_owner", type: "HUMAN", displayName: "Other synthetic owner" });
    await db().insert(accountMemberships).values({ accountId: scope.accountId, principalId: "prn_other_owner", role: "OWNER" });
    const otherScope = { ...scope, ownerPrincipalId: "prn_other_owner" };
    await expect(readIntegrationConnection(otherScope, binding.connectionId)).rejects.toThrow("CONNECTION_UNAVAILABLE");
    await expect(store.revokeLocal(otherScope, binding.connectionId)).rejects.toThrow("CONNECTION_UNAVAILABLE");
  });
  it("rejects inactive provider state and unknown fields without storing credentials", async () => {
    provider.sdk.connectedAccounts.list.mockResolvedValueOnce({ items: [], nextCursor: null, totalPages: 0 });
    await expect(persist()).rejects.toThrow();
    await expect(store.persistConfirmed(scope, { ...binding, access_token: "bad" } as IntegrationBinding, "bad-key-1", provider.adapter)).rejects.toThrow();
    expect(await db().select().from(integrationConnections)).toHaveLength(0);
  });
  it("commits the local revoke before calling provider, retains pending on timeout, and cannot resurrect", async () => {
    await persist();
    provider.sdk.connectedAccounts.revoke.mockImplementationOnce(async () => {
      expect((await readIntegrationConnection(scope, binding.connectionId)).status).toBe("REVOKED");
      throw new Error("provider-secret-timeout");
    });
    expect(await store.reconcileRevocation(scope, binding.connectionId, provider.adapter)).toBe("PENDING");
    expect((await persist()).status).toBe("REVOKED");
    expect((await persist()).authorityVersion).toBe(2);
    expect(await store.reconcileRevocation(scope, binding.connectionId, provider.adapter)).toBe("CONFIRMED");
    const evidence = await listAuditRecords(scope.accountId);
    expect(evidence).toHaveLength(3); expect(await verifyAuditRecords(evidence, signer)).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain("provider-secret");
  });
  it("rolls back persistence if canonical evidence cannot commit", async () => {
    store = new IntegrationConnectionStore({ ...signer, async sign() { throw new Error("signer unavailable"); } });
    await expect(persist()).rejects.toThrow("signer unavailable");
    expect(await db().select().from(integrationConnections)).toHaveLength(0);
  });
  it("permits owner local revocation after agent suspension", async () => {
    await persist();
    await db().update(agents).set({ status: "DISABLED" }).where(eq(agents.id, scope.agentId));
    expect((await store.revokeLocal(scope, binding.connectionId)).status).toBe("REVOKED");
  });
  it("records verified-event digests once, rejects conflicting replay and revoked connection", async () => {
    await persist();
    const event = { webhookId: "event_synthetic1", payloadHash: canonicalHash({ synthetic: true }) };
    expect(await Promise.all([store.recordVerifiedEvent(scope, binding.connectionId, event), store.recordVerifiedEvent(scope, binding.connectionId, event)])).toEqual(["RECORDED", "DUPLICATE"]);
    await expect(store.recordVerifiedEvent(scope, binding.connectionId, { ...event, payloadHash: canonicalHash("changed") })).rejects.toThrow("EVENT_REPLAY_CONFLICT");
    await store.revokeLocal(scope, binding.connectionId);
    await expect(store.recordVerifiedEvent(scope, binding.connectionId, { ...event, webhookId: "event_synthetic2" })).rejects.toThrow("CONNECTION_REVOKED");
    expect(await verifyAuditRecords(await listAuditRecords(scope.accountId), signer)).toBe(true);
  });
  it("rate limits new verified events durably without giving events authority", async () => {
    await persist();
    for (let index = 0; index < 60; index++) await store.recordVerifiedEvent(scope, binding.connectionId, { webhookId: `event_${index}`, payloadHash: canonicalHash(index) });
    await expect(store.recordVerifiedEvent(scope, binding.connectionId, { webhookId: "event_over_limit", payloadHash: canonicalHash(61) })).rejects.toThrow("EVENT_RATE_LIMITED");
    expect(provider.sdk.tools.execute).not.toHaveBeenCalled();
  });
  it("denies retired accounts", async () => {
    await persist();
    await db().update(accounts).set({ retiredAt: new Date().toISOString() }).where(eq(accounts.id, scope.accountId));
    await expect(gateway().discover(secret, discovery())).rejects.toThrow();
  });
  it("Golden Journey connects, persists, discovers one read, and preserves authenticated admission denial", async () => {
    const started = performance.now();
    await persist();
    const connected = performance.now();
    const result = await gateway().discover(secret, discovery());
    const discovered = performance.now();
    expect(result.actions).toHaveLength(1); expect(result.executionAvailable).toBe(false);
    const value = request();
    const receipts = await Promise.all([gateway().requestRead(secret, value), gateway().requestRead(secret, value)]);
    expect(receipts[0]).toEqual(receipts[1]); expect(receipts[0].code).toBe("CROSS_DATABASE_ORDERING_UNQUALIFIED");
    expect(receipts[0].state).toBe("NOT_DISPATCHED"); expect(provider.sdk.tools.execute).not.toHaveBeenCalled();
    expect(await listAuditRecords(scope.accountId)).toHaveLength(2);
    expect(await verifyAuditRecords(await listAuditRecords(scope.accountId), signer)).toBe(true);
    console.info(JSON.stringify({ benchmark: "synthetic-integration-journey", connectionPersistenceMs: connected - started,
      discoveryMs: discovered - connected, authenticatedDenialMs: performance.now() - discovered,
      providerExecution: "NOT_RUN", sofieResponse: "NOT_RUN" }));
  });
  it("discovery fails closed with default, expired, mismatched, disabled or unqualified policy", async () => {
    await persist();
    await expect(new IntegrationGateway(provider.adapter, store).discover(secret, discovery())).rejects.toThrow("POLICY_UNAVAILABLE");
    for (const change of [{ validUntil: new Date(0).toISOString() }, { connectionId: "foreign" }, { organizationEnabled: false }, { ownerEnabled: false }, { harnessIds: [] }, { authorityVersion: 2 }]) {
      const current = projection; projection = { ...projection, ...change };
      await expect(gateway().discover(secret, discovery())).rejects.toThrow(); projection = current;
    }
    expect(provider.sdk.tools.getRawComposioToolBySlug).not.toHaveBeenCalled();
  });
  it("denies stale execution policy, invalid credential, and cross-agent credential", async () => {
    await persist(); projection.validUntil = new Date(0).toISOString();
    expect((await gateway().requestRead(secret, request())).code).toBe("POLICY_STALE");
    await expect(gateway().discover("invalid", discovery())).rejects.toThrow("INVALID_CREDENTIAL");
    const other = await createAgent(scope.accountId, { name: "Other" });
    await expect(gateway().discover(other.credential, discovery())).rejects.toThrow("AUTHENTICATED_SCOPE_MISMATCH");
    expect(provider.sdk.tools.execute).not.toHaveBeenCalled();
  });
  it("intersects exact grants/scopes and detects revocation during provider schema lookup", async () => {
    await persist();
    await db().delete(capabilityGrants).where(eq(capabilityGrants.agentId, scope.agentId));
    expect((await gateway().discover(secret, discovery())).actions).toEqual([]);
    expect(provider.sdk.tools.getRawComposioToolBySlug).not.toHaveBeenCalled();
    await db().insert(capabilityGrants).values({ id: "grant_fixture", accountId: scope.accountId, agentId: scope.agentId, capability: "github.repo.read", effect: "ALLOW" });
    const original = provider.sdk.tools.getRawComposioToolBySlug.getMockImplementation()!;
    provider.sdk.tools.getRawComposioToolBySlug.mockImplementationOnce(async () => { await store.revokeLocal(scope, binding.connectionId); return original(); });
    await expect(gateway().discover(secret, discovery())).rejects.toThrow("CONNECTION_REVOKED");
  });
});
