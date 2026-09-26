import { sql } from "drizzle-orm";
import { afterEach,describe,expect,it } from "vitest";
import { createLocalEd25519Signer } from "@/lib/v2/evidence/crypto";
import { activateV2Agent,createV2Agent,issueAgentPassport } from "@/lib/v2/passports";
import { channelConfiguration,type ChannelConfiguration } from "@/lib/v2/channels/config";
import { OWNER_EXECUTOR_QUALIFIED,type ExecutionCommand,type ExecutionSnapshot } from "@/lib/v2/channels/contracts";
import { HOSTED_RUNTIME_INDICATORS,LOCAL_QUALIFICATION_BOT_USERNAMES,LOCAL_QUALIFICATION_MAX_WINDOW_MS,localExecutorQualification } from "@/lib/v2/channels/local-qualification";
import { setupTelegramPairing,disconnectTelegram } from "@/lib/v2/channels/management";
import { telegramWebhook,telegramReadiness } from "@/lib/v2/channels/http";
import { runChannelExecutionCycle } from "@/lib/v2/channels/worker";
import { runChannelCancellationCycle } from "@/lib/v2/channels/cancellation";
import { rows,decode,type Reply } from "@/lib/v2/channels/store";
import { cleanupDatabase,freshDatabase } from "../helpers";

const NOW=1_800_000_000_000;
const BOT="qual_fixture_bot";
const base=():Record<string,string|undefined>=>({
  RELAY_LOCAL_QUALIFICATION:"telegram-owner-v1",RELAY_LOCAL_QUALIFICATION_UNTIL:String(NOW+30*60_000),
  NODE_ENV:"development",RELAY_CHANNEL_ENVIRONMENT:"development",RELAY_DEPLOYMENT_MODE:"local",
  RELAY_OWNER_EXECUTOR_URL:"https://127.0.0.1:3229/api/relay/owner-execution",RELAY_OWNER_EXECUTOR_AUDIENCE:"myeve-local-qualification",
  RELAY_DATABASE_URL:"postgresql://qualifier@127.0.0.1:55472/relay_telegram_qualification",
  RELAY_TELEGRAM_ACCOUNT_ID:"acct_qualificationrelay",RELAY_TELEGRAM_OWNER_PRINCIPAL_ID:"prn_qualificationowner",
  RELAY_TELEGRAM_AGENT_ID:"agt_qualificationsofie",RELAY_TELEGRAM_CONNECTION_ID:"qualification-telegram-connection",
  RELAY_TELEGRAM_BOT_USERNAME:BOT,
});
const decide=(changes:Record<string,string|undefined>,now=NOW,pins:readonly string[]=[BOT])=>localExecutorQualification({...base(),...changes},now,pins);

