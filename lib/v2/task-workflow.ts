import { z } from "zod";
import { canTransition, taskTransitions, type TaskState } from "@/lib/v2/contracts";
import { RelayError } from "@/lib/errors";

export const TASK_WORKFLOW_TYPE = "relay.task.v1";
export const taskWorkflowInputSchema = z.object({
  schemaVersion: z.literal("relay.task-workflow.v1"), accountId: z.string().regex(/^acct_/), taskId: z.string().regex(/^tsk_/),
  agentId: z.string().regex(/^agt_/), eventId: z.string().regex(/^evt_/), fenceToken: z.number().int().positive(), preferredRuntime: z.string().optional(),
}).strict();

export type TaskWorkflowInput = z.infer<typeof taskWorkflowInputSchema>;
export type TaskWorkflowEvent =
  | { type: "CONTROL_PLANE_STATE"; state: TaskState; fenceToken: number }
  | { type: "PAUSE_REQUESTED"; fenceToken: number }
  | { type: "RESUME_REQUESTED"; fenceToken: number }
  | { type: "APPROVAL_REQUIRED"; fenceToken: number }
  | { type: "APPROVAL_RESOLVED"; fenceToken: number }
  | { type: "CANCEL_REQUESTED"; fenceToken: number };

export type TaskWorkflowSnapshot = { state: TaskState; fenceToken: number; terminal: boolean };

// This reducer is the deterministic Temporal workflow definition. The hosted
// control plane remains authoritative; signals carrying a stale fence cannot
// resurrect or mutate a newer coordinator generation.
export function reduceTaskWorkflow(snapshot: TaskWorkflowSnapshot, event: TaskWorkflowEvent): TaskWorkflowSnapshot {
  if (event.fenceToken !== snapshot.fenceToken) throw new RelayError("CAPABILITY_DENIED", "Workflow signal fence is stale.", undefined, 409);
  const next: TaskState = event.type === "CONTROL_PLANE_STATE" ? event.state
    : event.type === "PAUSE_REQUESTED" ? "PAUSED"
    : event.type === "RESUME_REQUESTED" || event.type === "APPROVAL_RESOLVED" ? "RUNNING"
    : event.type === "APPROVAL_REQUIRED" ? "WAITING_APPROVAL"
    : "CANCELLED";
  if (next !== snapshot.state && !canTransition(taskTransitions, snapshot.state, next)) throw new RelayError("INVALID_INPUT", `Invalid workflow transition ${snapshot.state} -> ${next}.`, undefined, 409);
  return { state: next, fenceToken: snapshot.fenceToken, terminal: ["SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTERED"].includes(next) };
}

export const taskWorkflowDefinition = {
  type: TASK_WORKFLOW_TYPE,
  workflowId: (accountId: string, taskId: string) => `relay/${accountId}/task/${taskId}`,
  signals: ["CONTROL_PLANE_STATE", "PAUSE_REQUESTED", "RESUME_REQUESTED", "APPROVAL_REQUIRED", "APPROVAL_RESOLVED", "CANCEL_REQUESTED"] as const,
  queries: ["state", "fenceToken"] as const,
  retryPolicy: { maximumAttempts: 1 }, // Relay's classified command ledger owns retries.
} as const;
