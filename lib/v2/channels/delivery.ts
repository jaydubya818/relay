import { sql } from "drizzle-orm";
import { withTransaction } from "@/lib/db";
import { id } from "@/lib/ids";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import type { ChannelConfiguration } from "./config";
import { channelAudit,channelGranted,currentBinding,decode,lockBinding,rows,type DeliveryContent,type Reply } from "./store";

export type DeliveryOutcome={kind:"sent";messageId:string}|{kind:"retry";retryAfterSeconds:number}|{kind:"permanent"}|{kind:"authentication"}|{kind:"unknown"};
export interface OwnerChannelSender { send(input:{chatId:string;reply:Reply}):Promise<DeliveryOutcome> }
export class TelegramOwnerSender implements OwnerChannelSender {
  constructor(private readonly token:string,private readonly fetcher:typeof fetch=fetch) {}
  async acknowledge(callbackId:string,text:string):Promise<boolean> {
    if(!callbackId||callbackId.length>255||text.length>200)return false;
    try{
      const response=await this.fetcher(`https://api.telegram.org/bot${encodeURIComponent(this.token)}/answerCallbackQuery`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({callback_query_id:callbackId,text,cache_time:0}),redirect:"error",signal:AbortSignal.timeout(1500)});
      if(!response.ok)return false;
      const reader=response.body?.getReader();if(!reader)return false;let size=0;const chunks:Uint8Array[]=[];
      try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4096){await reader.cancel();return false;}chunks.push(part.value);}}finally{reader.releaseLock();}
      const result=JSON.parse(Buffer.concat(chunks).toString("utf8"));return result?.ok===true&&result.result===true;
    }catch{return false;}
  }
  async send(input:{chatId:string;reply:Reply}):Promise<DeliveryOutcome> {
    // Plain text: no Markdown/HTML parser, no arbitrary destination from model output.
    try {
      const response=await this.fetcher(`https://api.telegram.org/bot${encodeURIComponent(this.token)}/sendMessage`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:input.chatId,text:input.reply.text,link_preview_options:{is_disabled:true},...(input.reply.buttons?{reply_markup:{inline_keyboard:[input.reply.buttons.map(b=>({text:b.text,callback_data:b.data}))]}}:{})}),redirect:"error",signal:AbortSignal.timeout(10000)});
      if(response.status===401)return {kind:"authentication"};
      if(response.status>=500)return {kind:"unknown"};
      if(response.status===400||response.status===403||response.status===404)return {kind:"permanent"};
      const reader=response.body?.getReader();if(!reader)return {kind:"unknown"};
      let size=0;const chunks:Uint8Array[]=[];
      try{while(true){const value=await reader.read();if(value.done)break;size+=value.value.length;if(size>32768){await reader.cancel();return {kind:"unknown"};}chunks.push(value.value);}}finally{reader.releaseLock();}
      const body=JSON.parse(Buffer.concat(chunks).toString("utf8")) as {ok?:boolean;result?:{message_id?:number};parameters?:{retry_after?:number}};
      if(response.status===429&&body.ok===false)return {kind:"retry",retryAfterSeconds:Math.min(3600,Math.max(1,Number.isFinite(body.parameters?.retry_after)?body.parameters!.retry_after!:30))};
      if(response.ok&&body.ok===true&&Number.isSafeInteger(body.result?.message_id))return {kind:"sent",messageId:String(body.result!.message_id)};
      return {kind:"unknown"};
    }catch{return {kind:"unknown"};}
  }
}
export async function runChannelDeliveryCycle(config:ChannelConfiguration,sender:OwnerChannelSender,signer:AuditSigner) {
  if(!config.enabled||config.issues.length)return {processed:false};
  const claimed=await withTransaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('relay:channel-delivery-claim',0))`);
    await tx.execute(sql`UPDATE channel_delivery_attempts a SET outcome='RESULT_UNKNOWN',completed_at=now() FROM communication_messages m WHERE m.account_id=${config.accountId} AND m.connection_id=${config.connectionId} AND a.message_id=m.id AND a.outcome='SENDING' AND m.status='SENDING' AND m.updated_at<now()-interval '30 seconds'`);
    await tx.execute(sql`UPDATE communication_messages SET status='EFFECT_UNKNOWN',updated_at=now() WHERE account_id=${config.accountId} AND connection_id=${config.connectionId} AND direction='OUTBOUND' AND content ? 'bindingId' AND status='SENDING' AND updated_at<now()-interval '30 seconds'`);
    const [message]=await rows<{id:string;account_id:string;thread_id:string;content:DeliveryContent;attempt_count:number}>(sql`SELECT id,account_id,thread_id,content,attempt_count FROM communication_messages WHERE account_id=${config.accountId} AND connection_id=${config.connectionId} AND direction='OUTBOUND' AND content ? 'bindingId' AND (status='RECEIVED' OR status='FAILED' AND retry_after<=now()) AND attempt_count<3 AND NOT EXISTS(SELECT 1 FROM communication_messages busy WHERE busy.connection_id=${config.connectionId} AND busy.direction='OUTBOUND' AND busy.status='SENDING') ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,tx);
    if(!message)return;
    await tx.execute(sql`UPDATE communication_messages SET status='SENDING',attempt_count=attempt_count+1,retry_after=NULL,updated_at=now() WHERE id=${message.id}`);
    const attemptId=id("cda");
    await tx.execute(sql`INSERT INTO channel_delivery_attempts(id,account_id,message_id,attempt,outcome) VALUES(${attemptId},${message.account_id},${message.id},${message.attempt_count+1},'SENDING')`);
    return {...message,attemptId,attempt:message.attempt_count+1};
  });
  if(!claimed)return {processed:false};
  // The same transaction lock linearizes revoke against the final send boundary.
  await withTransaction(async tx=>{
    await lockBinding(config.connectionId,tx);
    const binding=await currentBinding(claimed.content.bindingId,tx);
    const [thread]=await rows<{external_conversation_id:string;recipient_id:string;connection_id:string}>(sql`SELECT external_conversation_id,recipient_id,connection_id FROM communication_threads WHERE id=${claimed.thread_id} AND account_id=${claimed.account_id}`,tx);
    const authorized=binding&&binding.account_id===config.accountId&&binding.connection_id===config.connectionId&&binding.owner_principal_id===config.ownerPrincipalId&&binding.agent_id===config.agentId&&thread?.connection_id===binding.connection_id&&thread.external_conversation_id===binding.telegram_chat_id&&thread.recipient_id===binding.telegram_user_id&&(claimed.content.system||binding.agent_status==="ACTIVE"&&await channelGranted(binding,"channel.owner.reply",tx));
    if(!authorized){await tx.execute(sql`UPDATE communication_messages SET status='SUPPRESSED',updated_at=now() WHERE id=${claimed.id}`);await tx.execute(sql`UPDATE channel_delivery_attempts SET outcome='CANCELLED',completed_at=now() WHERE id=${claimed.attemptId}`);return;}
    let outcome:DeliveryOutcome;
    try{outcome=await sender.send({chatId:binding.telegram_chat_id,reply:decode<Reply>(claimed.content.encrypted)});}catch{outcome={kind:"unknown"};}
    const status=outcome.kind==="sent"?"SENT":outcome.kind==="unknown"?"EFFECT_UNKNOWN":"FAILED";
    const retry=outcome.kind==="retry"&&claimed.attempt<3?new Date(Date.now()+Math.min(3600,Math.max(1,outcome.retryAfterSeconds))*1000).toISOString():null;
    await tx.execute(sql`UPDATE communication_messages SET status=${status}::communication_message_status,provider_message_id=${outcome.kind==="sent"?outcome.messageId:`pending:${claimed.id}`},provider_receipt=${JSON.stringify({classification:outcome.kind})}::jsonb,retry_after=${retry},updated_at=now() WHERE id=${claimed.id} AND status='SENDING'`);
    await tx.execute(sql`UPDATE channel_delivery_attempts SET outcome=${retry?"RETRYING":status},completed_at=now() WHERE id=${claimed.attemptId}`);
    if(outcome.kind==="authentication")await tx.execute(sql`UPDATE communication_connections SET status='ERROR',updated_at=now() WHERE id=${config.connectionId}`);
    await channelAudit(tx,signer,binding,"channel.delivery_attempt",retry?"RETRYING":status,{deliveryId:claimed.id,attempt:claimed.attempt});
  });
  return {processed:true};
}