describe("local Relay qualification decision",()=>{
  it("activates only for the exact bounded profile and keeps the release constant false",()=>{
    expect(OWNER_EXECUTOR_QUALIFIED).toBe(false);
    expect(decide({})).toEqual({active:true,expiresAt:NOW+30*60_000});
    expect(decide({RELAY_TELEGRAM_BOT_USERNAME:"Qual_Fixture_Bot"}).active).toBe(true);
  });
  it("has no pinned bot until the owner's dedicated bot is reviewed into source",()=>{
    expect(LOCAL_QUALIFICATION_BOT_USERNAMES).toEqual([]);
    expect(localExecutorQualification(base(),NOW)).toEqual({active:false,reason:"BOT_NOT_PINNED"});
  });
  it.each(HOSTED_RUNTIME_INDICATORS.map(name=>[name]))("denies hosted/managed/CI indicator %s",name=>{
    expect(decide({[name]:"1"})).toEqual({active:false,reason:"HOSTED_RUNTIME"});
  });
  it.each([
    [{RELAY_LOCAL_QUALIFICATION:undefined},"NOT_REQUESTED"],[{RELAY_LOCAL_QUALIFICATION:"true"},"NOT_REQUESTED"],
    [{NODE_ENV:"production"},"NOT_DEVELOPMENT"],[{NODE_ENV:undefined},"NOT_DEVELOPMENT"],[{RELAY_CHANNEL_ENVIRONMENT:"preview"},"NOT_DEVELOPMENT"],
    [{RELAY_CHANNEL_ENVIRONMENT:"production"},"NOT_DEVELOPMENT"],[{RELAY_DEPLOYMENT_MODE:undefined},"NOT_DEVELOPMENT"],
    [{RELAY_DEPLOYMENT_MODE:"private-preview"},"NOT_DEVELOPMENT"],[{RELAY_DEPLOYMENT_MODE:"production"},"NOT_DEVELOPMENT"],
    [{RELAY_LOCAL_QUALIFICATION_UNTIL:undefined},"WINDOW_INVALID"],[{RELAY_LOCAL_QUALIFICATION_UNTIL:"soon"},"WINDOW_INVALID"],
    [{RELAY_LOCAL_QUALIFICATION_UNTIL:"1e13"},"WINDOW_INVALID"],[{RELAY_LOCAL_QUALIFICATION_UNTIL:String(NOW+LOCAL_QUALIFICATION_MAX_WINDOW_MS+1)},"WINDOW_INVALID"],
    [{RELAY_LOCAL_QUALIFICATION_UNTIL:String(NOW)},"EXPIRED"],[{RELAY_LOCAL_QUALIFICATION_UNTIL:String(NOW-1)},"EXPIRED"],
    [{RELAY_OWNER_EXECUTOR_URL:"http://127.0.0.1:3229/api/relay/owner-execution"},"EXECUTOR_NOT_LOOPBACK"],
    [{RELAY_OWNER_EXECUTOR_URL:"https://localhost:3229/api/relay/owner-execution"},"EXECUTOR_NOT_LOOPBACK"],
    [{RELAY_OWNER_EXECUTOR_URL:"https://127.0.0.2:3229/api/relay/owner-execution"},"EXECUTOR_NOT_LOOPBACK"],
    [{RELAY_OWNER_EXECUTOR_URL:"https://10.0.0.5:3229/api/relay/owner-execution"},"EXECUTOR_NOT_LOOPBACK"],
    [{RELAY_OWNER_EXECUTOR_URL:"https://example.ngrok.app/api/relay/owner-execution"},"EXECUTOR_NOT_LOOPBACK"],
    [{RELAY_OWNER_EXECUTOR_URL:"https://sofie-personal-agent.vercel.app/api/relay/owner-execution"},"EXECUTOR_NOT_LOOPBACK"],
    [{RELAY_OWNER_EXECUTOR_URL:"https://127.0.0.1/api/relay/owner-execution"},"EXECUTOR_NOT_LOOPBACK"],
    [{RELAY_OWNER_EXECUTOR_URL:"https://127.0.0.1:3229/other"},"EXECUTOR_NOT_LOOPBACK"],
    [{RELAY_OWNER_EXECUTOR_URL:"https://127.0.0.1:3229/api/relay/owner-execution?x=1"},"EXECUTOR_NOT_LOOPBACK"],
    [{RELAY_OWNER_EXECUTOR_URL:"https://user:pw@127.0.0.1:3229/api/relay/owner-execution"},"EXECUTOR_NOT_LOOPBACK"],
    [{RELAY_OWNER_EXECUTOR_AUDIENCE:"myeve-production"},"AUDIENCE_MISMATCH"],
    [{RELAY_DATABASE_URL:"postgresql://q@db.example.com:5432/relay_telegram_qualification"},"DATABASE_NOT_ISOLATED"],
    [{RELAY_DATABASE_URL:"postgresql://q@127.0.0.1:55585/relay"},"DATABASE_NOT_ISOLATED"],
    [{RELAY_DATABASE_URL:"postgresql://q@127.0.0.1:55447/relay_telegram_qualification"},"DATABASE_NOT_ISOLATED"],
    [{RELAY_DATABASE_URL:"postgresql://q@127.0.0.1/relay_telegram_qualification"},"DATABASE_NOT_ISOLATED"],
    [{RELAY_DATABASE_URL:"postgresql://q@127.0.0.1:55472/relay_telegram_qualification?host=/tmp"},"DATABASE_NOT_ISOLATED"],
    [{RELAY_DATABASE_URL:undefined,DATABASE_URL:undefined},"DATABASE_NOT_ISOLATED"],
    [{DATABASE_URL:"postgresql://q@ep-real.neon.tech/relay"},"DATABASE_NOT_ISOLATED"],
    [{RELAY_TELEGRAM_ACCOUNT_ID:"acct_real"},"IDENTITY_MISMATCH"],[{RELAY_TELEGRAM_OWNER_PRINCIPAL_ID:"prn_real"},"IDENTITY_MISMATCH"],
    [{RELAY_TELEGRAM_AGENT_ID:"agt_sofie"},"IDENTITY_MISMATCH"],[{RELAY_TELEGRAM_CONNECTION_ID:"personal-bot"},"IDENTITY_MISMATCH"],
    [{RELAY_TELEGRAM_BOT_USERNAME:"jays_personal_bot"},"BOT_NOT_PINNED"],[{RELAY_TELEGRAM_BOT_USERNAME:undefined},"BOT_NOT_PINNED"],
  ] as const)("denies %j with %s",(changes,reason)=>{
    expect(decide(changes as Record<string,string|undefined>)).toEqual({active:false,reason});
  });
  it("uses DATABASE_URL only when RELAY_DATABASE_URL is absent, and it must also be isolated",()=>{
    expect(decide({RELAY_DATABASE_URL:undefined,DATABASE_URL:"postgresql://q@127.0.0.1:55472/relay_telegram_qualification"}).active).toBe(true);
  });
});

