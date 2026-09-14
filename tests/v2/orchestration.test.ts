import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { taskCommands, taskStateHistory, v2Tasks } from "@/lib/db/schema";
import { createLocalEd25519Signer } from "@/lib/v2/evidence";
import { activateV2Agent, createV2Agent, issueAgentPassport } from "@/lib/v2/passports";
import { cancelTask, claimTaskCommand, dispatchClaimedStart, failTaskCommand, ingestVerifiedEvent, listDeadLetters, listOutbox, listTasks, markTaskCommandEffectState, publishEventRoute, publishOutboxBatch, reapExpiredTaskCommands, replayDeadLetter, transitionTask, type TemporalGateway, type WebhookVerifier } from "@/lib/v2/orchestration";
import { reduceTaskWorkflow, taskWorkflowDefinition } from "@/lib/v2/task-workflow";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

async function setup(maxAttempts = 3) {
  const identity = await freshDatabase();
  const signer = createLocalEd25519Signer("orchestration-key");
  const created = await createV2Agent({ accountId: identity.accountId, ownerPrincipalId: identity.principalId, name: "Event Agent" }, signer);
  await issueAgentPassport({ accountId: identity.accountId, agentId: created.agentId, ownerPrincipalId: identity.principalId, policy: { trustTier: "REGISTERED", capabilityEligibility: [], policyReferences: [], budgetReferences: [], allowedEnvironments: { providerIds: ["relay-managed"], minimumAssurance: "registered" }, dataAccess: [], expiresAt: "2099-01-01T00:00:00.000Z" } }, signer);
  await activateV2Agent({ accountId: identity.accountId, agentId: created.agentId, actorPrincipalId: identity.principalId }, signer);
  await publishEventRoute({ accountId: identity.accountId, actorPrincipalId: identity.principalId, name: "inbox", source: "https://provider.example/events", eventType: "message.received", subjectPrefix: "thread/", agentId: created.agentId, maxAttempts }, signer);
  return { ...identity, agentId: created.agentId, signer };
}

function envelope(accountId: string, dedupeKey: string, subject = "thread/one") {
  return { specversion: "1.0" as const, id: dedupeKey, source: "https://provider.example/events", type: "message.received", time: new Date().toISOString(), subject, accountid: accountId, classification: "internal" as const, correlationid: `correlation-${dedupeKey}`, dedupekey: dedupeKey, schemaversion: "relay.event.v2", signaturestatus: "unverified" as const, data: { text: "hello" } };
}

function verifier(sequence: bigint): WebhookVerifier {
  return { verify: async () => ({ valid: true, providerSequence: sequence, evidence: { algorithm: "fixture" } }) };
}

const gateway: TemporalGateway = {
  startWorkflow: async ({ taskId }) => ({ runId: `run-${taskId}` }),
  cancelWorkflow: async () => undefined,
};

