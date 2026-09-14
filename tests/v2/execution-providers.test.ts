import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { executionProviderDefinitions, v2Tasks } from "@/lib/db/schema";
import { canonicalHash, type ActionIntent } from "@/lib/v2/contracts";
import { createLocalEd25519Signer } from "@/lib/v2/evidence";
import { ExecutionProviderRegistry, ProviderDispatchError, listExecutionAttempts, listExecutionPlacements, publishExecutionProvider, qualifyExecutionProvider, reportExecutionProviderOutcome, scheduleExecution, startScheduledExecution, type ExecutionProviderAdapter, type ExecutionProviderManifest, type ExecutionRequirements } from "@/lib/v2/execution-providers";
import { createWorkloadBootstrap, exchangeWorkloadBootstrap, issueCapabilityLease } from "@/lib/v2/leases";
import { activateV2Agent, createV2Agent, issueAgentPassport } from "@/lib/v2/passports";
import { evaluatePolicy, publishRelaySafetyPolicy, registerCapabilityDefinition } from "@/lib/v2/policy";
import { ingestVerifiedEvent, publishEventRoute } from "@/lib/v2/orchestration";
import { registerRuntimeClient } from "@/lib/v2/runtime-clients";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

function manifest(providerKey: string, assurance: ExecutionProviderManifest["assurance"] = "managed-equivalent"): ExecutionProviderManifest {
  return { schemaVersion: "relay.execution-provider.v1", providerKey, version: "1.0", kind: "sandbox_service", features: ["shell", "files", "network_policy"], assurance, regions: ["us-west-2"], isolationModes: ["microvm"], persistenceModes: ["ephemeral"], maximumClassification: "restricted", evidenceTypes: ["provider_signed"], meteringDimensions: ["COMPUTE_SECONDS"], supportsPrivateNetwork: false, supportsIdempotentCreate: true, maximumSessionSeconds: 3600 };
}

function adapter(providerKey: string, options: { warm?: number; latency?: number; reliability?: number; amount?: string; prepare?: ExecutionProviderAdapter["prepareExecution"] } = {}): ExecutionProviderAdapter {
  return {
    providerKey, version: "1.0",
    health: async () => ({ available: true, warmCapacity: options.warm ?? 10, latencyMs: options.latency ?? 50, reliabilityBps: options.reliability ?? 9990, observedAt: new Date().toISOString() }),
    quote: async () => ({ amount: options.amount ?? "1", currency: "USD", validUntil: new Date(Date.now() + 60_000).toISOString() }),
    prepareExecution: options.prepare ?? (async () => ({ providerSessionId: `session-${providerKey}`, receipt: { providerKey } })),
    control: async () => ({}), observe: async () => ({}), collectEvidence: async () => [], collectMeters: async () => [], terminate: async () => ({}), reconcile: async () => ({ status: "NOT_FOUND" }),
  };
}

const requirements: ExecutionRequirements = { requiredFeatures: ["shell", "files"], minimumAssurance: "managed-equivalent", allowedRegions: ["us-west-2"], isolationMode: "microvm", persistence: "ephemeral", classification: "confidential", requiresPrivateNetwork: false, maximumSessionSeconds: 600, quoteCurrency: "USD", maximumQuotedAmount: "10" };