describe("channel configuration keeps normal and hosted execution denied",()=>{
  it.each([
    ["unpinned bot",{}],["production node",{NODE_ENV:"production"}],["hosted Vercel",{VERCEL:"1",VERCEL_URL:"relay.vercel.app"}],
    ["private preview",{RELAY_DEPLOYMENT_MODE:"private-preview"}],["no qualification",{RELAY_LOCAL_QUALIFICATION:undefined}],
  ])("%s",(_name,changes)=>{
    const config=channelConfiguration({...base(),RELAY_LOCAL_QUALIFICATION_UNTIL:String(Date.now()+60_000),RELAY_TELEGRAM_ENABLED:"true",RELAY_TELEGRAM_EXECUTION_ENABLED:"true",...changes});
    expect(config.executionEnabled).toBe(false);
  });
  it("does not evaluate local qualification unless execution was explicitly requested",()=>{
    expect(channelConfiguration({...base(),RELAY_TELEGRAM_ENABLED:"true"}).localQualification).toBeNull();
  });
});

async function setup(localQualification:ChannelConfiguration["localQualification"]){
  const owner=await freshDatabase(),signer=createLocalEd25519Signer();
  const {agentId}=await createV2Agent({accountId:owner.accountId,ownerPrincipalId:owner.principalId,name:"Qualification Agent"},signer);
  await issueAgentPassport({accountId:owner.accountId,agentId,ownerPrincipalId:owner.principalId,policy:{trustTier:"REGISTERED",capabilityEligibility:[],policyReferences:[],budgetReferences:[],allowedEnvironments:{providerIds:["relay-managed"],minimumAssurance:"registered"},dataAccess:[],expiresAt:"2099-01-01T00:00:00.000Z"}},signer);
  await activateV2Agent({accountId:owner.accountId,agentId,actorPrincipalId:owner.principalId},signer);
  const config:ChannelConfiguration={enabled:true,executionEnabled:true,localQualification,environment:"development",accountId:owner.accountId,ownerPrincipalId:owner.principalId,agentId,connectionId:"qualification-telegram-connection",botUsername:BOT,botToken:"synthetic-no-network",webhookSecret:"fixture-webhook-secret-1234567890",endpoint:"https://127.0.0.1:3229/api/relay/owner-execution",audience:"myeve-local-qualification",signer,issues:[]};
  const challenge=await setupTelegramPairing(owner.accountId,owner.principalId,config);let sequence=10;
  const webhook=(body:unknown)=>telegramWebhook(new Request("https://relay.invalid/api/channels/telegram/webhook",{method:"POST",headers:{"content-type":"application/json","x-telegram-bot-api-secret-token":config.webhookSecret},body:JSON.stringify(body)}),config,async()=>true);
  const post=(text:string,updateId=sequence++)=>webhook({update_id:updateId,message:{message_id:updateId,date:Math.floor(Date.now()/1000),from:{id:123,is_bot:false},chat:{id:123,type:"private"},text}});
  expect((await post(`/start ${new URL(challenge.url).searchParams.get("start")}`)).status).toBe(200);
  const [binding]=await rows<{id:string}>(sql`SELECT id FROM telegram_bindings`);
  return {...owner,agentId,signer,config,post,webhook,bindingId:binding.id};
}
const open=()=>({active:true as const,expiresAt:Date.now()+60_000});
const expired={active:false as const,reason:"EXPIRED" as const};
const done=(c:ExecutionCommand,state:ExecutionSnapshot["state"]="COMPLETED"):ExecutionSnapshot=>({requestId:c.work.requestId,ownerPrincipalId:c.work.ownerPrincipalId,agentId:c.work.agentId,runId:`run_${c.work.requestId}`,state,resultId:`result_${c.work.requestId}`,text:"Synthetic qualification result."});
const waiting=(c:ExecutionCommand):ExecutionSnapshot=>({...done(c,"WAITING_APPROVAL"),resultId:undefined,pending:{kind:"approval",reference:"canonical-approval",bindingHash:"exact-hash",summary:"Synthetic action",target:"synthetic target",consequence:"Synthetic consequence",expiresAt:new Date(Date.now()+60_000).toISOString(),estimatedCost:null}});
const commandKinds=async()=>(await rows<{kind:string;status:string}>(sql`SELECT kind,status FROM task_commands ORDER BY created_at`));

