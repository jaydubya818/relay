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

export async function telegramWebhook(request:Request,config:ChannelConfiguration=channelConfiguration(),acknowledge:(callbackId:string,text:string)=>Promise<boolean>=(callbackId,text)=>new TelegramOwnerSender(config.botToken).acknowledge(callbackId,text)) {
  if(!config.enabled||config.issues.length||!config.signer)return Response.json({accepted:false,code:"NOT_CONFIGURED"},{status:503});
  try {
    verifyTelegramSecret(config.webhookSecret,request.headers.get("x-telegram-bot-api-secret-token")??"");
    if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))return Response.json({accepted:false,code:"UNSUPPORTED_CONTENT"},{status:415});
    const rawBody=await readBoundedTelegramBody(request);
    let value:Record<string,unknown>;
    try { value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(rawBody)); if(!value || typeof value!=="object")throw new Error(); } catch { return Response.json({accepted:false,code:"INVALID_INPUT"},{status:400}); }
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
    if(error instanceof RelayError)return Response.json({accepted:false,code:error.code},{status:error.status});
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
