import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type RelayDatabase, withTransaction } from "@/lib/db";
import { agents, controlOutbox, deadLetterEntries, eventRoutes, eventSourceCursors, taskCommands, taskStateHistory, v2Events, v2Tasks } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { canTransition, relayEventSchema, taskTransitions, type TaskState } from "@/lib/v2/contracts";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { requireMembership } from "@/lib/v2/identity";

export interface WebhookVerifier {
  verify(input: { accountId: string; source: string; rawBody: Uint8Array; headers: Readonly<Record<string, string>> }): Promise<{ valid: boolean; providerSequence?: bigint; evidence?: Record<string, unknown> }>;
}

export interface TemporalGateway {
  startWorkflow(input: { workflowId: string; accountId: string; taskId: string; agentId: string; eventId: string; preferredRuntime?: string; fenceToken: number }): Promise<{ runId: string }>;
  cancelWorkflow(input: { workflowId: string; reason: string }): Promise<void>;
}

export type FailureClassification = "PRE_EFFECT_RETRYABLE" | "IDEMPOTENT_SAFE_RETRYABLE" | "POSSIBLY_COMMITTED" | "PERMANENT" | "POISON";

const routeInputSchema = z.object({ name: z.string().min(1).max(255), source: z.string().min(1).max(255), eventType: z.string().min(1).max(255), subjectPrefix: z.string().min(1).max(2_048).optional(), agentId: z.string().regex(/^agt_/), preferredRuntime: z.string().min(1).max(255).optional(), maxAttempts: z.number().int().min(1).max(20).default(5) }).strict();

async function transitionInTransaction(transaction: RelayDatabase, input: { accountId: string; taskId: string; from: TaskState; to: TaskState; reason: string; fenceToken?: number; updates?: Partial<typeof v2Tasks.$inferInsert> }) {
  if (!canTransition(taskTransitions, input.from, input.to)) throw new RelayError("INVALID_INPUT", `Invalid task transition ${input.from} -> ${input.to}.`, undefined, 409);
  const conditions = [eq(v2Tasks.accountId, input.accountId), eq(v2Tasks.id, input.taskId), eq(v2Tasks.status, input.from)];
  if (input.fenceToken !== undefined) conditions.push(eq(v2Tasks.fenceToken, input.fenceToken));
  const [updated] = await transaction.update(v2Tasks).set({ ...input.updates, status: input.to, updatedAt: now(), ...(["SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTERED"].includes(input.to) ? { completedAt: now() } : {}) }).where(and(...conditions)).returning();
  if (!updated) throw new RelayError("CAPABILITY_DENIED", "Task state or fencing token is stale.", undefined, 409);
  await transaction.insert(taskStateHistory).values({ id: id("tsh"), accountId: input.accountId, taskId: input.taskId, fromState: input.from, toState: input.to, reason: input.reason, fenceToken: input.fenceToken });
  return updated;
}

async function enqueueStart(transaction: RelayDatabase, task: typeof v2Tasks.$inferSelect, suffix: string) {
  const commandId = id("cmd");
  await transaction.insert(taskCommands).values({ id: commandId, accountId: task.accountId, taskId: task.id, kind: "START_TASK", idempotencyKey: `start:${task.id}:${suffix}`, payload: { eventId: task.eventId, routeId: task.routeId } });
  await transaction.insert(controlOutbox).values({ id: id("obx"), accountId: task.accountId, aggregateType: "task", aggregateId: task.id, type: "task.command.ready", payload: { commandId }, idempotencyKey: `command-ready:${commandId}` });
  return commandId;
}

