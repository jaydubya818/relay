import { TelegramOwnerSender } from "./delivery";
import { OWNER_EXECUTOR_QUALIFIED } from "./contracts";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rows,currentBinding,channelGranted } from "./store";
import { RelayError } from "@/lib/errors";
import { parsePrivateTelegramUpdate,readBoundedTelegramBody,verifyTelegramSecret } from "@/lib/v2/telegram-input";
import { consumeTelegramPairingUpdate } from "@/lib/v2/telegram-pairing";
import { acceptChannelMessage } from "./ingress";
import { acceptChannelControl,parseTelegramControl } from "./controls";
import { channelConfiguration,type ChannelConfiguration } from "./config";

// Telegram redelivers every non-2xx update, in order, before any later update (max_connections=1).
// An authenticated update that can never succeed (replayed/expired pairing, revoked or unpaired
// sender, stale callback, malformed or oversized body) must therefore be acknowledged without
// executing it, or it blocks the owner's channel indefinitely. Authentication failures stay 401,
// and transient failures (timeouts, rate limits, unavailable storage or execution) keep a retryable
// status so Telegram redelivers them.
const TRANSIENT_STATUSES=new Set([408,429]);
export function permanentlyRejected(status:number){return status>=400&&status<500&&status!==401&&!TRANSIENT_STATUSES.has(status);}
const acknowledgedRejection=(code:string)=>Response.json({accepted:false,acknowledged:true,code},{status:200});

export async function telegramWebhook(request:Request,config:ChannelConfiguration=channelConfiguration(),acknowledge:(callbackId:string,text:string)=>Promise<boolean>=(callbackId,text)=>new TelegramOwnerSender(config.botToken).acknowledge(callbackId,text)) {
  if(!config.enabled||config.issues.length||!config.signer)return Response.json({accepted:false,code:"NOT_CONFIGURED"},{status:503});
  let authenticated=false;
  try {
    verifyTelegramSecret(config.webhookSecret,request.headers.get("x-telegram-bot-api-secret-token")??"");
    authenticated=true;
    if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return acknowledgedRejection("UNSUPPORTED_CONTENT");
    const rawBody=await readBoundedTelegramBody(request);
    let value:Record<string,unknown>;
    try { value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(rawBody)); if(!value || typeof value!=="object")throw new Error(); } catch { return acknowledgedRejection("INVALID_INPUT"); }
    if("callback_query" in value){
      const control=parseTelegramControl(value);
      try{
        const result=await acceptChannelControl(control,config,config.signer);
        await acknowledge(control.callbackId,result.alreadyHandled?"This decision was already recorded.":"Decision recorded. MyEve will check it before continuing.").catch(()=>false);
        return Response.json(result);
      }catch(error){await acknowledge(control.callbackId,"Request unavailable or expired. Check its status.").catch(()=>false);throw error;}
    }
    const update=parsePrivateTelegramUpdate(rawBody);
    if(update.text.startsWith("/start ")) {
      await consumeTelegramPairingUpdate({connectionId:config.connectionId,rawBody,secretToken:config.webhookSecret},{resolve:async(accountId,handle)=>{if(accountId!==config.accountId||handle!=="vlt_telegram_webhook")throw new Error("Wrong secret scope.");return config.webhookSecret;}},config.signer);
      return Response.json({accepted:true,paired:true});
    }
    return Response.json(await acceptChannelMessage(update,config,config.signer));
  }catch(error){
    if(error instanceof RelayError){
      if(authenticated&&permanentlyRejected(error.status))return acknowledgedRejection(error.code);
      return Response.json({accepted:false,code:error.code},{status:error.status});
    }
    // Never log parser exceptions, credentials, SQL parameters or message bodies.
    return Response.json({accepted:false,code:"UNAVAILABLE"},{status:503});
  }
}
export async function telegramReadiness(config=channelConfiguration()) {
  let storage=false,identityReady=false;
  try {await db().execute(sql`SELECT 1 FROM channel_work_links LIMIT 0`);storage=true;
    const [row]=await rows<{id:string}>(sql`SELECT id FROM telegram_bindings WHERE connection_id=${config.connectionId} AND account_id=${config.accountId} AND owner_principal_id=${config.ownerPrincipalId} AND agent_id=${config.agentId} AND revoked_at IS NULL`);
    const binding=row&&await currentBinding(row.id);
    identityReady=Boolean(binding&&binding.agent_status==="ACTIVE"&&await channelGranted(binding,"channel.owner.receive")&&await channelGranted(binding,"channel.owner.reply"));
  }catch{ /* Unavailable storage never admits work. */ }
  // executorQualified reports the immutable release constant; a local window is reported separately.
  const local=config.localQualification;
  return {healthy:true,ready:config.enabled&&config.issues.length===0&&storage,executorQualified:OWNER_EXECUTOR_QUALIFIED,
    localQualification:local?(local.active?{active:true,expiresAt:new Date(local.expiresAt).toISOString()}:{active:false,reason:local.reason}):null,
    executionReady:config.enabled&&config.executionEnabled&&config.issues.length===0&&storage&&identityReady,issues:config.issues,storageAvailable:storage,identityReady};
}
