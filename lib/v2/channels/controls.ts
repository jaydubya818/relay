import { sql } from "drizzle-orm";
import { z } from "zod";
import { withTransaction } from "@/lib/db";
import { id } from "@/lib/ids";
import { RelayError } from "@/lib/errors";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import type { ChannelConfiguration } from "./config";
import { channelAudit, currentBinding, lockBinding, rows, decode, channelGranted } from "./store";
import type { ExecutionSnapshot } from "./contracts";

const callbackSchema=z.object({update_id:z.number().int().nonnegative(),callback_query:z.object({id:z.string().min(1).max(255),from:z.object({id:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),is_bot:z.literal(false)}),message:z.object({message_id:z.number().int().positive(),chat:z.object({id:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),type:z.literal("private")})}),data:z.string().min(1).max(64)}).passthrough()}).strict();
export function parseTelegramControl(value:unknown) {
  const parsed=callbackSchema.safeParse(value);
  if(!parsed.success) throw new RelayError("INVALID_INPUT","Unsupported callback.",undefined,400);
  const c=parsed.data.callback_query;
  if(c.from.id!==c.message.chat.id) throw new RelayError("CAPABILITY_DENIED","Wrong callback identity.",undefined,403);
  const match=/^(ctl_[a-f0-9]+):(approve|reject|occurred|not_occurred|unresolved)$/.exec(c.data);
  if(!match) throw new RelayError("INVALID_INPUT","Invalid callback reference.",undefined,400);
  return {userId:String(c.from.id),chatId:String(c.message.chat.id),controlId:match[1],choice:match[2],callbackId:c.id};
}
export async function acceptChannelControl(input:ReturnType<typeof parseTelegramControl>,config:ChannelConfiguration,signer:AuditSigner) {
  if(!config.executionEnabled) throw new RelayError("CAPABILITY_DENIED","Execution is disabled.",undefined,503);
  return await withTransaction(async tx=>{
    await lockBinding(config.connectionId,tx);
    const [control]=await rows<{id:string;account_id:string;task_id:string;binding_id:string;reference:string;binding_hash:string;kind:string;choice:string|null;expires_at:Date;consumed_at:Date|null}>(sql`SELECT * FROM channel_controls WHERE id=${input.controlId} AND account_id=${config.accountId} FOR UPDATE`,tx);
    const binding=control && await currentBinding(control.binding_id,tx);
    if(!control || !binding || binding.connection_id!==config.connectionId || binding.owner_principal_id!==config.ownerPrincipalId || binding.agent_id!==config.agentId || binding.telegram_user_id!==input.userId || binding.telegram_chat_id!==input.chatId || binding.agent_status!=="ACTIVE" || !await channelGranted(binding,"channel.owner.receive",tx)) throw new RelayError("CAPABILITY_DENIED","Callback denied.",undefined,403);
    if(control.consumed_at) return {accepted:true,alreadyHandled:true};
    if(new Date(control.expires_at).getTime()<=Date.now()) throw new RelayError("CAPABILITY_DENIED","This request expired. Nothing was approved.",undefined,403);
    const [work]=await rows<{snapshot_encrypted:string}>(sql`SELECT snapshot_encrypted FROM channel_work_links WHERE task_id=${control.task_id} AND account_id=${config.accountId}`,tx);
    const pending=work?.snapshot_encrypted?decode<ExecutionSnapshot>(work.snapshot_encrypted).pending:undefined;
    if(!pending || pending.reference!==control.reference || pending.bindingHash!==control.binding_hash || pending.kind!==control.kind) throw new RelayError("CAPABILITY_DENIED","The pending action changed.",undefined,403);
    if(!(control.kind==="approval"?["approve","reject"]:["occurred","not_occurred","unresolved"]).includes(input.choice)) throw new RelayError("CAPABILITY_DENIED","Wrong decision class.",undefined,403);
    await tx.execute(sql`UPDATE channel_controls SET choice=${input.choice},consumed_at=now(),updated_at=now() WHERE id=${control.id}`);
    await tx.execute(sql`INSERT INTO task_commands(id,account_id,task_id,kind,idempotency_key,payload) VALUES(${id("cmd")},${config.accountId},${control.task_id},${control.kind==="approval"?"CHANNEL_APPROVAL":"CHANNEL_RECOVERY"},${`channel-control:${control.id}`},${JSON.stringify({controlId:control.id})}::jsonb) ON CONFLICT(account_id,idempotency_key) DO NOTHING`);
    await channelAudit(tx,signer,binding,"channel.owner_decision_queued","PENDING",{taskId:control.task_id,controlId:control.id,choice:input.choice});
    return {accepted:true,alreadyHandled:false};
  });
}