export async function publishEventRoute(input: { accountId: string; actorPrincipalId: string; name: string; source: string; eventType: string; subjectPrefix?: string; agentId: string; preferredRuntime?: string; maxAttempts?: number }, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.actorPrincipalId, allowedRoles: ["OWNER", "ADMIN"] });
  const route = routeInputSchema.parse({ name: input.name, source: input.source, eventType: input.eventType, subjectPrefix: input.subjectPrefix, agentId: input.agentId, preferredRuntime: input.preferredRuntime, maxAttempts: input.maxAttempts });
  return await withTransaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`route:${input.accountId}:${route.name}`}, 0))`);
    const [agent] = await transaction.select({ id: agents.id }).from(agents).where(and(eq(agents.accountId, input.accountId), eq(agents.id, route.agentId), eq(agents.status, "ACTIVE"))).limit(1);
    if (!agent) throw new RelayError("INVALID_INPUT", "Route Agent is not active in this account.", undefined, 404);
    const [previous] = await transaction.select({ version: eventRoutes.version }).from(eventRoutes).where(and(eq(eventRoutes.accountId, input.accountId), eq(eventRoutes.name, route.name))).orderBy(desc(eventRoutes.version)).limit(1);
    await transaction.update(eventRoutes).set({ status: "DISABLED" }).where(and(eq(eventRoutes.accountId, input.accountId), eq(eventRoutes.name, route.name), eq(eventRoutes.status, "ACTIVE")));
    const routeId = id("rte");
    const version = (previous?.version ?? 0) + 1;
    await transaction.insert(eventRoutes).values({ id: routeId, accountId: input.accountId, ...route, version, createdByPrincipalId: input.actorPrincipalId });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.actorPrincipalId, agentId: route.agentId, eventType: "event_route.published", outcome: "SUCCESS", details: { routeId, name: route.name, version, source: route.source, eventType: route.eventType } }, signer);
    return { routeId, version };
  });
}

export async function ingestVerifiedEvent(input: { envelope: z.input<typeof relayEventSchema>; rawBody: Uint8Array; headers: Readonly<Record<string, string>> }, verifier: WebhookVerifier, signer: AuditSigner, existingTransaction?: RelayDatabase) {
  const proposed = relayEventSchema.parse(input.envelope);
  const verification = await verifier.verify({ accountId: proposed.accountid, source: proposed.source, rawBody: input.rawBody, headers: input.headers });
  if (!verification.valid) throw new RelayError("INVALID_CREDENTIAL", "Inbound event signature verification failed.", undefined, 401);
  const envelope = relayEventSchema.parse({ ...proposed, signaturestatus: "verified" });
  const persist = async (transaction: RelayDatabase) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`event:${envelope.accountid}:${envelope.source}`}, 0))`);
    const [existing] = await transaction.select().from(v2Events).where(and(eq(v2Events.accountId, envelope.accountid), eq(v2Events.source, envelope.source), eq(v2Events.dedupeKey, envelope.dedupekey))).limit(1);
    if (existing) {
      const tasks = await transaction.select({ id: v2Tasks.id }).from(v2Tasks).where(and(eq(v2Tasks.accountId, envelope.accountid), eq(v2Tasks.eventId, existing.id)));
      return { eventId: existing.id, taskIds: tasks.map((task) => task.id), duplicate: true, reordered: existing.reordered };
    }
    const [cursor] = await transaction.select().from(eventSourceCursors).where(and(eq(eventSourceCursors.accountId, envelope.accountid), eq(eventSourceCursors.source, envelope.source))).limit(1);
    const providerSequence = verification.providerSequence;
    const reordered = providerSequence !== undefined && cursor !== undefined && providerSequence <= cursor.highestSequence;
    if (providerSequence !== undefined && (!cursor || providerSequence > cursor.highestSequence)) await transaction.insert(eventSourceCursors).values({ accountId: envelope.accountid, source: envelope.source, highestSequence: providerSequence }).onConflictDoUpdate({ target: [eventSourceCursors.accountId, eventSourceCursors.source], set: { highestSequence: providerSequence, updatedAt: now() } });
    const eventId = id("evt");
    await transaction.insert(v2Events).values({ id: eventId, accountId: envelope.accountid, source: envelope.source, type: envelope.type, subject: envelope.subject, occurredAt: envelope.time, dedupeKey: envelope.dedupekey, correlationId: envelope.correlationid, causationId: envelope.causationid, schemaVersion: envelope.schemaversion, classification: envelope.classification, signatureStatus: "VERIFIED", providerSequence, reordered, data: envelope.data });
    const candidates = await transaction.select().from(eventRoutes).where(and(eq(eventRoutes.accountId, envelope.accountid), eq(eventRoutes.source, envelope.source), eq(eventRoutes.eventType, envelope.type), eq(eventRoutes.status, "ACTIVE")));
    const routes = candidates.filter((route) => !route.subjectPrefix || envelope.subject?.startsWith(route.subjectPrefix));
    const taskIds: string[] = [];
    for (const route of routes) {
      const taskId = id("tsk");
      const timestamp = now();
      const [task] = await transaction.insert(v2Tasks).values({ id: taskId, accountId: envelope.accountid, eventId, routeId: route.id, logicalKey: `${eventId}:${route.id}`, agentId: route.agentId, status: "QUEUED", preferredRuntime: route.preferredRuntime, maxAttempts: route.maxAttempts, createdAt: timestamp, updatedAt: timestamp }).returning();
      await transaction.insert(taskStateHistory).values([
        { id: id("tsh"), accountId: envelope.accountid, taskId, fromState: null, toState: "RECEIVED", reason: "verified event accepted" },
        { id: id("tsh"), accountId: envelope.accountid, taskId, fromState: "RECEIVED", toState: "ROUTED", reason: `route ${route.id} version ${route.version}` },
        { id: id("tsh"), accountId: envelope.accountid, taskId, fromState: "ROUTED", toState: "QUEUED", reason: "start command durably enqueued" },
      ]);
      await enqueueStart(transaction, task!, "initial");
      taskIds.push(taskId);
    }
    await transaction.insert(controlOutbox).values({ id: id("obx"), accountId: envelope.accountid, aggregateType: "event", aggregateId: eventId, type: "event.accepted", payload: { taskIds, reordered }, idempotencyKey: `event-accepted:${eventId}` });
    await appendAuditRecordInTransaction(transaction, { accountId: envelope.accountid, eventType: "event.accepted", outcome: "SUCCESS", details: { eventId, source: envelope.source, type: envelope.type, signatureStatus: "VERIFIED", routeCount: taskIds.length, reordered, verificationEvidence: verification.evidence ?? {} } }, signer);
    return { eventId, taskIds, duplicate: false, reordered };
  };
  return existingTransaction ? await persist(existingTransaction) : await withTransaction(persist);
}

