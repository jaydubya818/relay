import { sql } from "drizzle-orm";
import { withTransaction,type RelayDatabase } from "@/lib/db";
import { id } from "@/lib/ids";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { WORK_BUDGET,executionSnapshotSchema,type ExecutionTransport,type WorkRequest } from "./contracts";
import type { ChannelConfiguration } from "./config";
import { channelAudit,decode,encode,rows,lockBinding,type Binding } from "./store";

export async function enqueueChannelCancellation(tx:RelayDatabase,accountId:string,taskId:string){
 await tx.execute(sql`INSERT INTO task_commands(id,account_id,task_id,kind,idempotency_key)
 VALUES(${id('cmd')},${accountId},${taskId},'CHANNEL_CANCEL',${`channel-cancel:${taskId}`})
 ON CONFLICT(account_id,idempotency_key) DO NOTHING`);
 await tx.execute(sql`UPDATE task_commands SET status='CANCELLED',lease_until=NULL,updated_at=now() WHERE account_id=${accountId} AND task_id=${taskId} AND kind LIKE 'CHANNEL_%' AND kind<>'CHANNEL_CANCEL' AND status IN ('PENDING','PROCESSING')`);
 await tx.execute(sql`UPDATE v2_tasks SET status='CANCELLED',completed_at=now(),updated_at=now() WHERE account_id=${accountId} AND id=${taskId} AND status NOT IN ('SUCCEEDED','FAILED','CANCELLED','DEAD_LETTERED')`);
}
/** Cancellation only reduces authority. It drains even after ingress/execution
 * is disabled, and never requires a currently active Telegram binding. */
export async function runChannelCancellationCycle(config:ChannelConfiguration,transport:ExecutionTransport,signer:AuditSigner,workerId=id('cancel-worker')){
 if(config.issues.length)return {processed:false};
 const claim=await withTransaction(async tx=>{
  if(!config.enabled||!config.executionEnabled){
   await lockBinding(config.connectionId,tx);
   const pending=await rows<{task_id:string}>(sql`SELECT w.task_id FROM channel_work_links w JOIN v2_tasks t ON t.id=w.task_id JOIN telegram_bindings b ON b.id=w.binding_id WHERE w.account_id=${config.accountId} AND b.connection_id=${config.connectionId} AND b.owner_principal_id=${config.ownerPrincipalId} AND b.agent_id=${config.agentId} AND t.status NOT IN ('SUCCEEDED','FAILED','CANCELLED','DEAD_LETTERED') LIMIT 25`,tx);
   for(const work of pending)await enqueueChannelCancellation(tx,config.accountId,work.task_id);
  }
  const [row]=await rows<{id:string;task_id:string;fence_token:number;attempt:number;binding_id:string;run_id:string|null;created_at:Date;expires_at:Date;thread_id:string;content:{encrypted:string};binding:Binding}>(sql`
   SELECT c.id,c.task_id,c.fence_token,c.attempt,w.binding_id,w.run_id,w.created_at,w.expires_at,m.thread_id,m.content,
    to_jsonb(b)||jsonb_build_object('agent_name',a.name,'agent_status',a.status) AS binding
   FROM task_commands c JOIN channel_work_links w ON w.task_id=c.task_id AND w.account_id=c.account_id
   JOIN telegram_bindings b ON b.id=w.binding_id AND b.account_id=c.account_id
   JOIN agents a ON a.id=b.agent_id AND a.account_id=b.account_id
   JOIN communication_messages m ON m.id=w.message_id AND m.account_id=w.account_id
   WHERE c.account_id=${config.accountId} AND b.connection_id=${config.connectionId}
    AND b.owner_principal_id=${config.ownerPrincipalId} AND b.agent_id=${config.agentId}
    AND c.kind='CHANNEL_CANCEL' AND ((c.status='PENDING' AND c.run_after<=now()) OR (c.status='PROCESSING' AND c.lease_until<now()))
   ORDER BY c.created_at LIMIT 1 FOR UPDATE OF c SKIP LOCKED`,tx);
  if(!row)return;
  if(row.attempt>=12){await tx.execute(sql`UPDATE task_commands SET status='DEAD_LETTERED',lease_until=NULL WHERE id=${row.id}`);await channelAudit(tx,signer,row.binding,'channel.cancellation_unconfirmed','REVIEW_REQUIRED',{taskId:row.task_id});return;}
  const fence=row.fence_token+1;
  await tx.execute(sql`UPDATE task_commands SET status='PROCESSING',worker_id=${workerId},fence_token=${fence},attempt=attempt+1,lease_until=now()+interval '30 seconds',updated_at=now() WHERE id=${row.id}`);
  return {...row,fence_token:fence};
 });
 if(!claim)return {processed:false};
 const b=claim.binding;
 const work:WorkRequest={version:'relay.owner-work.v1',requestId:claim.task_id,taskId:claim.task_id,accountId:b.account_id,ownerPrincipalId:b.owner_principal_id,agentId:b.agent_id,sourceIdentity:b.id,threadId:claim.thread_id,requestedAt:new Date(claim.created_at).toISOString(),expiresAt:new Date(claim.expires_at).toISOString(),message:decode<{text:string}>(claim.content.encrypted).text,ingress:'owner_telegram',budget:WORK_BUDGET};
 try{
  const snapshot=executionSnapshotSchema.parse(await transport.call({commandId:`${claim.id}:cancel`,operation:'cancel',work}));
  if(snapshot.requestId!==work.requestId||snapshot.ownerPrincipalId!==work.ownerPrincipalId||snapshot.agentId!==work.agentId||(claim.run_id&&snapshot.runId!==claim.run_id)||!['CANCELLED','COMPLETED','FAILED'].includes(snapshot.state))throw new Error('Cancellation unconfirmed.');
  await withTransaction(async tx=>{
   const owned=await rows(sql`UPDATE task_commands SET status='COMPLETED',lease_until=NULL,updated_at=now() WHERE id=${claim.id} AND status='PROCESSING' AND worker_id=${workerId} AND fence_token=${claim.fence_token} AND lease_until>now() RETURNING id`,tx);
   if(!owned.length)return;
   await tx.execute(sql`UPDATE channel_work_links SET run_id=${snapshot.runId},snapshot_encrypted=${encode(snapshot)},updated_at=now() WHERE task_id=${claim.task_id} AND account_id=${b.account_id}`);
   await channelAudit(tx,signer,b,'channel.cancellation_confirmed',snapshot.state,{taskId:claim.task_id,runId:snapshot.runId});
  });
  return {processed:true,state:'CONFIRMED'};
 }catch{
  await withTransaction(async tx=>{await tx.execute(sql`UPDATE task_commands SET status='PENDING',lease_until=NULL,run_after=now()+interval '10 seconds',updated_at=now() WHERE id=${claim.id} AND status='PROCESSING' AND worker_id=${workerId} AND fence_token=${claim.fence_token}`);});
  return {processed:true,state:'UNCONFIRMED'};
 }
}