describe("Relay V2 durable event and task orchestration", () => {
  afterEach(cleanupDatabase);

  it("verifies before persistence and converges duplicate and reordered deliveries", async () => {
    const fixture = await setup();
    await expect(ingestVerifiedEvent({ envelope: envelope(fixture.accountId, "invalid"), rawBody: new Uint8Array(), headers: {} }, { verify: async () => ({ valid: false }) }, fixture.signer)).rejects.toMatchObject({ status: 401 });
    expect(await listTasks(fixture.accountId)).toEqual([]);
    const latest = await ingestVerifiedEvent({ envelope: envelope(fixture.accountId, "delivery-2"), rawBody: new Uint8Array(), headers: {} }, verifier(2n), fixture.signer);
    const duplicate = await ingestVerifiedEvent({ envelope: envelope(fixture.accountId, "delivery-2"), rawBody: new Uint8Array(), headers: {} }, verifier(2n), fixture.signer);
    const older = await ingestVerifiedEvent({ envelope: envelope(fixture.accountId, "delivery-1"), rawBody: new Uint8Array(), headers: {} }, verifier(1n), fixture.signer);
    expect(duplicate).toMatchObject({ eventId: latest.eventId, taskIds: latest.taskIds, duplicate: true });
    expect(older.reordered).toBe(true);
    expect(await listTasks(fixture.accountId)).toHaveLength(2);
  });

  it("allows exactly one concurrent claim and rejects stale coordinator fencing after worker recovery", async () => {
    const fixture = await setup();
    await ingestVerifiedEvent({ envelope: envelope(fixture.accountId, "claim-one"), rawBody: new Uint8Array(), headers: {} }, verifier(1n), fixture.signer);
    const claims = await Promise.all(Array.from({ length: 10 }, (_, index) => claimTaskCommand(`worker-${index}`, 5)));
    const first = claims.find(Boolean)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    await db().update(taskCommands).set({ leaseUntil: new Date(Date.now() - 1_000).toISOString() }).where(eq(taskCommands.id, first.id));
    await expect(reapExpiredTaskCommands(fixture.signer)).resolves.toEqual({ requeued: 1, deadLettered: 0 });
    const second = await claimTaskCommand("worker-new", 30);
    expect(second?.fenceToken).toBe(first.fenceToken + 1);
    await expect(transitionTask({ accountId: fixture.accountId, taskId: first.taskId, coordinatorId: first.workerId!, fenceToken: first.fenceToken, to: "RUNNING", reason: "stale" }, fixture.signer)).rejects.toMatchObject({ status: 409 });
    await expect(dispatchClaimedStart({ accountId: fixture.accountId, commandId: second!.id, workerId: second!.workerId!, fenceToken: second!.fenceToken }, gateway, fixture.signer)).resolves.toMatchObject({ task: { status: "RUNNING" } });
  });

  it("dead-letters poison input and permits a single explicit account-scoped replay", async () => {
    const fixture = await setup();
    await ingestVerifiedEvent({ envelope: envelope(fixture.accountId, "poison"), rawBody: new Uint8Array(), headers: {} }, verifier(1n), fixture.signer);
    const claim = await claimTaskCommand("poison-worker", 30);
    const failed = await failTaskCommand({ accountId: fixture.accountId, commandId: claim!.id, workerId: claim!.workerId!, fenceToken: claim!.fenceToken, classification: "POISON", errorClass: "SchemaPoison" }, fixture.signer);
    expect(failed).toMatchObject({ retried: false, deadLetterId: expect.stringMatching(/^dlq_/) });
    const replay = await replayDeadLetter({ accountId: fixture.accountId, actorPrincipalId: fixture.principalId, deadLetterId: failed.deadLetterId! }, fixture.signer);
    expect(replay.taskId).toMatch(/^tsk_/);
    await expect(replayDeadLetter({ accountId: fixture.accountId, actorPrincipalId: fixture.principalId, deadLetterId: failed.deadLetterId! }, fixture.signer)).rejects.toMatchObject({ status: 404 });
  });

  it("never automatically retries a possibly committed effect after worker death", async () => {
    const fixture = await setup();
    await ingestVerifiedEvent({ envelope: envelope(fixture.accountId, "ambiguous"), rawBody: new Uint8Array(), headers: {} }, verifier(1n), fixture.signer);
    const claim = await claimTaskCommand("ambiguous-worker", 30);
    await markTaskCommandEffectState({ accountId: fixture.accountId, commandId: claim!.id, workerId: claim!.workerId!, fenceToken: claim!.fenceToken, effectState: "POSSIBLY_COMMITTED" });
    await db().update(taskCommands).set({ leaseUntil: new Date(Date.now() - 1_000).toISOString() }).where(eq(taskCommands.id, claim!.id));
    await expect(reapExpiredTaskCommands(fixture.signer)).resolves.toEqual({ requeued: 0, deadLettered: 1 });
    expect(await listDeadLetters(fixture.accountId)).toEqual([expect.objectContaining({ reasonCode: "EFFECT_UNKNOWN" })]);
    expect(await claimTaskCommand("must-not-retry")).toBeUndefined();
  });

  it("keeps acknowledged events and outbox messages durable across publisher failure", async () => {
    const fixture = await setup();
    const ingested = await ingestVerifiedEvent({ envelope: envelope(fixture.accountId, "outbox"), rawBody: new Uint8Array(), headers: {} }, verifier(1n), fixture.signer);
    const before = await listOutbox(fixture.accountId);
    expect(before.length).toBeGreaterThanOrEqual(2);
    const failedPublisher = { publish: vi.fn(async () => { throw new Error("broker unavailable"); }) };
    await expect(publishOutboxBatch(failedPublisher)).rejects.toThrow("broker unavailable");
    expect((await listOutbox(fixture.accountId)).every((message) => message.publishedAt === null)).toBe(true);
    const delivered = new Set<string>();
    expect(await publishOutboxBatch({ publish: async (message) => { delivered.add(message.idempotencyKey); } })).toBe(before.length);
    expect(delivered.size).toBe(before.length);
    expect(await publishOutboxBatch({ publish: async () => { throw new Error("should not publish twice"); } })).toBe(0);
    expect(ingested.taskIds).toHaveLength(1);
  });

  it("durably cancels queued work even when Temporal delivery is unavailable", async () => {
    const fixture = await setup();
    const ingested = await ingestVerifiedEvent({ envelope: envelope(fixture.accountId, "cancel"), rawBody: new Uint8Array(), headers: {} }, verifier(1n), fixture.signer);
    const unavailable = { ...gateway, cancelWorkflow: async () => { throw new Error("temporal unavailable"); } };
    await expect(cancelTask({ accountId: fixture.accountId, actorPrincipalId: fixture.principalId, taskId: ingested.taskIds[0]!, reason: "operator request" }, unavailable, fixture.signer)).resolves.toMatchObject({ task: { status: "CANCELLED" }, deliveryPending: true });
    expect((await listOutbox(fixture.accountId)).some((message) => message.type === "task.cancel.requested")).toBe(true);
    expect(await claimTaskCommand("cancel-worker")).toBeUndefined();
  });

  it("defines a deterministic, fenced workflow state reducer with Relay-owned retries", () => {
    expect(taskWorkflowDefinition.retryPolicy.maximumAttempts).toBe(1);
    expect(reduceTaskWorkflow({ state: "RUNNING", fenceToken: 7, terminal: false }, { type: "PAUSE_REQUESTED", fenceToken: 7 })).toMatchObject({ state: "PAUSED" });
    expect(() => reduceTaskWorkflow({ state: "RUNNING", fenceToken: 8, terminal: false }, { type: "CANCEL_REQUESTED", fenceToken: 7 })).toThrow("stale");
  });

  it("isolates routes, jobs, history, outbox, and dead letters by tenant", async () => {
    const fixture = await setup();
    const otherAccountId = await secondAccount();
    await expect(publishEventRoute({ accountId: otherAccountId, actorPrincipalId: fixture.principalId, name: "cross", source: "https://provider.example/events", eventType: "message.received", agentId: fixture.agentId }, fixture.signer)).rejects.toMatchObject({ status: 403 });
    await ingestVerifiedEvent({ envelope: envelope(fixture.accountId, "isolation"), rawBody: new Uint8Array(), headers: {} }, verifier(1n), fixture.signer);
    expect(await listTasks(otherAccountId)).toEqual([]);
    expect(await listDeadLetters(otherAccountId)).toEqual([]);
    expect(await listOutbox(otherAccountId)).toEqual([]);
    const task = (await listTasks(fixture.accountId))[0]!;
    expect(await db().select().from(taskStateHistory).where(and(eq(taskStateHistory.accountId, otherAccountId), eq(taskStateHistory.taskId, task.id)))).toEqual([]);
    expect(await db().select().from(v2Tasks).where(and(eq(v2Tasks.accountId, otherAccountId), eq(v2Tasks.id, task.id)))).toEqual([]);
  });
});