async function setup() {
  const identity = await freshDatabase();
  const signer = createLocalEd25519Signer("provider-test-key");
  const runtime = await registerRuntimeClient({ accountId: identity.accountId, actorPrincipalId: identity.principalId, displayName: "Scheduler runtime", selfDeclaredProduct: "custom" }, signer);
  const agent = await createV2Agent({ accountId: identity.accountId, ownerPrincipalId: identity.principalId, name: "Execution Agent" }, signer);
  const capabilityName = "computer.session.create";
  await registerCapabilityDefinition({ name: capabilityName, version: "1.0", domain: "computer", description: "Create execution", effectClass: "external_write", riskClass: "medium", resourceType: "computer", inputSchema: {}, outputSchema: {} }, signer);
  await publishRelaySafetyPolicy({ name: "execution-safety", rules: [{ id: "allow-execution", effect: "ALLOW", match: { capability: { name: capabilityName, version: "1.0" } }, reasonCode: "ALLOWED_BY_POLICY" }] }, signer);
  await issueAgentPassport({ accountId: identity.accountId, agentId: agent.agentId, ownerPrincipalId: identity.principalId, policy: { trustTier: "HIGH_ASSURANCE", capabilityEligibility: [{ name: capabilityName, version: "1.0" }], policyReferences: ["execution-safety"], budgetReferences: [], allowedEnvironments: { providerIds: ["fast-weak", "managed-a", "managed-b"], minimumAssurance: "registered" }, dataAccess: [], expiresAt: "2099-01-01T00:00:00.000Z" } }, signer);
  await activateV2Agent({ accountId: identity.accountId, agentId: agent.agentId, actorPrincipalId: identity.principalId }, signer);
  await publishEventRoute({ accountId: identity.accountId, actorPrincipalId: identity.principalId, name: "execution", source: "https://provider.example/events", eventType: "work.requested", agentId: agent.agentId }, signer);
  const event = await ingestVerifiedEvent({ envelope: { specversion: "1.0", id: "work-1", source: "https://provider.example/events", type: "work.requested", time: new Date().toISOString(), accountid: identity.accountId, classification: "internal", correlationid: "work-1", dedupekey: "work-1", schemaversion: "relay.event.v2", signaturestatus: "unverified" }, rawBody: new Uint8Array(), headers: {} }, { verify: async () => ({ valid: true }) }, signer);
  const taskId = event.taskIds[0]!;
  await db().update(v2Tasks).set({ status: "RUNNING" }).where(eq(v2Tasks.id, taskId));
  const material = { capability: { name: capabilityName, version: "1.0" }, resource: { type: "computer", ids: ["new"], attributes: { accountId: identity.accountId } }, parameters: { operation: "create" } };
  const action: ActionIntent = { schemaVersion: "relay.action-intent.v2", id: `act_${crypto.randomUUID().replaceAll("-", "")}`, accountId: identity.accountId, agentId: agent.agentId, runtimeClientId: runtime.runtimeClientId, taskId, ...material, idempotencyKey: crypto.randomUUID(), createdAt: new Date().toISOString(), canonicalHash: canonicalHash(material) };
  await evaluatePolicy({ accountId: identity.accountId, action, resourceResolver: { resolveOwnership: async () => ({ name: "resource.account_id", value: identity.accountId, authoritative: true, observedAt: new Date(Date.now() - 1).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceRevision: "computer:new" }) } }, signer);
  const keys = generateKeyPairSync("ed25519");
  const bootstrap = await createWorkloadBootstrap({ accountId: identity.accountId, agentId: agent.agentId, runtimeClientId: runtime.runtimeClientId, taskId, providerId: "managed-a", assurance: "managed-equivalent", audience: "provider-scheduler", publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString() }, signer);
  const workload = await exchangeWorkloadBootstrap({ accountId: identity.accountId, secret: bootstrap.secret, proofSignature: sign(null, Buffer.from(bootstrap.challenge), keys.privateKey).toString("base64url") }, signer);
  const resolver = { publicKeyForKeyId: async (keyId: string) => keyId === signer.keyId ? await signer.publicKeyPem() : undefined };
  const lease = await issueCapabilityLease({ accountId: identity.accountId, action, workloadId: workload.workloadId, workloadIdentityToken: workload.token, audience: "provider-scheduler", maxCalls: 1 }, signer, resolver);
  return { ...identity, signer, resolver, agentId: agent.agentId, taskId, action, leaseId: lease.leaseId };
}