export async function claimTaskCommand(workerId: string, leaseSeconds = 30) {
  if (!workerId.trim()) throw new RelayError("INVALID_INPUT", "Worker ID is required.");
  return await withTransaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('relay:v2:command-claim', 0))`);
    const timestamp = now();
    const [command] = await transaction.select().from(taskCommands).where(and(eq(taskCommands.kind, "START_TASK"), eq(taskCommands.status, "PENDING"), lte(taskCommands.runAfter, timestamp))).orderBy(asc(taskCommands.runAfter), asc(taskCommands.createdAt)).limit(1);
    if (!command) return undefined;
    const leaseUntil = new Date(Date.now() + Math.min(Math.max(leaseSeconds, 5), 300) * 1_000).toISOString();
    const [task] = await transaction.update(v2Tasks).set({ status: "STARTING", fenceToken: sql`${v2Tasks.fenceToken} + 1`, coordinatorId: workerId, coordinatorLeaseUntil: leaseUntil, attemptCount: sql`${v2Tasks.attemptCount} + 1`, updatedAt: timestamp }).where(and(eq(v2Tasks.accountId, command.accountId), eq(v2Tasks.id, command.taskId), eq(v2Tasks.status, "QUEUED"))).returning();
    if (!task) {
      await transaction.update(taskCommands).set({ status: "CANCELLED", updatedAt: timestamp }).where(and(eq(taskCommands.accountId, command.accountId), eq(taskCommands.id, command.id), eq(taskCommands.status, "PENDING")));
      return undefined;
    }
    await transaction.update(taskCommands).set({ status: "PROCESSING", attempt: sql`${taskCommands.attempt} + 1`, fenceToken: task.fenceToken, workerId, leaseUntil, updatedAt: timestamp }).where(and(eq(taskCommands.accountId, command.accountId), eq(taskCommands.id, command.id), eq(taskCommands.status, "PENDING")));
    await transaction.insert(taskStateHistory).values({ id: id("tsh"), accountId: command.accountId, taskId: task.id, fromState: "QUEUED", toState: "STARTING", reason: "worker command claimed", fenceToken: task.fenceToken });
    return { ...command, status: "PROCESSING" as const, workerId, leaseUntil, fenceToken: task.fenceToken, attempt: command.attempt + 1, task };
  });
}

function workflowId(accountId: string, taskId: string) { return `relay/${accountId}/task/${taskId}`; }

export async function dispatchClaimedStart(input: { accountId: string; commandId: string; workerId: string; fenceToken: number }, gateway: TemporalGateway, signer: AuditSigner) {
  const timestamp = now();
  const [command] = await db().select().from(taskCommands).where(and(eq(taskCommands.accountId, input.accountId), eq(taskCommands.id, input.commandId), eq(taskCommands.workerId, input.workerId), eq(taskCommands.fenceToken, input.fenceToken), eq(taskCommands.status, "PROCESSING"), gt(taskCommands.leaseUntil, timestamp))).limit(1);
  if (!command) throw new RelayError("CAPABILITY_DENIED", "Command claim is stale.", undefined, 409);
  const [task] = await db().select().from(v2Tasks).where(and(eq(v2Tasks.accountId, input.accountId), eq(v2Tasks.id, command.taskId), eq(v2Tasks.coordinatorId, input.workerId), eq(v2Tasks.fenceToken, input.fenceToken), eq(v2Tasks.status, "STARTING"), gt(v2Tasks.coordinatorLeaseUntil, timestamp))).limit(1);
  if (!task) throw new RelayError("CAPABILITY_DENIED", "Task coordinator fence is stale.", undefined, 409);
  await markTaskCommandEffectState({ ...input, effectState: "IDEMPOTENT_SAFE" });
  const deterministicWorkflowId = workflowId(input.accountId, task.id);
  const result = await gateway.startWorkflow({ workflowId: deterministicWorkflowId, accountId: input.accountId, taskId: task.id, agentId: task.agentId, eventId: task.eventId, preferredRuntime: task.preferredRuntime ?? undefined, fenceToken: input.fenceToken });
  try {
    return await withTransaction(async (transaction) => {
      const [current] = await transaction.select({ id: v2Tasks.id }).from(v2Tasks).where(and(eq(v2Tasks.accountId, input.accountId), eq(v2Tasks.id, task.id), eq(v2Tasks.coordinatorId, input.workerId), eq(v2Tasks.fenceToken, input.fenceToken), eq(v2Tasks.status, "STARTING"), gt(v2Tasks.coordinatorLeaseUntil, now()))).limit(1);
      if (!current) throw new RelayError("CAPABILITY_DENIED", "Task completion fence is stale.", undefined, 409);
      const running = await transitionInTransaction(transaction, { accountId: input.accountId, taskId: task.id, from: "STARTING", to: "RUNNING", reason: "durable workflow accepted", fenceToken: input.fenceToken });
      const completed = await transaction.update(taskCommands).set({ status: "COMPLETED", effectState: "IDEMPOTENT_SAFE", leaseUntil: null, updatedAt: now() }).where(and(eq(taskCommands.accountId, input.accountId), eq(taskCommands.id, command.id), eq(taskCommands.workerId, input.workerId), eq(taskCommands.fenceToken, input.fenceToken), eq(taskCommands.status, "PROCESSING"))).returning({ id: taskCommands.id });
      if (!completed.length) throw new RelayError("CAPABILITY_DENIED", "Command completion fence is stale.", undefined, 409);
      await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, agentId: task.agentId, taskId: task.id, eventType: "task.workflow_started", outcome: "SUCCESS", details: { workflowId: deterministicWorkflowId, runId: result.runId, fenceToken: input.fenceToken } }, signer);
      return { task: running, workflowId: deterministicWorkflowId, runId: result.runId };
    });
  } catch (error) {
    await gateway.cancelWorkflow({ workflowId: deterministicWorkflowId, reason: "authoritative task fence rejected workflow start" }).catch(() => undefined);
    throw error;
  }
}

export async function markTaskCommandEffectState(input: { accountId: string; commandId: string; workerId: string; fenceToken: number; effectState: "PRE_EFFECT" | "IDEMPOTENT_SAFE" | "POSSIBLY_COMMITTED" }) {
  const [updated] = await db().update(taskCommands).set({ effectState: input.effectState, updatedAt: now() }).where(and(eq(taskCommands.accountId, input.accountId), eq(taskCommands.id, input.commandId), eq(taskCommands.workerId, input.workerId), eq(taskCommands.fenceToken, input.fenceToken), eq(taskCommands.status, "PROCESSING"), gt(taskCommands.leaseUntil, now()))).returning({ id: taskCommands.id });
  if (!updated) throw new RelayError("CAPABILITY_DENIED", "Command effect-state fence is stale.", undefined, 409);
}

async function deadLetterInTransaction(transaction: RelayDatabase, command: typeof taskCommands.$inferSelect, task: typeof v2Tasks.$inferSelect, reasonCode: string, errorClass: string | undefined, signer: AuditSigner) {
  await transaction.update(taskCommands).set({ status: "DEAD_LETTERED", leaseUntil: null, updatedAt: now() }).where(and(eq(taskCommands.accountId, command.accountId), eq(taskCommands.id, command.id)));
  await transitionInTransaction(transaction, { accountId: task.accountId, taskId: task.id, from: task.status as TaskState, to: "DEAD_LETTERED", reason: reasonCode, fenceToken: task.fenceToken });
  const deadLetterId = id("dlq");
  await transaction.insert(deadLetterEntries).values({ id: deadLetterId, accountId: task.accountId, taskId: task.id, commandId: command.id, reasonCode, errorClass, evidence: { effectState: command.effectState, attempt: command.attempt } });
  await appendAuditRecordInTransaction(transaction, { accountId: task.accountId, agentId: task.agentId, taskId: task.id, eventType: "task.dead_lettered", outcome: reasonCode, details: { deadLetterId, commandId: command.id, errorClass: errorClass ?? null, effectState: command.effectState } }, signer);
  return deadLetterId;
}

export async function failTaskCommand(input: { accountId: string; commandId: string; workerId: string; fenceToken: number; classification: FailureClassification; errorClass?: string }, signer: AuditSigner) {
  return await withTransaction(async (transaction) => {
    const [command] = await transaction.select().from(taskCommands).where(and(eq(taskCommands.accountId, input.accountId), eq(taskCommands.id, input.commandId), eq(taskCommands.workerId, input.workerId), eq(taskCommands.fenceToken, input.fenceToken), eq(taskCommands.status, "PROCESSING"))).limit(1);
    if (!command) throw new RelayError("CAPABILITY_DENIED", "Command failure fence is stale.", undefined, 409);
    const [task] = await transaction.select().from(v2Tasks).where(and(eq(v2Tasks.accountId, input.accountId), eq(v2Tasks.id, command.taskId), eq(v2Tasks.fenceToken, input.fenceToken), eq(v2Tasks.status, "STARTING"))).limit(1);
    if (!task) throw new RelayError("CAPABILITY_DENIED", "Task failure fence is stale.", undefined, 409);
    const classifiedCommand = input.classification === "POSSIBLY_COMMITTED" ? { ...command, effectState: "POSSIBLY_COMMITTED" as const } : command;
    if (input.classification === "POSSIBLY_COMMITTED") await transaction.update(taskCommands).set({ effectState: "POSSIBLY_COMMITTED", updatedAt: now() }).where(and(eq(taskCommands.accountId, input.accountId), eq(taskCommands.id, command.id)));
    if (["POISON", "POSSIBLY_COMMITTED"].includes(input.classification) || command.attempt >= task.maxAttempts) return { deadLetterId: await deadLetterInTransaction(transaction, classifiedCommand, task, input.classification === "POSSIBLY_COMMITTED" ? "EFFECT_UNKNOWN" : input.classification === "POISON" ? "POISON_EVENT" : "RETRY_EXHAUSTED", input.errorClass, signer), retried: false };
    if (input.classification === "PERMANENT") {
      await transaction.update(taskCommands).set({ status: "COMPLETED", leaseUntil: null, updatedAt: now() }).where(and(eq(taskCommands.accountId, input.accountId), eq(taskCommands.id, command.id)));
      await transitionInTransaction(transaction, { accountId: input.accountId, taskId: task.id, from: "STARTING", to: "FAILED", reason: input.errorClass ?? "permanent failure", fenceToken: input.fenceToken });
      return { retried: false };
    }
    const runAfter = new Date(Date.now() + Math.min(2 ** command.attempt, 60) * 1_000).toISOString();
    await transaction.update(taskCommands).set({ status: "PENDING", effectState: input.classification === "IDEMPOTENT_SAFE_RETRYABLE" ? "IDEMPOTENT_SAFE" : "PRE_EFFECT", workerId: null, leaseUntil: null, runAfter, updatedAt: now() }).where(and(eq(taskCommands.accountId, input.accountId), eq(taskCommands.id, command.id)));
    await transitionInTransaction(transaction, { accountId: input.accountId, taskId: task.id, from: "STARTING", to: "QUEUED", reason: input.classification, fenceToken: input.fenceToken, updates: { coordinatorId: null, coordinatorLeaseUntil: null } });
    return { retried: true, runAfter };
  });
}

export async function reapExpiredTaskCommands(signer: AuditSigner, timestamp = now()) {
  return await withTransaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('relay:v2:command-reaper', 0))`);
    const expired = await transaction.select().from(taskCommands).where(and(eq(taskCommands.kind, "START_TASK"), eq(taskCommands.status, "PROCESSING"), lte(taskCommands.leaseUntil, timestamp)));
    let requeued = 0;
    let deadLettered = 0;
    for (const command of expired) {
      const [task] = await transaction.select().from(v2Tasks).where(and(eq(v2Tasks.accountId, command.accountId), eq(v2Tasks.id, command.taskId), eq(v2Tasks.fenceToken, command.fenceToken), eq(v2Tasks.status, "STARTING"))).limit(1);
      if (!task) continue;
      if (command.effectState === "POSSIBLY_COMMITTED" || command.attempt >= task.maxAttempts) {
        await deadLetterInTransaction(transaction, command, task, command.effectState === "POSSIBLY_COMMITTED" ? "EFFECT_UNKNOWN" : "RETRY_EXHAUSTED", "WorkerLeaseExpired", signer);
        deadLettered += 1;
      } else {
        await transaction.update(taskCommands).set({ status: "PENDING", workerId: null, leaseUntil: null, runAfter: timestamp, updatedAt: timestamp }).where(and(eq(taskCommands.accountId, command.accountId), eq(taskCommands.id, command.id), eq(taskCommands.status, "PROCESSING")));
        await transitionInTransaction(transaction, { accountId: task.accountId, taskId: task.id, from: "STARTING", to: "QUEUED", reason: "worker lease expired; safe recovery", fenceToken: task.fenceToken, updates: { coordinatorId: null, coordinatorLeaseUntil: null } });
        requeued += 1;
      }
    }
    return { requeued, deadLettered };
  });
}

