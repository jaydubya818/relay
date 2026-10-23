import { z } from "zod";

const ref = z.string().min(1).max(255);
export const workRequestSchema = z.object({
  version: z.literal("relay.owner-work.v1"), requestId: ref, accountId: ref,
  ownerPrincipalId: ref, agentId: ref, threadId: ref, taskId: ref,
  sourceIdentity: ref, ingress: z.literal("owner_telegram"),
  requestedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  message: z.string().min(1).max(4096),
  budget: z.object({ runtimeSeconds: z.literal(60), modelSteps: z.literal(8), tokens: z.literal(12000), modelSpendUsd: z.literal("0.10"), actions: z.literal(12) }).strict(),
}).strict();
export type WorkRequest = z.infer<typeof workRequestSchema>;
export const WORK_BUDGET = { runtimeSeconds: 60, modelSteps: 8, tokens: 12000, modelSpendUsd: "0.10", actions: 12 } as const;
export const executionCommandSchema = z.object({
  commandId: ref, work: workRequestSchema,
  operation: z.enum(["start", "status", "approval", "recovery", "cancel"]),
  decision: z.object({ reference: ref, bindingHash: ref, choice: z.enum(["approve", "reject", "occurred", "not_occurred", "unresolved"]) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.operation === "approval" || value.operation === "recovery") !== Boolean(value.decision)) ctx.addIssue({ code: "custom", message: "Decision required only for approval/recovery." });
  if (value.decision && (value.operation === "approval" ? !["approve", "reject"].includes(value.decision.choice) : !["occurred", "not_occurred", "unresolved"].includes(value.decision.choice))) ctx.addIssue({ code: "custom", message: "Wrong decision class." });
});
export type ExecutionCommand = z.infer<typeof executionCommandSchema>;
export const executionSnapshotSchema = z.object({
  requestId: ref, ownerPrincipalId: ref, agentId: ref, runId: ref,
  state: z.enum(["RUNNING", "WAITING_APPROVAL", "RECOVERY_REQUIRED", "COMPLETED", "FAILED", "CANCELLED"]),
  resultId: ref.optional(), text: z.string().max(12000).optional(),
  pending: z.object({ kind: z.enum(["approval", "recovery"]), reference: ref, bindingHash: ref,
    summary: z.string().min(1).max(500), consequence: z.string().max(500), target: z.string().max(255),
    expiresAt: z.string().datetime(), estimatedCost: z.string().max(80).nullable(),
  }).strict().optional(),
}).strict().superRefine((v, ctx) => {
  if (["WAITING_APPROVAL", "RECOVERY_REQUIRED"].includes(v.state) !== Boolean(v.pending)) ctx.addIssue({ code: "custom", message: "Pending reference/state mismatch." });
  if (v.pending && (v.state === "WAITING_APPROVAL" ? v.pending.kind !== "approval" : v.pending.kind !== "recovery")) ctx.addIssue({ code: "custom", message: "Pending kind mismatch." });
  if (v.state === "COMPLETED" && (!v.resultId || !v.text)) ctx.addIssue({ code: "custom", message: "Completed work requires a result." });
});
export type ExecutionSnapshot = z.infer<typeof executionSnapshotSchema>;

/** Runtime owns Runs, Actions, Context Assembly, approvals, receipts and recovery.
 * Each commandId is idempotent, start durably admits once, status never starts work,
 * and decisions resume only the immutable pending action. Never interpret a channel
 * command as capability authority. Implementations must enforce budget/checkpoints.
 */
export interface CanonicalOwnerExecutor {
  authorize(command: ExecutionCommand): Promise<void>;
  handle(command: ExecutionCommand): Promise<ExecutionSnapshot>;
}
export interface ExecutionTransport { call(command: ExecutionCommand): Promise<ExecutionSnapshot> }
export type Environment = "development" | "preview" | "production";

/** Release gate: transport fixtures do not qualify the canonical MyEve adapter. */
export const OWNER_EXECUTOR_QUALIFIED: boolean = false;
