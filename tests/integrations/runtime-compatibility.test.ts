import { generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { freshDatabase, cleanupDatabase } from "../helpers";
import { db } from "@/lib/db";
import { createAgent } from "@/lib/agents";
import { capabilityLeases, policyDecisions } from "@/lib/db/schema";
import { canonicalHash, capabilityLeaseClaimsSchema } from "@/lib/v2/contracts";
import { createLocalEd25519Signer } from "@/lib/v2/evidence";
import { authenticateDeveloperClient } from "@/lib/v2/developer-platform";
import { createWorkloadBootstrap, exchangeWorkloadBootstrap, issueCapabilityLease, authorizeLeaseCall, revokeLease } from "@/lib/v2/leases";
import { registerRuntimeClient, revokeRuntimeClient } from "@/lib/v2/runtime-clients";
import { issueAgentPassport } from "@/lib/v2/passports";
import { evaluatePolicy, publishRelaySafetyPolicy, registerCapabilityDefinition } from "@/lib/v2/policy";
import { ingestVerifiedEvent, publishEventRoute } from "@/lib/v2/orchestration";
import { consumerResource } from "@/lib/integrations/consumer";
import { bindExecution } from "@/lib/integrations/execution-binding";
import { providerUserId } from "@/lib/integrations/contracts";
import { IntegrationGateway } from "@/lib/integrations/gateway";
import { IntegrationConnectionStore } from "@/lib/integrations/persistence";
import { binding as template, fixture, qualification } from "./fixtures";

afterEach(cleanupDatabase);
async function setup() {
  const owner = await freshDatabase(), signer = createLocalEd25519Signer("synthetic-runtime-compatibility");
  const resolver = { publicKeyForKeyId: async (key: string) => key === signer.keyId ? signer.publicKeyPem() : undefined };
  await db().execute(sql.raw(await readFile("lib/integrations/qualification.sql", "utf8")));
  const agent = await createAgent(owner.accountId, { name: "Synthetic Sofie", capabilities: ["github.repo.read"] });
  const runtime = await registerRuntimeClient({ accountId: owner.accountId, actorPrincipalId: owner.principalId, displayName: "Synthetic Sofie", selfDeclaredProduct: "MyEve" }, signer);
  await registerCapabilityDefinition({ name: "github.repo.read", version: "1.0", domain: "resource", description: "Synthetic read compatibility", effectClass: "read", riskClass: "low", resourceType: "integration_tool", inputSchema: {}, outputSchema: {}, meteringDimensions: [] }, signer);
  await publishRelaySafetyPolicy({ name: "synthetic-integration", rules: [{ id: "fixture", effect: "ALLOW", match: { capability: { name: "github.repo.read", version: "1.0" } }, reasonCode: "SYNTHETIC_COMPATIBILITY_ONLY" }] }, signer);
  await issueAgentPassport({ accountId: owner.accountId, agentId: agent.agentId, ownerPrincipalId: owner.principalId, policy: {
    trustTier: "HIGH_ASSURANCE", capabilityEligibility: [{ name: "github.repo.read", version: "1.0" }], policyReferences: ["synthetic-integration"], budgetReferences: [],
    allowedEnvironments: { providerIds: ["relay-managed"], minimumAssurance: "managed-equivalent" }, dataAccess: [], expiresAt: new Date(Date.now() + 3_600_000).toISOString() } }, signer);
  await publishEventRoute({ accountId: owner.accountId, actorPrincipalId: owner.principalId, name: "synthetic-integration", source: "https://synthetic.invalid", eventType: "synthetic.read", agentId: agent.agentId }, signer);
  const event = await ingestVerifiedEvent({ envelope: { specversion: "1.0", id: "synthetic-read", source: "https://synthetic.invalid", type: "synthetic.read", time: new Date().toISOString(), accountid: owner.accountId,
    classification: "internal", correlationid: "synthetic-read", dedupekey: "synthetic-read", schemaversion: "relay.event.v2", signaturestatus: "unverified", data: {} }, rawBody: new Uint8Array(), headers: {} }, { verify: async () => ({ valid: true }) }, signer);
  const taskId = event.taskIds[0], pair = generateKeyPairSync("ed25519");
  const bootstrap = await createWorkloadBootstrap({ accountId: owner.accountId, agentId: agent.agentId, runtimeClientId: runtime.runtimeClientId, taskId, providerId: "relay-managed", assurance: "managed-equivalent", audience: "synthetic-integration", publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString() }, signer);
  const workload = await exchangeWorkloadBootstrap({ accountId: owner.accountId, secret: bootstrap.secret, proofSignature: sign(null, Buffer.from(bootstrap.challenge), pair.privateKey).toString("base64url") }, signer);
  const scope = { accountId: owner.accountId, ownerPrincipalId: owner.principalId, agentId: agent.agentId, installationId: "synthetic-installation" };
  const binding = { ...template, ...scope, providerUserId: providerUserId(scope) };
  const base = { schemaVersion: "relay.integration-read.v1" as const, scope, connectionId: binding.connectionId, toolkit: binding.toolkit,
    tool: qualification.slug, toolVersion: qualification.version, toolSchemaHash: qualification.schemaHash, authorityVersion: 1,
    ownerPolicyRevision: 1, relayPolicyRevision: "pending", harnessId: "synthetic", effect: "READ" as const, targetResource: "assigned-issues", expiresAt: new Date(Date.now() + 10_000).toISOString() };
  // The revision is a canonical decision output, not a caller-generated admission flag.
  const material = { capability: { name: "github.repo.read", version: "1.0" }, resource: consumerResource(base, "synthetic-runtime-read"), parameters: { per_page: 10 } };
  let action = { schemaVersion: "relay.action-intent.v2" as const, id: "act_runtimefixture", accountId: scope.accountId, agentId: scope.agentId, runtimeClientId: runtime.runtimeClientId, taskId,
    workloadId: workload.workloadId, idempotencyKey: "synthetic-runtime-read", createdAt: new Date().toISOString(), ...material, canonicalHash: canonicalHash(material) };
  const ownership = { resolveOwnership: async () => ({ name: "resource.account_id", value: scope.accountId, authoritative: true, observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceRevision: "synthetic" }) };
  const decision = await evaluatePolicy({ accountId: scope.accountId, action, resourceResolver: ownership }, signer);
  const [decisionRecord] = await db().select().from(policyDecisions).where(eq(policyDecisions.id, decision.decisionId));
  base.relayPolicyRevision = canonicalHash(decisionRecord.policyBundleHashes);
  const corrected = { ...material, resource: consumerResource(base, action.idempotencyKey) };
  action = { ...action, ...corrected, canonicalHash: canonicalHash(corrected) };
  await evaluatePolicy({ accountId: scope.accountId, action, resourceResolver: ownership }, signer);
  const lease = await issueCapabilityLease({ accountId: scope.accountId, action, workloadId: workload.workloadId, workloadIdentityToken: workload.token, audience: "synthetic-integration", maxCalls: 1 }, signer, resolver);
  const [record] = await db().select().from(capabilityLeases).where(and(eq(capabilityLeases.accountId, scope.accountId), eq(capabilityLeases.id, lease.leaseId)));
  const provider = fixture(), store = new IntegrationConnectionStore(signer);
  await store.persistConfirmed(scope, binding, "synthetic-runtime-connect", provider.adapter);
  return { owner, scope, binding, agent, runtime, signer, resolver, workload, lease, record, provider, store, request: { ...base, action } };
}

describe("Canonical runtime compatibility does not bypass missing remote admission", () => {
  it("authenticates a real runtime and binds a canonical lease while leaving gateway execution and lease consumption closed", async () => {
    const f = await setup();
    expect(await authenticateDeveloperClient({ accountId: f.scope.accountId, credential: f.runtime.secret, expectedResource: "https://synthetic.invalid/api/v2" })).toMatchObject({ runtimeClientId: f.runtime.runtimeClientId });
    expect(bindExecution(f.scope, f.binding, qualification.slug, { per_page: 10 }, { request: f.request, lease: capabilityLeaseClaimsSchema.parse(f.record.claims) }).lease.jti).toBe(f.lease.leaseId);
    const gateway = new IntegrationGateway(f.provider.adapter, f.store);
    expect(await gateway.requestRead(f.agent.credential, f.request)).toMatchObject({ state: "NOT_DISPATCHED", code: "POLICY_UNAVAILABLE" });
    expect(await gateway.requestRead(f.agent.credential, f.request)).toMatchObject({ state: "NOT_DISPATCHED" });
    const [current] = await db().select().from(capabilityLeases).where(eq(capabilityLeases.id, f.lease.leaseId));
    expect(current.callCount).toBe(0); expect(f.provider.sdk.getClient().tools.execute).not.toHaveBeenCalled();
  });
  it("rejects wrong tenant, runtime revocation, wrong audience, changed arguments and revoked canonical lease", async () => {
    const f = await setup();
    await expect(authenticateDeveloperClient({ accountId: "acct_foreign", credential: f.runtime.secret, expectedResource: "https://synthetic.invalid/api/v2" })).rejects.toThrow();
    const call = { token: f.lease.token, expectedAccountId: f.scope.accountId, expectedAudience: "synthetic-integration", expectedWorkloadId: f.workload.workloadId, action: f.request.action, callId: "synthetic-call", online: true };
    await expect(authorizeLeaseCall({ ...call, expectedAudience: "foreign" }, f.resolver, f.signer)).rejects.toThrow();
    const changed = { ...f.request.action, parameters: { per_page: 9 } };
    changed.canonicalHash = canonicalHash({ capability: changed.capability, resource: changed.resource, parameters: changed.parameters });
    await expect(authorizeLeaseCall({ ...call, action: changed }, f.resolver, f.signer)).rejects.toThrow();
    await revokeLease({ accountId: f.scope.accountId, leaseId: f.lease.leaseId, reason: "synthetic-revoke" }, f.signer);
    await expect(authorizeLeaseCall(call, f.resolver, f.signer)).rejects.toThrow();
    await revokeRuntimeClient({ accountId: f.scope.accountId, actorPrincipalId: f.owner.principalId, runtimeClientId: f.runtime.runtimeClientId }, f.signer);
    await expect(authenticateDeveloperClient({ accountId: f.scope.accountId, credential: f.runtime.secret, expectedResource: "https://synthetic.invalid/api/v2" })).rejects.toThrow();
    expect(f.provider.sdk.getClient().tools.execute).not.toHaveBeenCalled();
  });
});