export async function transitionTask(input: { accountId: string; taskId: string; coordinatorId: string; fenceToken: number; to: "PAUSED" | "WAITING_APPROVAL" | "RUNNING" | "SUCCEEDED" | "FAILED"; reason: string }, signer: AuditSigner) {
  return await withTransaction(async (transaction) => {
    const [task] = await transaction.select().from(v2Tasks).where(and(eq(v2Tasks.accountId, input.accountId), eq(v2Tasks.id, input.taskId), eq(v2Tasks.coordinatorId, input.coordinatorId), eq(v2Tasks.fenceToken, input.fenceToken), gt(v2Tasks.coordinatorLeaseUntil, now()))).limit(1);
    if (!task) throw new RelayError("CAPABILITY_DENIED", "Task coordinator lease or fence is stale.", undefined, 409);
    const updated = await transitionInTransaction(transaction, { accountId: input.accountId, taskId: input.taskId, from: task.status as TaskState, to: input.to, reason: input.reason, fenceToken: input.fenceToken });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, agentId: task.agentId, taskId: task.id, eventType: "task.transitioned", outcome: input.to, details: { from: task.status, to: input.to, reason: input.reason, fenceToken: input.fenceToken } }, signer);
    return updated;
  });
}

export async function cancelTask(input: { accountId: string; actorPrincipalId: string; taskId: string; reason: string }, gateway: TemporalGateway, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.actorPrincipalId, allowedRoles: ["OWNER", "ADMIN", "OPERATOR"] });
  const result = await withTransaction(async (transaction) => {
    const [task] = await transaction.select().from(v2Tasks).where(and(eq(v2Tasks.accountId, input.accountId), eq(v2Tasks.id, input.taskId))).limit(1);
    if (!task || ["SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTERED"].includes(task.status)) throw new RelayError("INVALID_INPUT", "Cancellable task not found.", undefined, 404);
    const cancelled = await transitionInTransaction(transaction, { accountId: input.accountId, taskId: task.id, from: task.status as TaskState, to: "CANCELLED", reason: input.reason, updates: { cancellationReason: input.reason } });
    await transaction.update(taskCommands).set({ status: "CANCELLED", updatedAt: now() }).where(and(eq(taskCommands.accountId, input.accountId), eq(taskCommands.taskId, task.id), inArray(taskCommands.status, ["PENDING", "PROCESSING"])));
    await transaction.insert(controlOutbox).values({ id: id("obx"), accountId: input.accountId, aggregateType: "task", aggregateId: task.id, type: "task.cancel.requested", payload: { reason: input.reason, workflowId: workflowId(input.accountId, task.id) }, idempotencyKey: `task-cancel:${task.id}` }).onConflictDoNothing();
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.actorPrincipalId, agentId: task.agentId, taskId: task.id, eventType: "task.cancelled", outcome: "CANCELLED", details: { reason: input.reason } }, signer);
    return cancelled;
  });
  let deliveryPending = false;
  try { await gateway.cancelWorkflow({ workflowId: workflowId(input.accountId, input.taskId), reason: input.reason }); } catch { deliveryPending = true; }
  return { task: result, deliveryPending };
}

