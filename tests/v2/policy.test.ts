import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalHash, type ActionIntent } from "@/lib/v2/contracts";
import { completePasswordStepUp, createStepUpChallenge } from "@/lib/v2/identity";
import { createLocalEd25519Signer } from "@/lib/v2/evidence";
import { createV2Agent, issueAgentPassport } from "@/lib/v2/passports";
import { activateAccountPolicy, evaluatePolicy, evaluatePolicySnapshot, publishRelaySafetyPolicy, registerCapabilityDefinition, reproducePolicyDecision, stageAccountPolicy, type PolicyEvaluationSnapshot, type PolicyRule } from "@/lib/v2/policy";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

const definition = { name: "communications.message.send", version: "1.0", domain: "communications", description: "Send a message", effectClass: "communication" as const, riskClass: "high" as const, resourceType: "thread", inputSchema: {}, outputSchema: {} };
const baseRule = (effect: PolicyRule["effect"]): PolicyRule => ({ id: `golden-${effect.toLowerCase().replace("_", "-")}`, effect, match: { capability: { name: definition.name, version: definition.version } }, reasonCode: effect === "ALLOW" ? "ALLOWED_BY_POLICY" : effect === "DENY" ? "POLICY_DENIED" : effect === "REQUIRE_APPROVAL" ? "APPROVAL_REQUIRED" : effect === "LIMIT" ? "POLICY_LIMIT" : "RISK_ESCALATION", ...(effect === "REQUIRE_APPROVAL" ? { approval: { class: "external_communication", allowedScopes: ["once"] } } : {}), ...(effect === "LIMIT" ? { limits: { attachments: 0 } } : {}), ...(effect === "ESCALATE" ? { escalationTarget: "account_owner" } : {}) });

function action(accountId: string, agentId: string, resourceAccountId = accountId): ActionIntent {
  const material = { capability: { name: definition.name, version: definition.version }, resource: { type: "thread", ids: ["thread-1"], attributes: { accountId: resourceAccountId } }, parameters: { body: "hello" } };
  return { schemaVersion: "relay.action-intent.v2", id: `act_${crypto.randomUUID().replaceAll("-", "")}`, accountId, agentId, runtimeClientId: "rtc_12345678", taskId: "tsk_12345678", ...material, idempotencyKey: crypto.randomUUID(), createdAt: new Date().toISOString(), canonicalHash: canonicalHash(material) };
}

async function setup(rules: PolicyRule[]) {
  const { accountId, principalId } = await freshDatabase();
  const signer = createLocalEd25519Signer();
  await registerCapabilityDefinition(definition, signer);
  await publishRelaySafetyPolicy({ name: "safety-floor", rules }, signer);
  const agent = await createV2Agent({ accountId, ownerPrincipalId: principalId, name: "Policy Agent" }, signer);
  await issueAgentPassport({ accountId, agentId: agent.agentId, ownerPrincipalId: principalId, policy: { trustTier: "VERIFIED", capabilityEligibility: [{ name: definition.name, version: definition.version }], policyReferences: ["safety-floor"], budgetReferences: [], allowedEnvironments: { providerIds: ["relay-managed"], minimumAssurance: "managed-equivalent" }, dataAccess: [{ classification: "internal", resourceTypes: ["thread"] }], expiresAt: "2099-01-01T00:00:00.000Z" } }, signer);
  return { accountId, principalId, agentId: agent.agentId, signer };
}

