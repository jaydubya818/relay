import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accountMemberships, approvalDecisions, approvalNotifications, approvalRequests, principals } from "@/lib/db/schema";
import { id, now } from "@/lib/ids";
import { consumeApproval, createApprovalRequest, decideApproval, listApprovalRequests } from "@/lib/v2/approvals";
import { canonicalHash, type ActionIntent, type ApprovalScope } from "@/lib/v2/contracts";
import { createLocalEd25519Signer, verifyAuditSignature } from "@/lib/v2/evidence";
import { createV2Agent, issueAgentPassport } from "@/lib/v2/passports";
import { evaluatePolicy, publishRelaySafetyPolicy, registerCapabilityDefinition, type PolicyRule } from "@/lib/v2/policy";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

const authenticationEvidence = () => ({ sessionId: "ses_authenticated", method: "password" as const, authenticatedAt: new Date().toISOString() });
const ownership = (owner?: string) => ({ resolveOwnership: async ({ accountId }: { accountId: string }) => ({ name: "resource.account_id", value: owner ?? accountId, authoritative: true, observedAt: new Date(Date.now() - 100).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceRevision: "resource:1" }) });

function action(accountId: string, agentId: string, capabilityName: string, parameters: Record<string, unknown> = { value: "original" }): ActionIntent {
  const material = { capability: { name: capabilityName, version: "1.0" }, resource: { type: "target", ids: ["target-1"], attributes: { accountId } }, parameters };
  return { schemaVersion: "relay.action-intent.v2", id: `act_${crypto.randomUUID().replaceAll("-", "")}`, accountId, agentId, runtimeClientId: "rtc_12345678", taskId: "tsk_12345678", ...material, idempotencyKey: crypto.randomUUID(), createdAt: new Date().toISOString(), canonicalHash: canonicalHash(material) };
}

async function setup(effectClass: "communication" | "destructive" | "financial", relationship?: "known" | "new") {
  const { accountId, principalId } = await freshDatabase();
  const signer = createLocalEd25519Signer();
  const capabilityName = `${effectClass}.test.execute`;
  await registerCapabilityDefinition({ name: capabilityName, version: "1.0", domain: effectClass, description: "Approval fixture", effectClass, riskClass: "high", resourceType: "target", inputSchema: {}, outputSchema: {} }, signer);
  const rule: PolicyRule = { id: "approval-required", effect: "REQUIRE_APPROVAL", match: { capability: { name: capabilityName, version: "1.0" }, ...(relationship ? { facts: { "recipient.relationship": relationship } } : {}) }, reasonCode: "APPROVAL_REQUIRED", approval: { class: effectClass === "communication" ? "external_communication" : effectClass, allowedScopes: ["once", "task", "session"] } };
  await publishRelaySafetyPolicy({ name: "approval-floor", rules: [rule] }, signer);
  const created = await createV2Agent({ accountId, ownerPrincipalId: principalId, name: "Approval Agent" }, signer);
  await issueAgentPassport({ accountId, agentId: created.agentId, ownerPrincipalId: principalId, policy: { trustTier: "VERIFIED", capabilityEligibility: [{ name: capabilityName, version: "1.0" }], policyReferences: ["approval-floor"], budgetReferences: [], allowedEnvironments: { providerIds: ["relay-managed"], minimumAssurance: "managed-equivalent" }, dataAccess: [], expiresAt: "2099-01-01T00:00:00.000Z" } }, signer);
  const proposed = action(accountId, created.agentId, capabilityName, { message: "hello", apiKey: "restricted-canary-value" });
  const relationshipResolver = relationship ? [{ name: "recipient.relationship", resolve: async () => ({ name: "recipient.relationship", value: relationship, authoritative: true, observedAt: new Date(Date.now() - 100).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceRevision: "contacts:1" }) }] : [];
  const policy = await evaluatePolicy({ accountId, action: proposed, resourceResolver: ownership(), factResolvers: relationshipResolver }, signer);
  return { accountId, principalId, agentId: created.agentId, capabilityName, signer, proposed, policy };
}

async function requestFor(fixture: Awaited<ReturnType<typeof setup>>, assignedPrincipalIds = [fixture.principalId]) {
  return await createApprovalRequest({ accountId: fixture.accountId, action: fixture.proposed, policyDecisionId: fixture.policy.decisionId, approvalClass: fixture.proposed.capability.name.startsWith("communication") ? "external_communication" : fixture.proposed.capability.name.split(".")[0]!, summary: "Send the exact message", consequence: "A third party receives data", displayEvidence: { recipient: "person@example.com", apiKey: "restricted-canary-value" }, assignedPrincipalIds, sessionId: "ses_execution1", expiresAt: "2099-01-01T00:00:00.000Z" }, fixture.signer);
}