export async function replayDeadLetter(input: { accountId: string; actorPrincipalId: string; deadLetterId: string }, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.actorPrincipalId, allowedRoles: ["OWNER", "ADMIN", "OPERATOR"] });
  return await withTransaction(async (transaction) => {
    const [entry] = await transaction.select().from(deadLetterEntries).where(and(eq(deadLetterEntries.accountId, input.accountId), eq(deadLetterEntries.id, input.deadLetterId), isNull(deadLetterEntries.replayedByTaskId))).limit(1);
    if (!entry) throw new RelayError("INVALID_INPUT", "Replayable dead letter not found.", undefined, 404);
    const [original] = await transaction.select().from(v2Tasks).where(and(eq(v2Tasks.accountId, input.accountId), eq(v2Tasks.id, entry.taskId))).limit(1);
    if (!original) throw new RelayError("INVALID_INPUT", "Dead-letter task is unavailable.", undefined, 404);
    const taskId = id("tsk");
    const [task] = await transaction.insert(v2Tasks).values({ id: taskId, accountId: input.accountId, eventId: original.eventId, routeId: original.routeId, logicalKey: `replay:${entry.id}`, agentId: original.agentId, status: "QUEUED", preferredRuntime: original.preferredRuntime, maxAttempts: original.maxAttempts, replayOfTaskId: original.id }).returning();
    await transaction.insert(taskStateHistory).values([{ id: id("tsh"), accountId: input.accountId, taskId, fromState: null, toState: "RECEIVED", reason: `replay ${entry.id}` }, { id: id("tsh"), accountId: input.accountId, taskId, fromState: "RECEIVED", toState: "ROUTED", reason: "original immutable route" }, { id: id("tsh"), accountId: input.accountId, taskId, fromState: "ROUTED", toState: "QUEUED", reason: "operator replay" }]);
    await enqueueStart(transaction, task!, "replay");
    await transaction.update(deadLetterEntries).set({ replayedByTaskId: taskId }).where(and(eq(deadLetterEntries.accountId, input.accountId), eq(deadLetterEntries.id, entry.id), isNull(deadLetterEntries.replayedByTaskId)));
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.actorPrincipalId, agentId: original.agentId, taskId, eventType: "dead_letter.replayed", outcome: "SUCCESS", details: { deadLetterId: entry.id, originalTaskId: original.id } }, signer);
    return { taskId };
  });
}