describe("Relay V2 execution provider SDK and scheduler", () => {
  afterEach(cleanupDatabase);

  it("filters hard security constraints before scoring fast or cheap providers", async () => {
    const fixture = await setup();
    const registry = new ExecutionProviderRegistry();
    const weak = adapter("fast-weak", { warm: 1000, latency: 1, amount: "0.01" });
    const managed = adapter("managed-a", { warm: 1, latency: 500, amount: "9" });
    registry.register(weak); registry.register(managed);
    await publishExecutionProvider(manifest("fast-weak", "registered"), weak, fixture.signer);
    await publishExecutionProvider(manifest("managed-a"), managed, fixture.signer);
    const result = await scheduleExecution({ accountId: fixture.accountId, taskId: fixture.taskId, actionIntentId: fixture.action.id, leaseId: fixture.leaseId, requirements }, registry, fixture.signer, fixture.resolver);
    expect(result.selectedProviderKey).toBe("managed-a");
    expect((result.decision as { excluded: unknown[] }).excluded).toEqual([expect.objectContaining({ reasons: expect.arrayContaining(["assurance_insufficient"]) })]);
    await expect(scheduleExecution({ accountId: fixture.accountId, taskId: fixture.taskId, actionIntentId: fixture.action.id, leaseId: fixture.leaseId, requirements }, registry, fixture.signer, fixture.resolver)).resolves.toMatchObject({ placementId: result.placementId, idempotentReplay: true });
  });

  it("fails over only after an explicit pre-effect failure", async () => {
    const fixture = await setup();
    const registry = new ExecutionProviderRegistry();
    const firstPrepare = vi.fn(async () => { throw new ProviderDispatchError("capacity vanished", "PRE_EFFECT", "CapacityLost"); });
    const first = adapter("managed-a", { warm: 100, prepare: firstPrepare });
    const second = adapter("managed-b", { warm: 10 });
    registry.register(first); registry.register(second);
    await publishExecutionProvider(manifest("managed-a"), first, fixture.signer);
    await publishExecutionProvider(manifest("managed-b"), second, fixture.signer);
    const placement = await scheduleExecution({ accountId: fixture.accountId, taskId: fixture.taskId, actionIntentId: fixture.action.id, leaseId: fixture.leaseId, requirements }, registry, fixture.signer, fixture.resolver);
    await expect(startScheduledExecution({ accountId: fixture.accountId, placementId: placement.placementId }, registry, fixture.signer, fixture.resolver)).resolves.toMatchObject({ providerKey: "managed-b", attempt: 2 });
    expect((await listExecutionAttempts(fixture.accountId, placement.placementId)).map((attempt) => attempt.status)).toEqual(["PRE_EFFECT_FAILED", "ACCEPTED"]);
  });

  it("requires reconciliation and refuses failover after an ambiguous dispatch", async () => {
    const fixture = await setup();
    const registry = new ExecutionProviderRegistry();
    const secondPrepare = vi.fn(async () => ({ providerSessionId: "must-not-run", receipt: {} }));
    const first = adapter("managed-a", { warm: 100, prepare: async () => { throw new ProviderDispatchError("timeout after send", "POSSIBLY_COMMITTED", "DispatchTimeout"); } });
    const second = adapter("managed-b", { warm: 10, prepare: secondPrepare });
    registry.register(first); registry.register(second);
    await publishExecutionProvider(manifest("managed-a"), first, fixture.signer);
    await publishExecutionProvider(manifest("managed-b"), second, fixture.signer);
    const placement = await scheduleExecution({ accountId: fixture.accountId, taskId: fixture.taskId, actionIntentId: fixture.action.id, leaseId: fixture.leaseId, requirements }, registry, fixture.signer, fixture.resolver);
    await expect(startScheduledExecution({ accountId: fixture.accountId, placementId: placement.placementId }, registry, fixture.signer, fixture.resolver)).rejects.toThrow("reconciliation");
    expect(secondPrepare).not.toHaveBeenCalled();
    expect(await listExecutionPlacements(fixture.accountId)).toEqual([expect.objectContaining({ status: "RECONCILIATION_REQUIRED" })]);
    expect(await listExecutionAttempts(fixture.accountId, placement.placementId)).toEqual([expect.objectContaining({ status: "EFFECT_UNKNOWN", effectState: "POSSIBLY_COMMITTED" })]);
  });

  it("rejects incompatible manifests in the conformance harness", () => {
    const fake = adapter("managed-a");
    expect(qualifyExecutionProvider({ ...manifest("managed-a"), persistenceModes: ["persistent"] }, fake)).toMatchObject({ qualified: false, failures: expect.arrayContaining(["persistent mode requires persistent feature"]) });
    expect(qualifyExecutionProvider(manifest("managed-b"), fake)).toMatchObject({ qualified: false, failures: expect.arrayContaining(["adapter identity does not match manifest"]) });
  });

  it("opens the shared circuit after repeated provider failures", async () => {
    const fixture = await setup();
    const registry = new ExecutionProviderRegistry();
    const fake = adapter("managed-a");
    registry.register(fake);
    const published = await publishExecutionProvider(manifest("managed-a"), fake, fixture.signer);
    await reportExecutionProviderOutcome(published.providerDefinitionId, "FAILURE");
    await reportExecutionProviderOutcome(published.providerDefinitionId, "FAILURE");
    await reportExecutionProviderOutcome(published.providerDefinitionId, "FAILURE");
    await expect(scheduleExecution({ accountId: fixture.accountId, taskId: fixture.taskId, actionIntentId: fixture.action.id, leaseId: fixture.leaseId, requirements }, registry, fixture.signer, fixture.resolver)).rejects.toMatchObject({ status: 503 });
  });

  it("rejects a stored provider manifest whose signed content was tampered", async () => {
    const fixture = await setup();
    const registry = new ExecutionProviderRegistry();
    const fake = adapter("managed-a");
    registry.register(fake);
    const published = await publishExecutionProvider(manifest("managed-a"), fake, fixture.signer);
    await db().update(executionProviderDefinitions).set({ manifest: { ...manifest("managed-a"), maximumSessionSeconds: 7200 } }).where(eq(executionProviderDefinitions.id, published.providerDefinitionId));
    await expect(scheduleExecution({ accountId: fixture.accountId, taskId: fixture.taskId, actionIntentId: fixture.action.id, leaseId: fixture.leaseId, requirements }, registry, fixture.signer, fixture.resolver)).rejects.toMatchObject({ status: 503 });
  });

  it("isolates placement and attempt access by account and prevents concurrent dispatch", async () => {
    const fixture = await setup();
    const registry = new ExecutionProviderRegistry();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const prepare = vi.fn(async () => { await gate; return { providerSessionId: "session", receipt: {} }; });
    const fake = adapter("managed-a", { prepare });
    registry.register(fake);
    await publishExecutionProvider(manifest("managed-a"), fake, fixture.signer);
    const placement = await scheduleExecution({ accountId: fixture.accountId, taskId: fixture.taskId, actionIntentId: fixture.action.id, leaseId: fixture.leaseId, requirements }, registry, fixture.signer, fixture.resolver);
    const otherAccountId = await secondAccount();
    expect(await listExecutionPlacements(otherAccountId)).toEqual([]);
    await expect(startScheduledExecution({ accountId: otherAccountId, placementId: placement.placementId }, registry, fixture.signer, fixture.resolver)).rejects.toMatchObject({ status: 404 });
    const first = startScheduledExecution({ accountId: fixture.accountId, placementId: placement.placementId, credentialHandles: ["vlt_testhandle"] }, registry, fixture.signer, fixture.resolver);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    await expect(startScheduledExecution({ accountId: fixture.accountId, placementId: placement.placementId }, registry, fixture.signer, fixture.resolver)).rejects.toMatchObject({ status: 404 });
    release();
    await expect(first).resolves.toMatchObject({ providerSessionId: "session" });
    expect(await listExecutionAttempts(otherAccountId, placement.placementId)).toEqual([]);
  });
});
