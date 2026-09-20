import { sql } from "drizzle-orm";
import { withTransaction } from "@/lib/db";
import { id } from "@/lib/ids";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { WORK_BUDGET,executionSnapshotSchema,type ExecutionCommand,type ExecutionSnapshot,type ExecutionTransport,type WorkRequest } from "./contracts";
import type { ChannelConfiguration } from "./config";
import { channelAudit,channelGranted,currentBinding,decode,encode,enqueueReply,lockBinding,rows,snapshotReply } from "./store";

type Claim={id:string;task_id:string;account_id:string;kind:string;attempt:number;fence_token:number;payload:{controlId?:string};binding_id:string;message_id:string;run_id:string|null;snapshot_encrypted:string|null;expires_at:Date;created_at:Date;thread_id:string;content:{encrypted:string};agent_id:string};
export async function runChannelExecutionCycle(config:ChannelConfiguration,transport:ExecutionTransport,signer:AuditSigner,workerId=id("worker")) {
  if(!config.enabled || !config.executionEnabled || config.issues.length) return {processed:false};
  const claim=await withTransaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('relay:channel-command-claim',0))`);
    // A crashed command is reconciled, never blindly re-executed. The executor's
    // canonical Run and effect receipts decide whether continuation is possible.
    await tx.execute(sql`UPDATE task_commands SET status='PENDING',kind='CHANNEL_STATUS',lease_until=NULL,run_after=now(),updated_at=now() WHERE account_id=${config.accountId} AND kind LIKE 'CHANNEL_%' AND status='PROCESSING' AND lease_until<now()`);
    const [candidate]=await rows<Claim>(sql`SELECT c.*,w.binding_id,w.message_id,w.run_id,w.snapshot_encrypted,w.expires_at,w.created_at AS created_at,m.thread_id,m.content,t.agent_id
      FROM task_commands c JOIN channel_work_links w ON w.task_id=c.task_id AND w.account_id=c.account_id
      JOIN communication_messages m ON m.id=w.message_id JOIN v2_tasks t ON t.id=c.task_id
      WHERE c.account_id=${config.accountId} AND c.kind LIKE 'CHANNEL_%' AND c.status='PENDING' AND c.run_after<=now()
      AND t.status NOT IN ('SUCCEEDED','FAILED','CANCELLED','DEAD_LETTERED')
      AND NOT EXISTS(SELECT 1 FROM task_commands busy JOIN channel_work_links bw ON bw.task_id=busy.task_id WHERE bw.binding_id=w.binding_id AND busy.status='PROCESSING' AND busy.lease_until>now())
      AND (c.kind<>'CHANNEL_START' OR NOT EXISTS(SELECT 1 FROM channel_work_links earlier JOIN v2_tasks et ON et.id=earlier.task_id WHERE earlier.binding_id=w.binding_id AND earlier.created_at<w.created_at AND et.status NOT IN ('SUCCEEDED','FAILED','CANCELLED','DEAD_LETTERED')))
      ORDER BY CASE WHEN c.kind IN ('CHANNEL_APPROVAL','CHANNEL_RECOVERY') THEN 0 ELSE 1 END,c.created_at LIMIT 1 FOR UPDATE OF c SKIP LOCKED`,tx);
    if(!candidate)return;
    await lockBinding(config.connectionId,tx);
    const binding=await currentBinding(candidate.binding_id,tx);
    if(!binding || binding.connection_id!==config.connectionId || binding.owner_principal_id!==config.ownerPrincipalId || binding.agent_id!==config.agentId || binding.agent_status!=="ACTIVE" || !await channelGranted(binding,"channel.owner.receive",tx) || new Date(candidate.expires_at).getTime()<=Date.now()) {
      await tx.execute(sql`UPDATE task_commands SET status='CANCELLED' WHERE id=${candidate.id}`);
      await tx.execute(sql`UPDATE v2_tasks SET status='CANCELLED',completed_at=now(),updated_at=now() WHERE id=${candidate.task_id}`);
      if(binding)await enqueueReply(tx,{binding,threadId:candidate.thread_id,taskId:candidate.task_id,key:`channel-unavailable:${candidate.task_id}`,reply:{text:"Your request cannot run because its identity, Agent, permission, or lifetime is no longer valid."},system:true});
      return;
    }
    if(candidate.attempt>=12) {
      await tx.execute(sql`UPDATE task_commands SET status='DEAD_LETTERED' WHERE id=${candidate.id}`);
      await tx.execute(sql`UPDATE v2_tasks SET status='DEAD_LETTERED',completed_at=now(),updated_at=now() WHERE id=${candidate.task_id}`);
      await enqueueReply(tx,{binding,threadId:candidate.thread_id,taskId:candidate.task_id,key:`channel-unconfirmed:${candidate.task_id}`,reply:{text:"The executor outcome could not be confirmed. Review the canonical Run before taking further action. Nothing will be retried automatically."},system:true});
      return;
    }
    const fence=candidate.fence_token+1;
    await tx.execute(sql`UPDATE task_commands SET status='PROCESSING',worker_id=${workerId},fence_token=${fence},attempt=attempt+1,lease_until=now()+interval '30 seconds',effect_state='POSSIBLY_COMMITTED',updated_at=now() WHERE id=${candidate.id}`);
    await tx.execute(sql`UPDATE v2_tasks SET status=CASE WHEN status='QUEUED' THEN 'RUNNING'::v2_task_state ELSE status END,coordinator_id=${workerId},coordinator_lease_until=now()+interval '30 seconds',fence_token=fence_token+1,updated_at=now() WHERE id=${candidate.task_id}`);
    return {...candidate,fence_token:fence,attempt:candidate.attempt+1,binding};
  });
  if(!claim)return {processed:false};
  const work:WorkRequest={version:"relay.owner-work.v1",requestId:claim.task_id,accountId:claim.account_id,ownerPrincipalId:claim.binding.owner_principal_id,agentId:claim.agent_id,threadId:claim.thread_id,taskId:claim.task_id,sourceIdentity:claim.binding_id,ingress:"owner_telegram",requestedAt:new Date(claim.created_at).toISOString(),expiresAt:new Date(claim.expires_at).toISOString(),message:decode<{text:string}>(claim.content.encrypted).text,budget:WORK_BUDGET};
  const operation=claim.kind==="CHANNEL_START"?"start":claim.kind==="CHANNEL_APPROVAL"?"approval":claim.kind==="CHANNEL_RECOVERY"?"recovery":"status";
  const command:ExecutionCommand={commandId:`${claim.id}:${operation}`,work,operation};
  if(operation==="approval"||operation==="recovery") {
    const [control]=await rows<{reference:string;binding_hash:string;choice:NonNullable<ExecutionCommand["decision"]>["choice"]}>(sql`SELECT reference,binding_hash,choice FROM channel_controls WHERE id=${claim.payload.controlId!} AND account_id=${claim.account_id} AND task_id=${claim.task_id} AND binding_id=${claim.binding_id} AND consumed_at IS NOT NULL`);
    if(!control)throw new Error("Pending control missing.");
    command.decision={reference:control.reference,bindingHash:control.binding_hash,choice:control.choice};
  }
  let snapshot:ExecutionSnapshot;
  try { snapshot=executionSnapshotSchema.parse(await withTransaction(async tx=>{
    await lockBinding(config.connectionId,tx);
    const current=await currentBinding(claim.binding_id,tx);
    if(!current || current.agent_status!=="ACTIVE" || !await channelGranted(current,"channel.owner.receive",tx))throw new Error("Channel authority changed.");
    return transport.call(command);
  })); if(snapshot.requestId!==work.requestId||snapshot.ownerPrincipalId!==work.ownerPrincipalId||snapshot.agentId!==work.agentId||claim.run_id&&snapshot.runId!==claim.run_id)throw new Error("Run identity changed."); }
  catch {
    await withTransaction(async tx=>{
      await tx.execute(sql`UPDATE task_commands SET status='PENDING',kind='CHANNEL_STATUS',lease_until=NULL,run_after=now()+interval '10 seconds',updated_at=now() WHERE id=${claim.id} AND worker_id=${workerId} AND fence_token=${claim.fence_token} AND status='PROCESSING'`);
      await channelAudit(tx,signer,claim.binding,"channel.executor_unconfirmed","RECONCILE",{taskId:claim.task_id,attempt:claim.attempt});
    });
    return {processed:true,state:"RECONCILE"};
  }
  await withTransaction(async tx=>{
    const owned=await rows<{id:string}>(sql`UPDATE task_commands SET status='COMPLETED',lease_until=NULL,updated_at=now() WHERE id=${claim.id} AND worker_id=${workerId} AND fence_token=${claim.fence_token} AND status='PROCESSING' AND lease_until>now() RETURNING id`,tx);
    if(!owned.length)return;
    await lockBinding(config.connectionId,tx);
    const binding=await currentBinding(claim.binding_id,tx);
    const terminal=["COMPLETED","FAILED","CANCELLED"].includes(snapshot.state);
    const taskState=snapshot.state==="COMPLETED"?"SUCCEEDED":snapshot.state==="WAITING_APPROVAL"?"WAITING_APPROVAL":snapshot.state==="RECOVERY_REQUIRED"?"PAUSED":snapshot.state;
    await tx.execute(sql`UPDATE channel_work_links SET run_id=${snapshot.runId},result_id=${snapshot.resultId??null},snapshot_encrypted=${encode(snapshot)},updated_at=now() WHERE task_id=${claim.task_id}`);
    await tx.execute(sql`UPDATE v2_tasks SET status=${taskState}::v2_task_state,updated_at=now(),completed_at=${terminal?new Date().toISOString():null} WHERE id=${claim.task_id} AND status NOT IN ('CANCELLED','FAILED','SUCCEEDED')`);
    if(binding && terminal)await enqueueReply(tx,{binding,threadId:claim.thread_id,taskId:claim.task_id,key:`channel-result:${claim.task_id}`,reply:snapshotReply(snapshot)});
    if(binding && snapshot.pending) {
      const pending=snapshot.pending, controlId=id("ctl");
      const controls=await rows<{id:string}>(sql`INSERT INTO channel_controls(id,account_id,task_id,binding_id,reference,binding_hash,kind,expires_at) VALUES(${controlId},${claim.account_id},${claim.task_id},${claim.binding_id},${pending.reference},${pending.bindingHash},${pending.kind},${pending.expiresAt}) ON CONFLICT(task_id,reference,binding_hash) DO UPDATE SET updated_at=channel_controls.updated_at RETURNING id`,tx);
      const control=controls[0].id;
      const choices=pending.kind==="approval"?[{text:"Approve",choice:"approve"},{text:"Reject",choice:"reject"}]:[{text:"It occurred",choice:"occurred"},{text:"It did not occur",choice:"not_occurred"},{text:"Leave unresolved",choice:"unresolved"}];
      await enqueueReply(tx,{binding,threadId:claim.thread_id,taskId:claim.task_id,key:`channel-pending:${control}`,reply:{text:`${binding.agent_name}: ${pending.summary}\nTarget: ${pending.target}\n${pending.consequence}\nCost: ${pending.estimatedCost??"unavailable"}\nExpires: ${pending.expiresAt}\n${pending.kind==="approval"?"No action has occurred. Rejecting will not execute it.":"The outcome is unknown. A recovery decision will not resend it."}`,buttons:choices.map(x=>({text:x.text,data:`${control}:${x.choice}`}))}});
    }
    if(snapshot.state==="RUNNING"||snapshot.pending)await tx.execute(sql`INSERT INTO task_commands(id,account_id,task_id,kind,idempotency_key,run_after) VALUES(${id("cmd")},${claim.account_id},${claim.task_id},'CHANNEL_STATUS',${`channel-poll:${claim.id}`},now()+interval '60 seconds') ON CONFLICT(account_id,idempotency_key) DO NOTHING`);
    await channelAudit(tx,signer,claim.binding,"channel.execution_observed",snapshot.state,{taskId:claim.task_id,runId:snapshot.runId});
  });
  return {processed:true,state:snapshot.state};
}