describe("durable channel under a local qualification window",()=>{
  afterEach(cleanupDatabase);
  it("dispatches once in an open window and never re-executes a duplicate update",async()=>{
    const f=await setup(open());
    expect((await Promise.all([f.post("goals",900),f.post("goals",900)])).map(r=>r.status)).toEqual([200,200]);
    const operations:string[]=[];
    await runChannelExecutionCycle(f.config,{call:async c=>{operations.push(c.operation);return done(c);}},f.signer);
    expect(await runChannelExecutionCycle(f.config,{call:async()=>{throw new Error("must not execute");}},f.signer)).toEqual({processed:false});
    expect(operations).toEqual(["start"]);
  });
  it("fails closed when the window closes between claim and dispatch",async()=>{
    const f=await setup({active:true,expiresAt:Date.now()-1});await f.post("request");
    let calls=0;expect(await runChannelExecutionCycle(f.config,{call:async c=>{calls++;return done(c);}},f.signer)).toEqual({processed:true,state:"RECONCILE"});
    expect(calls).toBe(0);expect((await commandKinds())[0]).toEqual({kind:"CHANNEL_STATUS",status:"PENDING"});
  });
  it("after expiry denies execution and approval but still drains cancellation exactly once",async()=>{
    const f=await setup(open());await f.post("Send the synthetic update.");
    await runChannelExecutionCycle(f.config,{call:async c=>waiting(c)},f.signer);
    const [out]=await rows<{content:{encrypted:string}}>(sql`SELECT content FROM communication_messages WHERE direction='OUTBOUND' ORDER BY created_at DESC LIMIT 1`);
    const data=decode<Reply>(out.content.encrypted).buttons![0].data;
    Object.assign(f.config,{executionEnabled:false,localQualification:expired});
    expect(await runChannelExecutionCycle(f.config,{call:async()=>{throw new Error("must not execute");}},f.signer)).toEqual({processed:false});
    const callback=await f.webhook({update_id:777,callback_query:{id:"q",from:{id:123,is_bot:false},message:{message_id:5,chat:{id:123,type:"private"}},data}});
    expect(callback.status).toBe(503);
    expect((await commandKinds()).some(c=>c.kind==="CHANNEL_APPROVAL")).toBe(false);
    const cancels:string[]=[];
    await runChannelCancellationCycle(f.config,{call:async c=>{cancels.push(c.operation);return done(c,"CANCELLED");}},f.signer);
    expect(await runChannelCancellationCycle(f.config,{call:async()=>{throw new Error();}},f.signer)).toEqual({processed:false});
    expect(cancels).toEqual(["cancel"]);
    expect((await rows<{status:string}>(sql`SELECT status FROM v2_tasks`))[0].status).toBe("CANCELLED");
  });
  it("revocation inside an open window cancels instead of dispatching",async()=>{
    const f=await setup(open());await f.post("request");await disconnectTelegram(f.accountId,f.principalId,f.bindingId,f.config);
    expect(await runChannelExecutionCycle(f.config,{call:async()=>{throw new Error("must not execute");}},f.signer)).toEqual({processed:false});
    const cancels:string[]=[];await runChannelCancellationCycle(f.config,{call:async c=>{cancels.push(c.operation);return done(c,"CANCELLED");}},f.signer);
    expect(cancels).toEqual(["cancel"]);
  });
  it("readiness reports the immutable constant separately from the local window",async()=>{
    const f=await setup(open());const ready=await telegramReadiness(f.config);
    expect(ready.executorQualified).toBe(false);expect(ready.localQualification).toMatchObject({active:true});expect(ready.executionReady).toBe(true);
    Object.assign(f.config,{executionEnabled:false,localQualification:expired});
    const closed=await telegramReadiness(f.config);expect(closed.executionReady).toBe(false);expect(closed.localQualification).toEqual({active:false,reason:"EXPIRED"});
  });
});
