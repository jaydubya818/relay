import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, withTransaction } from "@/lib/db";
import { channelExecutionNonces, channelExecutionReceipts } from "@/lib/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { canonicalHash } from "@/lib/v2/contracts";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { executionSnapshotSchema, type CanonicalOwnerExecutor, type Environment, type ExecutionCommand, type ExecutionTransport } from "./contracts";
import { signExecution, verifyExecution } from "./signing";

export class ExecutorUnavailable extends Error {}
export class ExecutorOutcomeUnknown extends Error {}
export class ExecutorNotAdmitted extends Error {}
const nonAdmissionSchema=z.object({code:z.literal("OWNER_WORK_NOT_ADMITTED"),requestId:z.string(),ownerPrincipalId:z.string(),agentId:z.string(),workHash:z.string()}).strict();

/** Executor-side handler. Mount in the executor's authenticated owner-ingress host.
 * Nonces and receipt storage must be in that host's durable isolated database.
 * Transport retries reconcile via status; an uncommitted response never permits
 * re-invoking the original command. Runtime handle must durably admit commands.
 */
export async function receiveOwnerExecution(value: unknown, options: { environment: Environment; audience: string; keys: Record<string, string>; executor: CanonicalOwnerExecutor }) {
  const envelope = verifyExecution(value, options);
  const command = envelope.command;
  await options.executor.authorize(command);
  const replay = await withTransaction(async (tx) => {
    const nonce = await tx.insert(channelExecutionNonces).values({ nonce: envelope.nonce, accountId: command.work.accountId, environment: envelope.environment, expiresAt: new Date(envelope.expiresAt * 1000).toISOString() }).onConflictDoNothing().returning();
    if (!nonce.length) throw new Error("Execution replay denied.");
    const inserted = await tx.insert(channelExecutionReceipts).values({ commandId: command.commandId, accountId: command.work.accountId, requestId: command.work.requestId, payloadHash: envelope.payloadHash }).onConflictDoNothing().returning();
    if (inserted.length) return null;
    const [existing] = await tx.select().from(channelExecutionReceipts).where(eq(channelExecutionReceipts.commandId, command.commandId));
    if (!existing || existing.accountId !== command.work.accountId || existing.payloadHash !== canonicalHash(command)) throw new Error("Execution command binding changed.");
    if (!existing.responseEncrypted) throw new ExecutorOutcomeUnknown("Canonical result requires reconciliation.");
    return executionSnapshotSchema.parse(JSON.parse(decryptSecret(existing.responseEncrypted)));
  });
  if (replay) return replay;
  const snapshot = executionSnapshotSchema.parse(await options.executor.handle(command));
  assertSnapshotBinding(command, snapshot);
  await db().update(channelExecutionReceipts).set({ responseEncrypted: encryptSecret(JSON.stringify(snapshot)), updatedAt: new Date().toISOString() }).where(and(eq(channelExecutionReceipts.commandId, command.commandId), eq(channelExecutionReceipts.accountId, command.work.accountId)));
  return snapshot;
}
export function assertSnapshotBinding(command: ExecutionCommand, snapshot: ReturnType<typeof executionSnapshotSchema.parse>) {
  if (snapshot.requestId !== command.work.requestId || snapshot.ownerPrincipalId !== command.work.ownerPrincipalId || snapshot.agentId !== command.work.agentId) throw new Error("Executor result identity mismatch.");
}
export class HttpOwnerExecutor implements ExecutionTransport {
  constructor(private readonly config: { endpoint: string; audience: string; environment: Environment; signer: AuditSigner }, private readonly fetcher: typeof fetch = fetch) {
    const url = new URL(config.endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Pinned HTTPS executor required.");
  }
  async call(command: ExecutionCommand) {
    const assertion = await signExecution(command, this.config.signer, this.config.environment, this.config.audience);
    let response: Response;
    try { response = await this.fetcher(this.config.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(assertion), redirect: "error", signal: AbortSignal.timeout(10000) }); }
    catch { throw new ExecutorOutcomeUnknown("Executor response unavailable; reconcile only."); }
    if (!response.ok && response.status !== 409) throw new ExecutorOutcomeUnknown("Executor did not return a confirmed receipt.");
    const reader = response.body?.getReader();
    if (!reader) throw new ExecutorOutcomeUnknown("Executor receipt missing.");
    let bytes = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 32768) { await reader.cancel(); throw new Error(); } chunks.push(item.value); } }
    catch { throw new ExecutorOutcomeUnknown("Executor receipt unavailable."); }
    finally { reader.releaseLock(); }
    let value:unknown;
    try{value=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{throw new ExecutorOutcomeUnknown("Executor receipt invalid.");}
    if(response.status===409){
      const proof=nonAdmissionSchema.safeParse(value);
      if(command.operation==="status" && proof.success && proof.data.requestId===command.work.requestId
        && proof.data.ownerPrincipalId===command.work.ownerPrincipalId && proof.data.agentId===command.work.agentId
        && proof.data.workHash===canonicalHash(command.work))throw new ExecutorNotAdmitted("Authenticated executor confirms exact work was not admitted.");
      throw new ExecutorOutcomeUnknown("Executor non-admission proof invalid.");
    }
    const result = executionSnapshotSchema.safeParse(value);
    if (!result.success) throw new ExecutorOutcomeUnknown("Executor receipt invalid.");
    assertSnapshotBinding(command, result.data);
    return result.data;
  }
}
