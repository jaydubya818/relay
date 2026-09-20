import { claimTaskCommand } from "@/lib/v2/orchestration";
import { sql } from "drizzle-orm";
import { afterEach,describe,expect,it } from "vitest";
import { db } from "@/lib/db";
import { createLocalEd25519Signer } from "@/lib/v2/evidence/crypto";
import { activateV2Agent,createV2Agent,issueAgentPassport } from "@/lib/v2/passports";
import { channelConfiguration,type ChannelConfiguration } from "@/lib/v2/channels/config";
import { setupTelegramPairing,disconnectTelegram,telegramManagement } from "@/lib/v2/channels/management";
import { telegramWebhook,telegramReadiness } from "@/lib/v2/channels/http";
import { runChannelExecutionCycle } from "@/lib/v2/channels/worker";
import { runChannelDeliveryCycle,TelegramOwnerSender } from "@/lib/v2/channels/delivery";
import { rows,decode,type Reply } from "@/lib/v2/channels/store";
import { signExecution,verifyExecution } from "@/lib/v2/channels/signing";
import { receiveOwnerExecution } from "@/lib/v2/channels/executor";
import { WORK_BUDGET,type ExecutionCommand,type ExecutionSnapshot } from "@/lib/v2/channels/contracts";
import { cleanupDatabase,freshDatabase } from "../helpers";
async function setup(){
 const owner=await freshDatabase(),signer=createLocalEd25519Signer();
 const {agentId}=await createV2Agent({accountId:owner.accountId,ownerPrincipalId:owner.principalId,name:"Channel Agent"},signer);
 await issueAgentPassport({accountId:owner.accountId,agentId,ownerPrincipalId:owner.principalId,policy:{trustTier:"REGISTERED",capabilityEligibility:[],policyReferences:[],budgetReferences:[],allowedEnvironments:{providerIds:["relay-managed"],minimumAssurance:"registered"},dataAccess:[],expiresAt:"2099-01-01T00:00:00.000Z"}},signer);
 await activateV2Agent({accountId:owner.accountId,agentId,actorPrincipalId:owner.principalId},signer);
 const config:ChannelConfiguration={enabled:true,executionEnabled:true,environment:"preview",accountId:owner.accountId,ownerPrincipalId:owner.principalId,agentId,connectionId:"test-channel",botUsername:"fixture_bot",botToken:"synthetic-no-network",webhookSecret:"fixture-webhook-secret-1234567890",endpoint:"https://executor.invalid/owner",audience:"fixture",signer,issues:[]};
 const challenge=await setupTelegramPairing(owner.accountId,owner.principalId,config);let sequence=10;
 const webhook=(body:unknown,secret=config.webhookSecret)=>telegramWebhook(new Request("https://relay.invalid/api/channels/telegram/webhook",{method:"POST",headers:{"content-type":"application/json","x-telegram-bot-api-secret-token":secret},body:JSON.stringify(body)}),config);
 const post=(text:string,user=123,updateId=sequence++)=>webhook({update_id:updateId,message:{message_id:updateId,date:Math.floor(Date.now()/1000),from:{id:user,is_bot:false},chat:{id:user,type:"private"},text}});
 expect((await post(`/start ${new URL(challenge.url).searchParams.get("start")}`)).status).toBe(200);
 const [binding]=await rows<{id:string}>(sql`SELECT id FROM telegram_bindings`);
 return {...owner,agentId,signer,config,post,webhook,bindingId:binding.id};
}
const count=async(table:string)=>(await rows<{count:number}>(sql.raw(`SELECT count(*)::int AS count FROM ${table}`)))[0].count;
function completed(c:ExecutionCommand):ExecutionSnapshot{return {requestId:c.work.requestId,ownerPrincipalId:c.work.ownerPrincipalId,agentId:c.work.agentId,runId:`run_${c.work.requestId}`,state:"COMPLETED",resultId:`result_${c.work.requestId}`,text:"Your active goal is isolated qualification."};}
describe("durable owner channel",()=>{
 afterEach(cleanupDatabase);
 it("deduplicates ingress and resumes delivery without executing work again",async()=>{
  const f=await setup();expect((await Promise.all([f.post("goals",123,999),f.post("goals",123,999)])).map(x=>x.status)).toEqual([200,200]);expect(await count("channel_work_links")).toBe(1);expect(await claimTaskCommand("temporal-worker")).toBeUndefined();
  let executions=0;await runChannelExecutionCycle(f.config,{call:async c=>{executions++;return completed(c);}},f.signer);
  expect(await runChannelExecutionCycle(f.config,{call:async()=>{throw new Error();}},f.signer)).toEqual({processed:false});
  const sent:Reply[]=[];await runChannelDeliveryCycle(f.config,{send:async x=>{expect(x.chatId).toBe("123");sent.push(x.reply);return {kind:"sent",messageId:"900"};}},f.signer);
  expect(await runChannelDeliveryCycle(f.config,{send:async()=>{throw new Error();}},f.signer)).toEqual({processed:false});
  expect(executions).toBe(1);expect(sent).toHaveLength(1);expect((await rows<{status:string}>(sql`SELECT status FROM v2_tasks`))[0].status).toBe("SUCCEEDED");expect(await count("channel_delivery_attempts")).toBe(1);
 });
 it("does not start work for disabled execution, Agent or grants",async()=>{
  const f=await setup();f.config.executionEnabled=false;expect((await f.post("request")).status).toBe(200);f.config.executionEnabled=true;
  await db().execute(sql`UPDATE agents SET status='DISABLED' WHERE id=${f.agentId}`);expect((await f.post("request")).status).toBe(200);
  await db().execute(sql`UPDATE agents SET status='ACTIVE' WHERE id=${f.agentId}`);await db().execute(sql`UPDATE capability_grants SET effect='DENY' WHERE agent_id=${f.agentId}`);expect((await f.post("request")).status).toBe(200);expect(await count("channel_work_links")).toBe(0);
 });
 it("denies forged, unpaired and revoked ingress",async()=>{
  const f=await setup();expect((await f.webhook({},"bad")).status).toBe(401);expect((await f.post("request",456)).status).toBe(403);
  await disconnectTelegram(f.accountId,f.principalId,f.bindingId,f.config);expect((await f.post("request")).status).toBe(403);expect(await count("channel_work_links")).toBe(0);expect((await telegramManagement(f.accountId,f.principalId,f.config)).state).toBe("REVOKED");
 });
 it("reconciles a crashed start instead of repeating it",async()=>{
  const f=await setup();await f.post("request");await db().execute(sql`UPDATE task_commands SET status='PROCESSING',lease_until=now()-interval '1 second' WHERE kind='CHANNEL_START'`);
  const operations:string[]=[];await runChannelExecutionCycle(f.config,{call:async c=>{operations.push(c.operation);return completed(c);}},f.signer);expect(operations).toEqual(["status"]);
 });
 it("retries delivery alone after a known pre-effect rate limit",async()=>{
  const f=await setup();await f.post("request");await runChannelExecutionCycle(f.config,{call:async c=>completed(c)},f.signer);
  await runChannelDeliveryCycle(f.config,{send:async()=>({kind:"retry",retryAfterSeconds:2})},f.signer);expect((await rows<{status:string}>(sql`SELECT status FROM v2_tasks`))[0].status).toBe("SUCCEEDED");
  await db().execute(sql`UPDATE communication_messages SET retry_after=now()-interval '1 second' WHERE direction='OUTBOUND'`);await runChannelDeliveryCycle(f.config,{send:async()=>({kind:"sent",messageId:"901"})},f.signer);expect(await count("channel_delivery_attempts")).toBe(2);
 });
 it.each(["unknown","permanent","authentication"] as const)("never automatically retries %s delivery",async kind=>{
  const f=await setup();await f.post("request");await runChannelExecutionCycle(f.config,{call:async c=>completed(c)},f.signer);await runChannelDeliveryCycle(f.config,{send:async()=>({kind})},f.signer);
  expect(await runChannelDeliveryCycle(f.config,{send:async()=>{throw new Error();}},f.signer)).toEqual({processed:false});expect(await count("channel_delivery_attempts")).toBe(1);
 });
 it("retains opaque approval controls and consumes one owner decision",async()=>{
  const f=await setup();await f.post("Send project update.");const commands:ExecutionCommand[]=[];
  await runChannelExecutionCycle(f.config,{call:async c=>{commands.push(c);return {...completed(c),state:"WAITING_APPROVAL",pending:{kind:"approval",reference:"canonical-approval",bindingHash:"exact-hash",summary:"Write isolated artifact",target:"test workspace",consequence:"Creates one test artifact",expiresAt:new Date(Date.now()+60000).toISOString(),estimatedCost:null}};}},f.signer);
  const [out]=await rows<{content:{encrypted:string}}>(sql`SELECT content FROM communication_messages WHERE direction='OUTBOUND'`);const data=decode<Reply>(out.content.encrypted).buttons![0].data;expect(data).not.toContain("canonical-approval");expect(data.length).toBeLessThanOrEqual(64);
  const callback=(user:number)=>f.webhook({update_id:555,callback_query:{id:"query",from:{id:user,is_bot:false},message:{message_id:999,chat:{id:user,type:"private"}},data}});
  expect((await callback(456)).status).toBe(403);expect((await callback(123)).status).toBe(200);expect((await callback(123)).status).toBe(200);
  await runChannelExecutionCycle(f.config,{call:async c=>{commands.push(c);return completed(c);}},f.signer);expect(commands.map(c=>c.operation)).toEqual(["start","approval"]);expect(commands[1].decision).toEqual({reference:"canonical-approval",bindingHash:"exact-hash",choice:"approve"});expect(commands[1].work).toEqual(commands[0].work);
 });
 it("suppresses queued delivery after revocation",async()=>{
  const f=await setup();await f.post("request");await runChannelExecutionCycle(f.config,{call:async c=>completed(c)},f.signer);await disconnectTelegram(f.accountId,f.principalId,f.bindingId,f.config);
  let calls=0;await runChannelDeliveryCycle(f.config,{send:async()=>{calls++;return {kind:"sent",messageId:"never"};}},f.signer);expect(calls).toBe(0);
 });
 it("bounds work and keeps private text out of audit and receipts",async()=>{
  const f=await setup();for(let i=0;i<4;i++)expect((await f.post(`synthetic-private-marker ${i}`)).status).toBe(200);expect((await f.post("fifth")).status).toBe(429);
  expect(JSON.stringify([await rows(sql`SELECT * FROM audit_records`),await rows(sql`SELECT * FROM communication_messages`)])).not.toContain("synthetic-private-marker");
 });
 it("denies signature replay and authority mutations",async()=>{
  const f=await setup();const command:ExecutionCommand={commandId:"cmd1",operation:"start",work:{version:"relay.owner-work.v1",requestId:"request",taskId:"request",accountId:f.accountId,ownerPrincipalId:f.principalId,agentId:f.agentId,threadId:"thread",sourceIdentity:f.bindingId,ingress:"owner_telegram",requestedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),message:"fixture",budget:WORK_BUDGET}};
  let calls=0;const options={environment:"preview" as const,audience:"fixture",keys:{[f.signer.keyId]:await f.signer.publicKeyPem!()},executor:{authorize:async()=>{},handle:async(c:ExecutionCommand)=>{calls++;return completed(c);}}};
  const signed=await signExecution(command,f.signer,"preview","fixture");await receiveOwnerExecution(signed,options);await expect(receiveOwnerExecution(signed,options)).rejects.toThrow("replay");expect(calls).toBe(1);
  for(const field of ["ownerPrincipalId","agentId","message"] as const){const changed=structuredClone(signed);changed.payload.command.work[field]="changed";expect(()=>verifyExecution(changed,options)).toThrow();}
  const scope=structuredClone(signed);Object.assign(scope.payload,{scope:"external.agent"});expect(()=>verifyExecution(scope,options)).toThrow();
  expect(()=>verifyExecution(signed,{...options,environment:"production"})).toThrow();expect(()=>verifyExecution(signed,{...options,now:Date.now()+61000})).toThrow();
 });
 it("fails readiness without configuration and preserves private-preview denial",async()=>{
  const config=channelConfiguration({RELAY_TELEGRAM_ENABLED:"true",RELAY_TELEGRAM_EXECUTION_ENABLED:"true",RELAY_DEPLOYMENT_MODE:"private-preview"});expect(config.executionEnabled).toBe(false);expect((await telegramReadiness(config)).executionReady).toBe(false);
 });
 it.each([[429,{ok:false,parameters:{retry_after:5}},"retry"],[403,{},"permanent"],[401,{},"authentication"],[500,{},"unknown"],[200,{ok:true,result:{message_id:123}},"sent"]] as const)("classifies HTTP %s safely",async(status,body,kind)=>{
  const sender=new TelegramOwnerSender("synthetic-token",async()=>new Response(JSON.stringify(body),{status}));expect((await sender.send({chatId:"123",reply:{text:"fixture"}})).kind).toBe(kind);
 });
});
