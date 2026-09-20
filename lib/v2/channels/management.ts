import { sql } from "drizzle-orm";
import { withTransaction } from "@/lib/db";
import { id } from "@/lib/ids";
import { requireMembership } from "@/lib/v2/identity";
import { publishEventRoute } from "@/lib/v2/orchestration";
import { communicationEventSource } from "@/lib/v2/communications";
import { createTelegramPairingChallenge,revokeTelegramBinding } from "@/lib/v2/telegram-pairing";
import { channelConfiguration,type ChannelConfiguration } from "./config";
import { channelAudit,currentBinding,rows } from "./store";

async function owner(accountId:string,principalId:string,config:ChannelConfiguration) {
  await requireMembership({accountId,principalId,allowedRoles:["OWNER"]});
  if(config.accountId!==accountId||config.ownerPrincipalId!==principalId)throw new Error("This deployment is not configured for this owner.");
}
export async function telegramManagement(accountId:string,principalId:string,config=channelConfiguration()) {
  await requireMembership({accountId,principalId,allowedRoles:["OWNER"]});
  if(!config.enabled||config.accountId!==accountId||config.ownerPrincipalId!==principalId||config.issues.length)return {state:"NOT_CONFIGURED",enabled:false,issues:config.accountId===accountId?config.issues:[],agentName:null,bindingId:null,lastActivity:null,executionEnabled:false};
  const [agent]=await rows<{name:string;status:string}>(sql`SELECT name,status FROM agents WHERE id=${config.agentId} AND account_id=${accountId}`);
  const [binding]=await rows<{id:string;revoked_at:Date|null;updated_at:Date}>(sql`SELECT id,revoked_at,updated_at FROM telegram_bindings WHERE connection_id=${config.connectionId} AND account_id=${accountId} ORDER BY created_at DESC LIMIT 1`);
  const [connection]=await rows<{status:string}>(sql`SELECT status FROM communication_connections WHERE id=${config.connectionId} AND account_id=${accountId}`);
  const [activity]=await rows<{last_activity:Date|null}>(sql`SELECT max(created_at) AS last_activity FROM communication_messages WHERE connection_id=${config.connectionId} AND account_id=${accountId}`);
  const [waiting]=await rows<{count:number}>(sql`SELECT count(*)::int AS count FROM channel_work_links w JOIN v2_tasks t ON t.id=w.task_id WHERE w.account_id=${accountId} AND w.binding_id=${binding?.id??""} AND t.status IN ('WAITING_APPROVAL','PAUSED')`);
  const [failed]=await rows<{count:number}>(sql`SELECT count(*)::int AS count FROM communication_messages WHERE account_id=${accountId} AND connection_id=${config.connectionId} AND direction='OUTBOUND' AND status IN ('FAILED','EFFECT_UNKNOWN') AND retry_after IS NULL`);
  const state=connection?.status==="ERROR"?"PROVIDER_ATTENTION":binding?.revoked_at?"REVOKED":!agent||agent.status!=="ACTIVE"?"AGENT_UNAVAILABLE":!binding?"READY_TO_PAIR":!config.executionEnabled?"EXECUTION_DISABLED":waiting.count?"APPROVAL_WAITING":failed.count?"DELIVERY_FAILURE":"PAIRED";
  return {state,enabled:true,issues:[],agentName:agent?.name??null,bindingId:binding?.revoked_at?null:binding?.id??null,lastActivity:activity.last_activity?.toISOString()??null,executionEnabled:config.executionEnabled};
}
export async function setupTelegramPairing(accountId:string,principalId:string,config=channelConfiguration()) {
  await owner(accountId,principalId,config);
  if(!config.enabled||config.issues.length||!config.signer)throw new Error("Telegram is not configured.");
  const [revoked]=await rows<{id:string}>(sql`SELECT id FROM telegram_bindings WHERE connection_id=${config.connectionId} AND revoked_at IS NOT NULL LIMIT 1`);
  if(revoked)throw new Error("Re-pairing requires a new deployment connection identity; stale callbacks stay revoked.");
  await withTransaction(async tx=>{
    const [agent]=await rows<{id:string}>(sql`SELECT id FROM agents WHERE id=${config.agentId} AND account_id=${accountId} AND status='ACTIVE'`,tx);if(!agent)throw new Error("Assigned Agent unavailable.");
    await tx.execute(sql`INSERT INTO communication_connections(id,account_id,provider,external_account_id,owned_identity_id,credential_handle,webhook_secret_handle) VALUES(${config.connectionId},${accountId},'TELEGRAM',${config.botUsername},${config.botUsername},'vlt_telegram_token','vlt_telegram_webhook') ON CONFLICT(id) DO NOTHING`);
    const [connection]=await rows<{id:string}>(sql`SELECT id FROM communication_connections WHERE id=${config.connectionId} AND account_id=${accountId} AND provider='TELEGRAM' AND external_account_id=${config.botUsername} AND revoked_at IS NULL AND status='CONNECTED'`,tx);if(!connection)throw new Error("Connection binding unavailable.");
    for(const capability of ["channel.owner.receive","channel.owner.reply"])await tx.execute(sql`INSERT INTO capability_grants(id,account_id,agent_id,capability,effect) VALUES(${id("grt")},${accountId},${config.agentId},${capability},'ALLOW') ON CONFLICT(agent_id,capability) DO UPDATE SET effect='ALLOW' WHERE capability_grants.account_id=${accountId}`);
  });
  await publishEventRoute({accountId,actorPrincipalId:principalId,name:`owner-channel:${config.connectionId}`,source:communicationEventSource("TELEGRAM",config.connectionId),eventType:"owner.channel.requested",agentId:config.agentId,maxAttempts:3},config.signer);
  const challenge=await createTelegramPairingChallenge({accountId,ownerPrincipalId:principalId,connectionId:config.connectionId,agentId:config.agentId},config.signer);
  return {url:`https://t.me/${config.botUsername}?start=${challenge.secret}`,expiresAt:challenge.expiresAt};
}
export async function disconnectTelegram(accountId:string,principalId:string,bindingId:string,config=channelConfiguration()) {
  await owner(accountId,principalId,config);if(!config.signer)throw new Error("Signing unavailable.");
  const binding=await currentBinding(bindingId);if(!binding||binding.connection_id!==config.connectionId)throw new Error("Binding unavailable.");
  await revokeTelegramBinding({accountId,ownerPrincipalId:principalId,bindingId},config.signer);
  await withTransaction(async tx=>{await channelAudit(tx,config.signer!,binding,"channel.disconnected","REVOKED");});
  return {revoked:true};
}
