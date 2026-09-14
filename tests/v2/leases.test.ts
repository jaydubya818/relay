import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createApprovalRequest, decideApproval } from "@/lib/v2/approvals";
import { createBudget, releaseBudgetReservation, reserveBudget } from "@/lib/v2/budgets";
import { canonicalHash, type ActionIntent } from "@/lib/v2/contracts";
import { createLocalEd25519Signer } from "@/lib/v2/evidence";
import { authorizeLeaseCall, createWorkloadBootstrap, emergencyRevokeAgent, exchangeWorkloadBootstrap, introspectLease, issueCapabilityLease, revokeLease } from "@/lib/v2/leases";
import { createV2Agent, issueAgentPassport } from "@/lib/v2/passports";
import { evaluatePolicy, publishRelaySafetyPolicy, registerCapabilityDefinition, type PolicyRule } from "@/lib/v2/policy";
import { registerRuntimeClient } from "@/lib/v2/runtime-clients";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

function proposedAction(accountId: string, agentId: string, runtimeClientId: string, capabilityName: string, target = "target-1"): ActionIntent {
  const material = { capability: { name: capabilityName, version: "1.0" }, resource: { type: "target", ids: [target], attributes: { accountId } }, parameters: { operation: "read" } };
  return { schemaVersion: "relay.action-intent.v2", id: `act_${crypto.randomUUID().replaceAll("-", "")}`, accountId, agentId, runtimeClientId, taskId: "tsk_12345678", ...material, idempotencyKey: crypto.randomUUID(), createdAt: new Date().toISOString(), canonicalHash: canonicalHash(material) };
}

async function setup(effectClass: "read" | "financial" = "read", policyEffect: "ALLOW" | "REQUIRE_APPROVAL" = "ALLOW", meteringDimensions: Array<"TOKENS"> = []) {
  const { accountId, principalId } = await freshDatabase();
  const signer = createLocalEd25519Signer("lease-key");
  const resolver = { publicKeyForKeyId: async (keyId: string) => keyId === signer.keyId ? await signer.publicKeyPem() : undefined };
  const runtime = await registerRuntimeClient({ accountId, actorPrincipalId: principalId, displayName: "Runner client", selfDeclaredProduct: "custom" }, signer);
  const capabilityName = `${capabilityDomain(effectClass)}.lease.execute`;
  await registerCapabilityDefinition({ name: capabilityName, version: "1.0", domain: effectClass, description: "Lease fixture", effectClass, riskClass: effectClass === "financial" ? "critical" : "low", resourceType: "target", inputSchema: {}, outputSchema: {}, meteringDimensions }, signer);
  const rule: PolicyRule = { id: "lease-policy", effect: policyEffect, match: { capability: { name: capabilityName, version: "1.0" } }, reasonCode: policyEffect === "ALLOW" ? "ALLOWED_BY_POLICY" : "APPROVAL_REQUIRED", ...(policyEffect === "REQUIRE_APPROVAL" ? { approval: { class: effectClass === "financial" ? "financial" : "test", allowedScopes: ["once"] } } : {}) };
  await publishRelaySafetyPolicy({ name: "lease-safety", rules: [rule] }, signer);
  const agent = await createV2Agent({ accountId, ownerPrincipalId: principalId, name: "Lease Agent" }, signer);
  await issueAgentPassport({ accountId, agentId: agent.agentId, ownerPrincipalId: principalId, policy: { trustTier: "HIGH_ASSURANCE", capabilityEligibility: [{ name: capabilityName, version: "1.0" }], policyReferences: ["lease-safety"], budgetReferences: [], allowedEnvironments: { providerIds: ["relay-managed"], minimumAssurance: "managed-equivalent" }, dataAccess: [], expiresAt: "2099-01-01T00:00:00.000Z" } }, signer);
  const action = proposedAction(accountId, agent.agentId, runtime.runtimeClientId, capabilityName);
  const policy = await evaluatePolicy({ accountId, action, resourceResolver: { resolveOwnership: async () => ({ name: "resource.account_id", value: accountId, authoritative: true, observedAt: new Date(Date.now() - 100).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceRevision: "target:1" }) } }, signer);
  const pair = generateKeyPairSync("ed25519");
  const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const bootstrap = await createWorkloadBootstrap({ accountId, agentId: agent.agentId, runtimeClientId: runtime.runtimeClientId, taskId: action.taskId, providerId: "relay-managed", assurance: "managed-equivalent", audience: "relay-pep", publicKeyPem }, signer);
  const workload = await exchangeWorkloadBootstrap({ accountId, secret: bootstrap.secret, proofSignature: sign(null, Buffer.from(bootstrap.challenge), pair.privateKey).toString("base64url") }, signer);
  return { accountId, principalId, signer, resolver, runtimeClientId: runtime.runtimeClientId, agentId: agent.agentId, capabilityName, action, policy, bootstrap, workload };
}