const resourceResolver = (ownerAccountId?: string) => ({ resolveOwnership: async ({ accountId }: { accountId: string }) => ({ name: "resource.account_id", value: ownerAccountId ?? accountId, authoritative: true, observedAt: new Date(Date.now() - 1_000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceRevision: "resource:1" }) });

describe("Relay V2 capability registry and policy engine", () => {
  afterEach(cleanupDatabase);

  it("produces deterministic golden outcomes and intersects obligations", () => {
    const makeSnapshot = (rules: PolicyRule[]): PolicyEvaluationSnapshot => ({ action: action("acct_12345678", "agt_12345678"), capability: definition, passport: { schemaVersion: "relay.agent-passport.v1", issuer: "https://relay.local", passportId: "psp_12345678", agentId: "agt_12345678", owner: { accountId: "acct_12345678", principalId: "prn_12345678" }, version: 1, trustTier: "VERIFIED", capabilityEligibility: [{ name: definition.name, version: definition.version }], policyReferences: [], budgetReferences: [], allowedEnvironments: { providerIds: [], minimumAssurance: "registered" }, dataAccess: [], validFrom: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", revocationEpoch: 0 }, bundles: [{ schemaVersion: "relay.policy-bundle.v1", accountId: null, name: "golden", layer: "RELAY_SAFETY", version: 1, rules }], facts: [{ name: "resource.account_id", value: "acct_12345678", authoritative: true, observedAt: "2026-09-12T00:00:00.000Z", expiresAt: "2026-09-14T00:00:00.000Z", sourceRevision: "resource:1" }], evaluatedAt: "2026-09-13T00:00:00.000Z" });
    for (const effect of ["ALLOW", "DENY", "REQUIRE_APPROVAL", "LIMIT", "ESCALATE"] as const) expect(evaluatePolicySnapshot(makeSnapshot([baseRule(effect)]))).toMatchObject({ outcome: effect });
    const intersected = evaluatePolicySnapshot(makeSnapshot([{ ...baseRule("LIMIT"), id: "limit-a", limits: { calls: 10, bytes: 1_000 } }, { ...baseRule("LIMIT"), id: "limit-b", limits: { calls: 3 } }]));
    expect(intersected).toMatchObject({ outcome: "LIMIT", obligations: { limits: { calls: 3, bytes: 1_000 } } });
  });

  it("persists and reproduces the exact historic decision", async () => {
    const { accountId, agentId, signer } = await setup([baseRule("REQUIRE_APPROVAL")]);
    const decision = await evaluatePolicy({ accountId, action: action(accountId, agentId), resourceResolver: resourceResolver() }, signer);
    expect(decision).toMatchObject({ outcome: "REQUIRE_APPROVAL", obligations: { approval: { classes: ["external_communication"], allowedScopes: ["once"] } } });
    await expect(reproducePolicyDecision(accountId, decision.decisionId)).resolves.toMatchObject({ matches: true });
    const otherAccountId = await secondAccount();
    await expect(reproducePolicyDecision(otherAccountId, decision.decisionId)).rejects.toMatchObject({ status: 404 });
  });

  it("accepts an authoritative fact observed while the resolver is running", async () => {
    const { accountId, agentId, signer } = await setup([baseRule("ALLOW")]);
    const decision = await evaluatePolicy({
      accountId,
      action: action(accountId, agentId),
      resourceResolver: {
        resolveOwnership: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { name: "resource.account_id", value: accountId, authoritative: true, observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceRevision: "resource:delayed" };
        },
      },
    }, signer);
    expect(decision).toMatchObject({ outcome: "ALLOW" });
  });

  it("fails closed for missing, stale, and conflicting authoritative facts", async () => {
    const factRule: PolicyRule = { ...baseRule("ALLOW"), id: "known-recipient", match: { capability: { name: definition.name, version: definition.version }, facts: { "recipient.relationship": "known" } } };
    const { accountId, agentId, signer } = await setup([factRule]);
    const missing = await evaluatePolicy({ accountId, action: action(accountId, agentId), resourceResolver: resourceResolver() }, signer);
    expect(missing).toMatchObject({ outcome: "DENY", reasonCodes: ["MISSING_AUTHORITATIVE_FACT"] });
    await expect(reproducePolicyDecision(accountId, missing.decisionId)).resolves.toMatchObject({ matches: true });
    const staleResolver = { name: "recipient.relationship", resolve: async () => ({ name: "recipient.relationship", value: "known" as const, authoritative: true, observedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02T00:00:00.000Z", sourceRevision: "contacts:1" }) };
    await expect(evaluatePolicy({ accountId, action: action(accountId, agentId), resourceResolver: resourceResolver(), factResolvers: [staleResolver] }, signer)).resolves.toMatchObject({ outcome: "DENY", reasonCodes: ["MISSING_AUTHORITATIVE_FACT"] });
    const fresh = (value: "known" | "new") => ({ name: "recipient.relationship", resolve: async () => ({ name: "recipient.relationship", value, authoritative: true, observedAt: new Date(Date.now() - 1_000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceRevision: `contacts:${value}` }) });
    const conflicting = await evaluatePolicy({ accountId, action: action(accountId, agentId), resourceResolver: resourceResolver(), factResolvers: [fresh("known"), fresh("new")] }, signer);
    expect(conflicting).toMatchObject({ outcome: "DENY", reasonCodes: ["CONFLICTING_POLICY"] });
    await expect(reproducePolicyDecision(accountId, conflicting.decisionId)).resolves.toMatchObject({ matches: true });
  });

  it("requires action-bound step-up to activate account policy and rejects tenant substitution", async () => {
    const { accountId, principalId, agentId, signer } = await setup([baseRule("ALLOW")]);
    const staged = await stageAccountPolicy({ accountId, actorPrincipalId: principalId, name: "account-policy", layer: "ACCOUNT", rules: [baseRule("LIMIT")] }, signer);
    const otherAccountId = await secondAccount();
    await expect(activateAccountPolicy({ accountId: otherAccountId, actorPrincipalId: principalId, bundleId: staged.bundleId, stepUpChallengeId: "stp_missing00" }, signer)).rejects.toMatchObject({ status: 403 });
    const challenge = await createStepUpChallenge({ accountId, principalId, actionClass: "policy.activate", actionHash: staged.bundleHash, authenticationMethod: "password" });
    const completed = await completePasswordStepUp({ accountId, principalId, secret: challenge.secret, password: "correct-horse-battery-staple", actionClass: "policy.activate", actionHash: staged.bundleHash });
    await activateAccountPolicy({ accountId, actorPrincipalId: principalId, bundleId: staged.bundleId, stepUpChallengeId: completed.id }, signer);
    await expect(evaluatePolicy({ accountId, action: action(accountId, agentId, otherAccountId), resourceResolver: resourceResolver(otherAccountId) }, signer)).resolves.toMatchObject({ outcome: "DENY", reasonCodes: ["TENANT_MISMATCH"] });
  });

  it("keeps pure policy simulation within its local latency budget", () => {
    const snapshot: PolicyEvaluationSnapshot = { action: action("acct_12345678", "agt_12345678"), capability: definition, passport: { schemaVersion: "relay.agent-passport.v1", issuer: "https://relay.local", passportId: "psp_12345678", agentId: "agt_12345678", owner: { accountId: "acct_12345678", principalId: "prn_12345678" }, version: 1, trustTier: "VERIFIED", capabilityEligibility: [{ name: definition.name, version: definition.version }], policyReferences: [], budgetReferences: [], allowedEnvironments: { providerIds: [], minimumAssurance: "registered" }, dataAccess: [], validFrom: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", revocationEpoch: 0 }, bundles: [{ schemaVersion: "relay.policy-bundle.v1", accountId: null, name: "bench", layer: "RELAY_SAFETY", version: 1, rules: [baseRule("ALLOW")] }], facts: [{ name: "resource.account_id", value: "acct_12345678", authoritative: true, observedAt: "2026-09-12T00:00:00.000Z", expiresAt: "2026-09-14T00:00:00.000Z", sourceRevision: "resource:1" }], evaluatedAt: "2026-09-13T00:00:00.000Z" };
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) evaluatePolicySnapshot(snapshot);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
