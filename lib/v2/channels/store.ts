import { sql, type SQL } from "drizzle-orm";
import { db, type RelayDatabase } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { id } from "@/lib/ids";
import { canonicalHash } from "@/lib/v2/contracts";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import type { ExecutionSnapshot } from "./contracts";

export async function rows<T>(query: SQL, tx: RelayDatabase = db()): Promise<T[]> { return (await tx.execute(query)).rows as T[]; }
export type Binding = { id: string; account_id: string; connection_id: string; owner_principal_id: string; agent_id: string; telegram_user_id: string; telegram_chat_id: string; created_at: Date; agent_status: string; agent_name: string };
export async function lockBinding(connectionId: string, tx: RelayDatabase) { await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram-binding:${connectionId}`},0))`); }
export async function currentBinding(bindingId: string, tx: RelayDatabase = db()): Promise<Binding | undefined> {
  return (await rows<Binding>(sql`SELECT b.*,a.status AS agent_status,a.name AS agent_name FROM telegram_bindings b
    JOIN communication_connections c ON c.id=b.connection_id AND c.account_id=b.account_id
    JOIN agents a ON a.id=b.agent_id AND a.account_id=b.account_id
    JOIN account_memberships m ON m.account_id=b.account_id AND m.principal_id=b.owner_principal_id AND m.status='ACTIVE' AND m.role='OWNER'
    JOIN principals p ON p.id=m.principal_id AND p.status='ACTIVE' AND p.type='HUMAN'
    WHERE b.id=${bindingId} AND b.revoked_at IS NULL AND c.revoked_at IS NULL AND c.status='CONNECTED'`,tx))[0];
}
export async function channelGranted(binding: Binding, capability: "channel.owner.receive" | "channel.owner.reply", tx: RelayDatabase = db()) {
  const [grant] = await rows<{effect: string}>(sql`SELECT effect FROM capability_grants WHERE account_id=${binding.account_id} AND agent_id=${binding.agent_id} AND capability=${capability}`,tx);
  return grant?.effect === "ALLOW";
}
export const decode = <T>(value: string): T => JSON.parse(decryptSecret(value)) as T;
export const encode = (value: unknown) => encryptSecret(JSON.stringify(value));
export type DeliveryContent = { bindingId: string; encrypted: string; system: boolean };
export type Reply = { text: string; buttons?: Array<{ text: string; data: string }> };
export function boundedReply(text: string) { return text.length <= 3800 ? text : `${text.slice(0,3650)}\n\nResult shortened for Telegram. Open the canonical Run for the full result.`; }
export async function enqueueReply(tx: RelayDatabase, input: { binding: Binding; threadId: string; taskId?: string; key: string; reply: Reply; system?: boolean }) {
  const messageId = id("cmm");
  const content: DeliveryContent = { bindingId: input.binding.id, encrypted: encode({ ...input.reply, text: boundedReply(input.reply.text) }), system: input.system ?? false };
  await tx.execute(sql`INSERT INTO communication_messages(id,account_id,connection_id,thread_id,direction,provider_message_id,sender_id,content,content_hash,classification,status,task_id,idempotency_key)
    VALUES(${messageId},${input.binding.account_id},${input.binding.connection_id},${input.threadId},'OUTBOUND',${`pending:${messageId}`},'relay',${JSON.stringify(content)}::jsonb,${canonicalHash(content)},'internal','RECEIVED',${input.taskId ?? null},${input.key}) ON CONFLICT(account_id,idempotency_key) DO NOTHING`);
}
export async function channelAudit(tx: RelayDatabase, signer: AuditSigner, binding: Binding, eventType: string, outcome: string, details: Record<string, unknown> = {}) {
  await appendAuditRecordInTransaction(tx,{accountId:binding.account_id,actorPrincipalId:binding.owner_principal_id,agentId:binding.agent_id,eventType,outcome,details},signer);
}
export function snapshotReply(snapshot: ExecutionSnapshot): Reply {
  if (snapshot.state === "COMPLETED") return { text: boundedReply(snapshot.text!) };
  if (snapshot.state === "FAILED") return { text: "I couldn't complete that request. Check the Run in Relay for the next step." };
  if (snapshot.state === "CANCELLED") return { text: "Your request was cancelled. No further work will start." };
  return { text: "Your request is still running." };
}