export async function publishOutboxBatch(publisher: { publish(message: typeof controlOutbox.$inferSelect): Promise<void> }, limit = 100) {
  const pending = await db().select().from(controlOutbox).where(isNull(controlOutbox.publishedAt)).orderBy(asc(controlOutbox.createdAt)).limit(limit);
  let published = 0;
  for (const message of pending) {
    await publisher.publish(message);
    const updated = await db().update(controlOutbox).set({ publishedAt: now() }).where(and(eq(controlOutbox.accountId, message.accountId), eq(controlOutbox.id, message.id), isNull(controlOutbox.publishedAt))).returning({ id: controlOutbox.id });
    if (updated.length) published += 1;
  }
  return published;
}

export async function runOrchestrationMaintenance(input: { signer: AuditSigner; publisher: { publish(message: typeof controlOutbox.$inferSelect): Promise<void> }; timestamp?: string }) {
  const recovery = await reapExpiredTaskCommands(input.signer, input.timestamp ?? now());
  const published = await publishOutboxBatch(input.publisher);
  return { ...recovery, published };
}

export function startOrchestrationWorker(input: { signer: AuditSigner; publisher: { publish(message: typeof controlOutbox.$inferSelect): Promise<void> }; intervalMs?: number }) {
  let stopped = false;
  const run = () => runOrchestrationMaintenance(input).catch((error) => console.error(JSON.stringify({ level: "error", event: "v2_orchestration_maintenance_failed", errorClass: error instanceof Error ? error.name : "UnknownError" })));
  const timer = setInterval(() => { if (!stopped) void run(); }, input.intervalMs ?? 5_000);
  return { run, stop() { stopped = true; clearInterval(timer); } };
}

export async function listTasks(accountId: string) { return await db().select().from(v2Tasks).where(eq(v2Tasks.accountId, accountId)).orderBy(asc(v2Tasks.createdAt)); }
export async function listDeadLetters(accountId: string) { return await db().select().from(deadLetterEntries).where(eq(deadLetterEntries.accountId, accountId)).orderBy(asc(deadLetterEntries.createdAt)); }
export async function listOutbox(accountId: string) { return await db().select().from(controlOutbox).where(eq(controlOutbox.accountId, accountId)).orderBy(asc(controlOutbox.createdAt)); }
