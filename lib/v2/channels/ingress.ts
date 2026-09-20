import { sql } from "drizzle-orm";
import { withTransaction } from "@/lib/db";
import { id, now } from "@/lib/ids";
import { RelayError } from "@/lib/errors";
import { canonicalHash } from "@/lib/v2/contracts";
import { communicationEventSource } from "@/lib/v2/communications";
import { ingestVerifiedEvent } from "@/lib/v2/orchestration";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import type { parsePrivateTelegramUpdate } from "@/lib/v2/telegram-input";
import { channelAudit, channelGranted, currentBinding, encode, enqueueReply, lockBinding, rows } from "./store";
import type { ChannelConfiguration } from "./config";

export async function acceptChannelMessage(update: ReturnType<typeof parsePrivateTelegramUpdate>, config: ChannelConfiguration, signer: AuditSigner) {
  return await withTransaction(async tx => {
    await lockBinding(config.connectionId,tx);
    const [candidate] = await rows<{id:string}>(sql`SELECT id FROM telegram_bindings WHERE connection_id=${config.connectionId} AND account_id=${config.accountId} AND telegram_user_id=${update.userId} AND telegram_chat_id=${update.chatId} AND revoked_at IS NULL`,tx);
    const binding = candidate && await currentBinding(candidate.id,tx);
    if (!binding || binding.owner_principal_id!==config.ownerPrincipalId || binding.agent_id!==config.agentId) throw new RelayError("CAPABILITY_DENIED","Pairing required.",undefined,403);
    if (update.sentAtSeconds < Math.floor(new Date(binding.created_at).getTime()/1000)) throw new RelayError("CAPABILITY_DENIED","Message predates pairing.",undefined,403);
    const [duplicate] = await rows<{id:string;task_id:string|null}>(sql`SELECT id,task_id FROM communication_messages WHERE connection_id=${config.connectionId} AND direction='INBOUND' AND (provider_event_id=${update.updateId} OR (provider_message_id=${update.messageId} AND sender_id=${update.userId}))`,tx);
    if (duplicate) return { accepted:true,duplicate:true,messageId:duplicate.id,taskId:duplicate.task_id };
    const [{count}] = await rows<{count:number}>(sql`SELECT count(*)::int AS count FROM communication_messages WHERE connection_id=${config.connectionId} AND direction='INBOUND' AND created_at>now()-interval '1 minute'`,tx);
    const [{pending}] = await rows<{pending:number}>(sql`SELECT count(*)::int AS pending FROM channel_work_links w JOIN v2_tasks t ON t.id=w.task_id WHERE w.binding_id=${binding.id} AND t.status NOT IN ('SUCCEEDED','FAILED','CANCELLED','DEAD_LETTERED')`,tx);
    if (count>=10 || pending>=4 && !update.text.startsWith("/")) throw new RelayError("RATE_LIMITED","Please wait for your current requests.",undefined,429);
    let [thread] = await rows<{id:string}>(sql`SELECT id FROM communication_threads WHERE connection_id=${config.connectionId} AND external_conversation_id=${update.chatId} AND external_thread_id=''`,tx);
    if (!thread) { thread={id:id("cmt")}; await tx.execute(sql`INSERT INTO communication_threads(id,account_id,connection_id,external_conversation_id,external_thread_id,recipient_id,known_recipient) VALUES(${thread.id},${binding.account_id},${config.connectionId},${update.chatId},'',${update.userId},true)`); }
    const messageId=id("cmm"), content={bindingId:binding.id,encrypted:encode({text:update.text})};
    await tx.execute(sql`INSERT INTO communication_messages(id,account_id,connection_id,thread_id,direction,provider_message_id,provider_event_id,sender_id,content,content_hash,classification,status,idempotency_key)
      VALUES(${messageId},${binding.account_id},${config.connectionId},${thread.id},'INBOUND',${update.messageId},${update.updateId},${update.userId},${JSON.stringify(content)}::jsonb,${canonicalHash(content)},'internal','RECEIVED',${`telegram:${config.connectionId}:${update.updateId}`})`);
    let safeResponse: string|undefined;
    if (update.text.startsWith("/")) {
      if (update.text === "/help" || update.text === "/start") safeResponse="Send a text request to your assigned Agent. Use /status to check work. Approvals and recovery use the buttons on the exact request. Manage or revoke pairing in Relay.";
      else if (update.text === "/status") { const status=await rows<{status:string}>(sql`SELECT t.status FROM channel_work_links w JOIN v2_tasks t ON t.id=w.task_id WHERE w.binding_id=${binding.id} ORDER BY w.created_at DESC LIMIT 1`,tx); safeResponse=`Agent: ${binding.agent_name}. ${!config.executionEnabled?"Execution is disabled in this environment.":binding.agent_status!=="ACTIVE"?"This Agent is currently unavailable.":status[0]?`Request: ${status[0].status.toLowerCase().replaceAll("_"," ")}.`:"No requests yet."}`; }
      else safeResponse="That command isn't supported. Use /help or /status.";
    } else if (!config.executionEnabled) safeResponse="Telegram is connected, but Agent execution is not enabled in this environment.";
    else if (binding.agent_status!=="ACTIVE") safeResponse="This Agent is currently unavailable. No other Agent was selected.";
    else if (!await channelGranted(binding,"channel.owner.receive",tx) || !await channelGranted(binding,"channel.owner.reply",tx)) safeResponse="This Agent does not have the required channel permission. No work was started.";
    if (safeResponse) {
      await enqueueReply(tx,{binding,threadId:thread.id,key:`channel-status:${messageId}`,reply:{text:safeResponse},system:true});
      await tx.execute(sql`UPDATE communication_messages SET status='SUPPRESSED' WHERE id=${messageId}`);
      await channelAudit(tx,signer,binding,"channel.ingress_control","SUPPRESSED",{messageId});
      return {accepted:true,duplicate:false,messageId,taskId:null};
    }
    const source=communicationEventSource("TELEGRAM",config.connectionId);
    const routes=await rows<{agent_id:string}>(sql`SELECT agent_id FROM event_routes WHERE account_id=${binding.account_id} AND source=${source} AND event_type='owner.channel.requested' AND status='ACTIVE'`,tx);
    if(routes.length!==1 || routes[0].agent_id!==binding.agent_id) throw new RelayError("CAPABILITY_DENIED","Channel route unavailable.",undefined,503);
    const event=await ingestVerifiedEvent({envelope:{specversion:"1.0",id:update.updateId,source,type:"owner.channel.requested",time:now(),accountid:binding.account_id,classification:"internal",correlationid:messageId,dedupekey:`${binding.id}:${update.messageId}`,schemaversion:"relay.owner-channel.v1",signaturestatus:"verified",data:{messageId,threadId:thread.id,bindingId:binding.id,ownerPrincipalId:binding.owner_principal_id,agentId:binding.agent_id}},rawBody:new Uint8Array(),headers:{}},{verify:async()=>({valid:true,evidence:{channel:"telegram",bindingId:binding.id}})},signer,tx);
    if(event.taskIds.length!==1) throw new Error("Channel admission requires exactly one canonical task.");
    const taskId=event.taskIds[0];
    await tx.execute(sql`UPDATE task_commands SET kind='CHANNEL_START' WHERE account_id=${binding.account_id} AND task_id=${taskId} AND kind='START_TASK'`);
    await tx.execute(sql`INSERT INTO channel_work_links(task_id,account_id,binding_id,message_id,expires_at) VALUES(${taskId},${binding.account_id},${binding.id},${messageId},now()+interval '24 hours')`);
    await tx.execute(sql`UPDATE communication_messages SET status='ROUTED',task_id=${taskId} WHERE id=${messageId}`);
    await channelAudit(tx,signer,binding,"channel.ingress_accepted","QUEUED",{messageId,taskId,threadId:thread.id});
    return {accepted:true,duplicate:false,messageId,taskId};
  });
}