function capabilityDomain(value: string) { return value === "read" ? "resource" : value; }

describe("Relay V2 capability leases and workload identity", () => {
  afterEach(cleanupDatabase);

  it("uses one-time proof-of-possession workload bootstrap with tenant binding", async () => {
    const fixture = await setup();
    await expect(exchangeWorkloadBootstrap({ accountId: fixture.accountId, secret: fixture.bootstrap.secret, proofSignature: "replayed" }, fixture.signer)).rejects.toMatchObject({ status: 401 });
    const otherAccountId = await secondAccount();
    await expect(exchangeWorkloadBootstrap({ accountId: otherAccountId, secret: fixture.bootstrap.secret, proofSignature: "replayed" }, fixture.signer)).rejects.toMatchObject({ status: 401 });
  });

  it("requires and atomically binds an action-scoped reservation for metered capabilities", async () => {
    const fixture = await setup("read", "ALLOW", ["TOKENS"]);
    await expect(issueCapabilityLease({ accountId: fixture.accountId, action: fixture.action, workloadId: fixture.workload.workloadId, workloadIdentityToken: fixture.workload.token, audience: "relay-pep", maxCalls: 1 }, fixture.signer, fixture.resolver)).rejects.toMatchObject({ status: 403 });
    const budget = await createBudget({ accountId: fixture.accountId, actorPrincipalId: fixture.principalId, scope: "TASK", scopeId: fixture.action.taskId, dimension: "TOKENS", unit: "token", hardLimit: "100" }, fixture.signer);
    const reservation = await reserveBudget({ accountId: fixture.accountId, leafBudgetId: budget.budgetId, agentId: fixture.agentId, taskId: fixture.action.taskId, actionIntentId: fixture.action.id, amount: "10", idempotencyKey: "lease-meter", expiresAt: new Date(Date.now() + 60_000).toISOString() }, fixture.signer);
    const lease = await issueCapabilityLease({ accountId: fixture.accountId, action: fixture.action, workloadId: fixture.workload.workloadId, workloadIdentityToken: fixture.workload.token, audience: "relay-pep", maxCalls: 1, budgetReservationId: reservation.reservationId }, fixture.signer, fixture.resolver);
    await expect(issueCapabilityLease({ accountId: fixture.accountId, action: fixture.action, workloadId: fixture.workload.workloadId, workloadIdentityToken: fixture.workload.token, audience: "relay-pep", maxCalls: 1, budgetReservationId: reservation.reservationId }, fixture.signer, fixture.resolver)).rejects.toMatchObject({ status: 403 });
    await releaseBudgetReservation({ accountId: fixture.accountId, reservationId: reservation.reservationId }, fixture.signer);
    await expect(authorizeLeaseCall({ token: lease.token, expectedAccountId: fixture.accountId, expectedAudience: "relay-pep", expectedWorkloadId: fixture.workload.workloadId, action: fixture.action, callId: "after-budget-release", online: true }, fixture.resolver, fixture.signer)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects wrong tenant, audience, workload, resource, replay, and exhaustion at the reference PEP", async () => {
    const fixture = await setup();
    const lease = await issueCapabilityLease({ accountId: fixture.accountId, action: fixture.action, workloadId: fixture.workload.workloadId, workloadIdentityToken: fixture.workload.token, audience: "relay-pep", maxCalls: 2 }, fixture.signer, fixture.resolver);
    const base = { token: lease.token, expectedAccountId: fixture.accountId, expectedAudience: "relay-pep", expectedWorkloadId: fixture.workload.workloadId, action: fixture.action, callId: "call-1", online: true };
    await expect(authorizeLeaseCall({ ...base, expectedAccountId: await secondAccount() }, fixture.resolver, fixture.signer)).rejects.toMatchObject({ status: 403 });
    await expect(authorizeLeaseCall({ ...base, expectedAudience: "wrong" }, fixture.resolver, fixture.signer)).rejects.toMatchObject({ status: 403 });
    await expect(authorizeLeaseCall({ ...base, expectedWorkloadId: "wkl_wrong000" }, fixture.resolver, fixture.signer)).rejects.toMatchObject({ status: 403 });
    const otherAction = proposedAction(fixture.accountId, fixture.agentId, fixture.runtimeClientId, fixture.capabilityName, "target-2");
    await expect(authorizeLeaseCall({ ...base, action: otherAction }, fixture.resolver, fixture.signer)).rejects.toMatchObject({ status: 403 });
    const tokenParts = lease.token.split(".");
    const tamperedToken = `${tokenParts[0]}.${tokenParts[1]!.slice(0, -1)}A.${tokenParts[2]}`;
    await expect(authorizeLeaseCall({ ...base, token: tamperedToken }, fixture.resolver, fixture.signer)).rejects.toMatchObject({ status: 401 });
    await expect(authorizeLeaseCall(base, fixture.resolver, fixture.signer)).resolves.toMatchObject({ remainingCalls: 1 });
    await expect(authorizeLeaseCall(base, fixture.resolver, fixture.signer)).rejects.toMatchObject({ status: 409 });
    await expect(authorizeLeaseCall({ ...base, callId: "call-2" }, fixture.resolver, fixture.signer)).resolves.toMatchObject({ remainingCalls: 0 });
    await expect(introspectLease(fixture.accountId, lease.leaseId)).resolves.toMatchObject({ active: false, reason: "EXHAUSTED" });
  });

  it("atomically consumes approval while issuing a consequential lease", async () => {
    const fixture = await setup("financial", "REQUIRE_APPROVAL");
    const request = await createApprovalRequest({ accountId: fixture.accountId, action: fixture.action, policyDecisionId: fixture.policy.decisionId, approvalClass: "financial", summary: "Pay merchant", consequence: "Money may leave the account", displayEvidence: { amount: 20, currency: "USD", merchant: "Example" }, assignedPrincipalIds: [fixture.principalId], expiresAt: "2099-01-01T00:00:00.000Z" }, fixture.signer);
    await decideApproval({ accountId: fixture.accountId, requestId: request.requestId, principalId: fixture.principalId, decision: "APPROVE", scope: { kind: "once", actionHash: fixture.action.canonicalHash }, authenticationEvidence: { sessionId: "ses_approved1", method: "password", authenticatedAt: new Date().toISOString() } }, fixture.signer);
    const issued = await issueCapabilityLease({ accountId: fixture.accountId, action: fixture.action, workloadId: fixture.workload.workloadId, workloadIdentityToken: fixture.workload.token, audience: "relay-pep", maxCalls: 1, approvalRequestId: request.requestId, allowOffline: true }, fixture.signer, fixture.resolver);
    expect(issued).toMatchObject({ maxCalls: 1, onlineRequired: true });
    await expect(authorizeLeaseCall({ token: issued.token, expectedAccountId: fixture.accountId, expectedAudience: "relay-pep", expectedWorkloadId: fixture.workload.workloadId, action: fixture.action, callId: "offline-financial", online: false }, fixture.resolver, fixture.signer, { consume: async () => true })).rejects.toMatchObject({ status: 403 });
    await expect(issueCapabilityLease({ accountId: fixture.accountId, action: fixture.action, workloadId: fixture.workload.workloadId, workloadIdentityToken: fixture.workload.token, audience: "relay-pep", maxCalls: 1, approvalRequestId: request.requestId }, fixture.signer, fixture.resolver)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects child leases after parent revocation and reserves parent call authority", async () => {
    const fixture = await setup();
    const parent = await issueCapabilityLease({ accountId: fixture.accountId, action: fixture.action, workloadId: fixture.workload.workloadId, workloadIdentityToken: fixture.workload.token, audience: "relay-pep", maxCalls: 3 }, fixture.signer, fixture.resolver);
    const child = await issueCapabilityLease({ accountId: fixture.accountId, action: fixture.action, workloadId: fixture.workload.workloadId, workloadIdentityToken: fixture.workload.token, audience: "relay-pep", maxCalls: 2, parentLeaseId: parent.leaseId }, fixture.signer, fixture.resolver);
    await expect(authorizeLeaseCall({ token: parent.token, expectedAccountId: fixture.accountId, expectedAudience: "relay-pep", expectedWorkloadId: fixture.workload.workloadId, action: fixture.action, callId: "parent-over-reserved", online: true }, fixture.resolver, fixture.signer)).resolves.toMatchObject({ remainingCalls: 0 });
    await expect(authorizeLeaseCall({ token: parent.token, expectedAccountId: fixture.accountId, expectedAudience: "relay-pep", expectedWorkloadId: fixture.workload.workloadId, action: fixture.action, callId: "parent-exhausted", online: true }, fixture.resolver, fixture.signer)).rejects.toMatchObject({ status: 403 });
    await revokeLease({ accountId: fixture.accountId, leaseId: parent.leaseId, reason: "parent cancelled" }, fixture.signer);
    await expect(authorizeLeaseCall({ token: child.token, expectedAccountId: fixture.accountId, expectedAudience: "relay-pep", expectedWorkloadId: fixture.workload.workloadId, action: fixture.action, callId: "child-call", online: true }, fixture.resolver, fixture.signer)).rejects.toMatchObject({ status: 403 });
  });

  it("propagates emergency revocation within the online five-second SLO", async () => {
    const fixture = await setup();
    const lease = await issueCapabilityLease({ accountId: fixture.accountId, action: fixture.action, workloadId: fixture.workload.workloadId, workloadIdentityToken: fixture.workload.token, audience: "relay-pep", maxCalls: 2 }, fixture.signer, fixture.resolver);
    const started = performance.now();
    await emergencyRevokeAgent(fixture.accountId, fixture.agentId, fixture.signer);
    await expect(authorizeLeaseCall({ token: lease.token, expectedAccountId: fixture.accountId, expectedAudience: "relay-pep", expectedWorkloadId: fixture.workload.workloadId, action: fixture.action, callId: "after-revoke", online: true }, fixture.resolver, fixture.signer)).rejects.toMatchObject({ status: 403 });
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it("denies offline financial leases and detects cryptographic expiry", async () => {
    const financial = await setup("financial");
    await expect(issueCapabilityLease({ accountId: financial.accountId, action: financial.action, workloadId: financial.workload.workloadId, workloadIdentityToken: financial.workload.token, audience: "relay-pep", maxCalls: 1, allowOffline: true }, financial.signer, financial.resolver)).rejects.toMatchObject({ status: 403 });
    await cleanupDatabase();
    const expiring = await setup();
    const shortLease = await issueCapabilityLease({ accountId: expiring.accountId, action: expiring.action, workloadId: expiring.workload.workloadId, workloadIdentityToken: expiring.workload.token, audience: "relay-pep", maxCalls: 1, ttlSeconds: 1 }, expiring.signer, expiring.resolver);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await expect(authorizeLeaseCall({ token: shortLease.token, expectedAccountId: expiring.accountId, expectedAudience: "relay-pep", expectedWorkloadId: expiring.workload.workloadId, action: expiring.action, callId: "expired", online: true }, expiring.resolver, expiring.signer)).rejects.toMatchObject({ status: 403 });
  });

  it("permits only short low-risk read leases through an offline local counter", async () => {
    const fixture = await setup();
    const lease = await issueCapabilityLease({ accountId: fixture.accountId, action: fixture.action, workloadId: fixture.workload.workloadId, workloadIdentityToken: fixture.workload.token, audience: "relay-pep", maxCalls: 1, ttlSeconds: 30, allowOffline: true }, fixture.signer, fixture.resolver);
    expect(lease.onlineRequired).toBe(false);
    const seen = new Set<string>();
    const counter = { consume: async (_leaseId: string, callId: string, maxCalls: number) => { if (seen.has(callId) || seen.size >= maxCalls) return false; seen.add(callId); return true; } };
    const request = { token: lease.token, expectedAccountId: fixture.accountId, expectedAudience: "relay-pep", expectedWorkloadId: fixture.workload.workloadId, action: fixture.action, callId: "offline-1", online: false };
    await expect(authorizeLeaseCall(request, fixture.resolver, fixture.signer, counter)).resolves.toMatchObject({ enforcement: "OFFLINE" });
    await expect(authorizeLeaseCall(request, fixture.resolver, fixture.signer, counter)).rejects.toMatchObject({ status: 409 });
  });
});