describe("Relay V2 approvals", () => {
  afterEach(cleanupDatabase);

  it("binds a signed once approval to the exact action and consumes it atomically", async () => {
    const fixture = await setup("communication", "new");
    const request = await requestFor(fixture);
    expect(request.allowedScopes).toEqual(["once"]);
    const scope: ApprovalScope = { kind: "once", actionHash: fixture.proposed.canonicalHash };
    const decision = await decideApproval({ accountId: fixture.accountId, requestId: request.requestId, principalId: fixture.principalId, decision: "APPROVE", scope, authenticationEvidence: authenticationEvidence() }, fixture.signer);
    expect(verifyAuditSignature(await fixture.signer.publicKeyPem(), decision.decisionHash, decision.signature)).toBe(true);
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => consumeApproval({ accountId: fixture.accountId, requestId: request.requestId, action: fixture.proposed, currentPolicyDecisionId: fixture.policy.decisionId }, fixture.signer)));
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(7);
  });

  it("rejects modified actions, stale policy, wrong approvers, expiry, and cross-account access", async () => {
    const fixture = await setup("communication", "new");
    const otherPrincipalId = id("prn");
    await db().insert(principals).values({ id: otherPrincipalId, type: "SERVICE", displayName: "Unassigned approver", createdAt: now(), updatedAt: now() });
    await db().insert(accountMemberships).values({ accountId: fixture.accountId, principalId: otherPrincipalId, role: "APPROVER", createdAt: now(), updatedAt: now() });
    const request = await requestFor(fixture);
    const scope: ApprovalScope = { kind: "once", actionHash: fixture.proposed.canonicalHash };
    await expect(decideApproval({ accountId: fixture.accountId, requestId: request.requestId, principalId: otherPrincipalId, decision: "APPROVE", scope, authenticationEvidence: authenticationEvidence() }, fixture.signer)).rejects.toMatchObject({ status: 403 });
    await decideApproval({ accountId: fixture.accountId, requestId: request.requestId, principalId: fixture.principalId, decision: "APPROVE", scope, authenticationEvidence: authenticationEvidence() }, fixture.signer);
    const changed = action(fixture.accountId, fixture.agentId, fixture.capabilityName, { message: "changed" });
    await expect(consumeApproval({ accountId: fixture.accountId, requestId: request.requestId, action: changed, currentPolicyDecisionId: fixture.policy.decisionId }, fixture.signer)).rejects.toMatchObject({ status: 403 });
    await expect(consumeApproval({ accountId: fixture.accountId, requestId: request.requestId, action: fixture.proposed, currentPolicyDecisionId: "dec_stale000" }, fixture.signer)).rejects.toMatchObject({ status: 403 });
    await db().update(approvalRequests).set({ expiresAt: "2020-01-01T00:00:00.000Z" }).where(eq(approvalRequests.id, request.requestId));
    await expect(consumeApproval({ accountId: fixture.accountId, requestId: request.requestId, action: fixture.proposed, currentPolicyDecisionId: fixture.policy.decisionId }, fixture.signer)).rejects.toMatchObject({ status: 403 });
    const otherAccountId = await secondAccount();
    expect(await listApprovalRequests(otherAccountId)).toEqual([]);
  });

  it("allows a bounded repeated task scope only for an identical approved template", async () => {
    const fixture = await setup("communication", "known");
    const request = await requestFor(fixture);
    expect(request.allowedScopes).toEqual(["once", "task", "session"]);
    const scope: ApprovalScope = { kind: "task", taskId: fixture.proposed.taskId, capability: fixture.proposed.capability, resource: fixture.proposed.resource, maxUses: 2 };
    await decideApproval({ accountId: fixture.accountId, requestId: request.requestId, principalId: fixture.principalId, decision: "APPROVE", scope, authenticationEvidence: authenticationEvidence() }, fixture.signer);
    const repeat = () => ({ ...fixture.proposed, id: `act_${crypto.randomUUID().replaceAll("-", "")}`, idempotencyKey: crypto.randomUUID() });
    await expect(consumeApproval({ accountId: fixture.accountId, requestId: request.requestId, action: repeat(), currentPolicyDecisionId: fixture.policy.decisionId }, fixture.signer)).resolves.toMatchObject({ remainingUses: 1 });
    await expect(consumeApproval({ accountId: fixture.accountId, requestId: request.requestId, action: repeat(), currentPolicyDecisionId: fixture.policy.decisionId }, fixture.signer)).resolves.toMatchObject({ remainingUses: 0 });
    await expect(consumeApproval({ accountId: fixture.accountId, requestId: request.requestId, action: repeat(), currentPolicyDecisionId: fixture.policy.decisionId }, fixture.signer)).rejects.toMatchObject({ status: 409 });
  });

  it.each(["financial", "destructive"] as const)("cannot weaken the %s once-approval floor", async (effectClass) => {
    const fixture = await setup(effectClass);
    const request = await requestFor(fixture);
    expect(request.allowedScopes).toEqual(["once"]);
    const taskScope: ApprovalScope = { kind: "task", taskId: fixture.proposed.taskId, capability: fixture.proposed.capability, resource: fixture.proposed.resource, maxUses: 10 };
    await expect(decideApproval({ accountId: fixture.accountId, requestId: request.requestId, principalId: fixture.principalId, decision: "APPROVE", scope: taskScope, authenticationEvidence: authenticationEvidence() }, fixture.signer)).rejects.toMatchObject({ status: 403 });
  });

  it("persists redacted approval evidence and tenant-scoped notifications", async () => {
    const fixture = await setup("communication", "new");
    const request = await requestFor(fixture);
    const [stored] = await db().select().from(approvalRequests).where(eq(approvalRequests.id, request.requestId));
    expect(JSON.stringify(stored)).not.toContain("restricted-canary-value");
    expect(stored?.displayEvidence).toMatchObject({ recipient: "person@example.com", apiKey: "[REDACTED]" });
    const notifications = await db().select().from(approvalNotifications).where(eq(approvalNotifications.accountId, fixture.accountId));
    expect(notifications).toHaveLength(1);
    expect(await db().select().from(approvalNotifications).where(eq(approvalNotifications.accountId, await secondAccount()))).toEqual([]);
    await decideApproval({ accountId: fixture.accountId, requestId: request.requestId, principalId: fixture.principalId, decision: "DENY", reason: "Not now", authenticationEvidence: authenticationEvidence() }, fixture.signer);
    expect(await db().select().from(approvalDecisions).where(eq(approvalDecisions.accountId, fixture.accountId))).toHaveLength(1);
  });
});
