import { runChannelCancellationCycle } from '@/lib/v2/channels/cancellation';
import { readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { db } from '@/lib/db';
import { createLocalEd25519Signer } from '@/lib/v2/evidence/crypto';
import { activateV2Agent,createV2Agent,issueAgentPassport } from '@/lib/v2/passports';
import { setupTelegramPairing,disconnectTelegram,telegramManagement } from '@/lib/v2/channels/management';
import { telegramWebhook } from '@/lib/v2/channels/http';
import { runChannelExecutionCycle } from '@/lib/v2/channels/worker';
import { runChannelDeliveryCycle } from '@/lib/v2/channels/delivery';
import { HttpOwnerExecutor } from '@/lib/v2/channels/executor';
import { rows } from '@/lib/v2/channels/store';
import { cleanupDatabase,freshDatabase } from '../helpers';

const myeve=process.env.RELAY_MYEVE_SOURCE;
const suite=process.env.RELAY_MYEVE_TESTS==='1'&&myeve&&process.env.RELAY_TEST_DATABASE_URL?describe:describe.skip;
suite('Relay to canonical MyEve component golden path',()=>{
 let pool,fixture,handoff,controller,Gateway,consumeAction,consumeProvider,snapshot,transition,research=0,draft=0,effects=0,lostApprovalResponse=false;
 const query=async(text,params=[])=>(await pool.query(text,params)).rows;
 const database={query,transaction:async(build)=>{const client=await pool.connect();try{await client.query('BEGIN');const statements=build((strings,...params)=>({text:strings.reduce((s,part,i)=>s+(i?`$${i}`:'')+part,''),params}));for(const statement of statements)await client.query(statement.text,statement.params);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}};
 beforeAll(async()=>{
  const owner=await freshDatabase(),signer=createLocalEd25519Signer();
  const {agentId}=await createV2Agent({accountId:owner.accountId,ownerPrincipalId:owner.principalId,name:'Cross-runtime fixture'},signer);
  await issueAgentPassport({accountId:owner.accountId,agentId,ownerPrincipalId:owner.principalId,policy:{trustTier:'REGISTERED',capabilityEligibility:[],policyReferences:[],budgetReferences:[],allowedEnvironments:{providerIds:['relay-managed'],minimumAssurance:'registered'},dataAccess:[],expiresAt:'2099-01-01T00:00:00.000Z'}},signer);
  await activateV2Agent({accountId:owner.accountId,agentId,actorPrincipalId:owner.principalId},signer);
  const config={enabled:true,executionEnabled:true,environment:'preview',accountId:owner.accountId,ownerPrincipalId:owner.principalId,agentId,connectionId:'cross-runtime-fixture',botUsername:'fixture_bot',botToken:'synthetic-no-network',webhookSecret:'fixture-webhook-secret-1234567890',endpoint:'https://executor.invalid/owner',audience:'cross-runtime-fixture',signer,issues:[]};
  const webhook=value=>telegramWebhook(new Request('https://relay.invalid/api/channels/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':config.webhookSecret},body:JSON.stringify(value)}),config,async()=>true);
  const post=(text,updateId)=>webhook({update_id:updateId,message:{message_id:updateId,date:Math.floor(Date.now()/1000),from:{id:123,is_bot:false},chat:{id:123,type:'private'},text}});
  const challenge=await setupTelegramPairing(owner.accountId,owner.principalId,config);expect((await post(`/start ${new URL(challenge.url).searchParams.get('start')}`,1)).status).toBe(200);
  const [binding]=await rows(sql`SELECT id FROM telegram_bindings`);
  const url=new URL(process.env.RELAY_DATABASE_URL);if(!/^relay_test_/.test(url.pathname.slice(1)))throw new Error('Isolated test database required.');
  const admin=new Pool({connectionString:url.toString()});try{await admin.query('CREATE SCHEMA myeve_qualification');}finally{await admin.end();}
  pool=new Pool({connectionString:url.toString(),options:'-c search_path=myeve_qualification'});
  const migrations=path.join(myeve,'apps/eve/migrations');for(const file of (await readdir(migrations)).filter(name=>name.endsWith('.sql')).sort())await query(await readFile(path.join(migrations,file),'utf8'));
  await query("INSERT INTO agents(id,owner_id,slug,name,role,instructions,is_primary,status,max_steps,max_runtime_seconds,max_estimated_cost_usd) VALUES('myeve-agent','myeve-owner','fixture','Fixture','Qualification','Synthetic qualification only',true,'active',8,60,0.1)");
  const trust={environment:'preview',audience:config.audience,keys:{[signer.keyId]:await signer.publicKeyPem()},mappings:[{relayAccountId:owner.accountId,relayOwnerPrincipalId:owner.principalId,relayAgentId:agentId,sourceIdentity:binding.id,ownerId:'myeve-owner',agentId:'myeve-agent',enabled:true}]};
  vi.doMock(path.join(myeve,'apps/eve/agent/lib/receipts-db.ts'),()=>({db:()=>database}));
  vi.doMock(path.join(myeve,'apps/eve/lib/relay/owner/config.ts'),()=>({OWNER_CHANNEL_RELEASE_QUALIFIED:false,ownerChannelConfiguration:()=>({enabled:true,trust,issues:[]})}));
  const gateway=await import(path.join(myeve,'apps/eve/lib/action-gateway.ts'));Gateway=gateway.ActionGateway;consumeAction=gateway.consumeActionAuthority;consumeProvider=gateway.consumeProviderAuthority;
  handoff=new (await import(path.join(myeve,'apps/eve/lib/relay/owner/handoff.ts'))).OwnerChannelHandoff(trust,database);
  controller=new (await import(path.join(myeve,'apps/eve/lib/relay/owner/control.ts'))).OwnerRunControl(database);
  snapshot=(await import(path.join(myeve,'apps/eve/lib/relay/owner/snapshot.ts'))).ownerRunSnapshot;
  transition=(await import(path.join(myeve,'apps/eve/lib/task-runs.ts'))).transitionTask;
  fixture={...owner,agentId,signer,config,webhook,post,bindingId:binding.id};
 });
 afterAll(async()=>{await pool?.end();await cleanupDatabase();vi.restoreAllMocks();});
 const adapter={resolveTarget:async()=>({provider:'synthetic',account:'myeve-owner',resource:'/workspace/qualification.txt'}),execute:async(parameters,context)=>{await consumeAction(context,parameters,'files.write');await consumeProvider(context,parameters,'files.write');effects++;return {};},verify:async()=>({verified:true,receipt:{id:'synthetic-artifact'}})};
 it('resumes once across a lost response and propagates subsequent revocation',async()=>{
  const transport=new HttpOwnerExecutor({endpoint:fixture.config.endpoint,audience:fixture.config.audience,environment:'preview',signer:fixture.signer},async(_url,init)=>{
   const accepted=await handoff.accept(JSON.parse(init.body));
   if(accepted.command.operation==='start'){
    const [run]=await query('SELECT status FROM task_runs WHERE id=$1',[accepted.runId]);
    if(run.status==='queued'){
     await transition('myeve-owner',accepted.runId,'running','agent','Synthetic model fixture');
     await query("INSERT INTO task_run_sessions(task_id,session_id,role) VALUES($1,$1,'orchestrator')",[accepted.runId]);research++;draft++;
     await expect(new Gateway(database).execute({ownerId:'myeve-owner',runId:accepted.runId,actionKey:'synthetic-draft',capabilityId:'files.write',actionClass:'write',executor:{kind:'primary-agent',agentId:'myeve-agent'},trigger:{kind:'owner_chat',id:accepted.runId},parameters:{path:'/workspace/qualification.txt',content:'Synthetic private draft'}},adapter)).rejects.toMatchObject({status:'awaiting_approval'});
    }
   }
   if(accepted.command.operation==='cancel')await controller.cancel(accepted);
   if(accepted.command.operation==='approval'){
    await controller.apply(accepted,()=>adapter);
    if(!lostApprovalResponse){lostApprovalResponse=true;throw new Error('Synthetic lost response after canonical completion.');}
   }
   return Response.json(await snapshot(accepted,database));
  });
  expect((await fixture.post('Create the synthetic qualification artifact.',2)).status).toBe(200);
  expect((await fixture.post('Create the synthetic qualification artifact.',2)).status).toBe(200);
  await runChannelExecutionCycle(fixture.config,transport,fixture.signer);
  expect([research,draft,effects]).toEqual([1,1,0]);
  const delivered=[];const sender={send:async input=>{delivered.push(input.reply);return {kind:'sent',messageId:String(900+delivered.length)};}};
  await runChannelDeliveryCycle(fixture.config,sender,fixture.signer);
  const data=delivered[0].buttons.find(button=>button.text==='Approve').data;
  const callback={update_id:3,callback_query:{id:'synthetic-callback',from:{id:123,is_bot:false},message:{message_id:901,chat:{id:123,type:'private'}},data}};
  expect((await fixture.webhook(callback)).status).toBe(200);expect((await fixture.webhook(callback)).status).toBe(200);
  expect(await runChannelExecutionCycle(fixture.config,transport,fixture.signer)).toMatchObject({state:'RECONCILE'});
  await db().execute(sql`UPDATE task_commands SET run_after=now()-interval '1 second' WHERE status='PENDING'`);
  await runChannelExecutionCycle(fixture.config,transport,fixture.signer);
  await runChannelDeliveryCycle(fixture.config,sender,fixture.signer);
  expect([research,draft,effects]).toEqual([1,1,1]);expect(delivered).toHaveLength(2);
  expect((await query('SELECT count(*)::int n FROM task_runs'))[0].n).toBe(1);
  expect((await query('SELECT count(*)::int n FROM outcomes'))[0].n).toBe(1);
  expect((await query('SELECT attempt_count,status FROM action_requests'))[0]).toMatchObject({attempt_count:1,status:'completed'});
  expect((await rows(sql`SELECT status FROM v2_tasks`))[0].status).toBe('SUCCEEDED');
  expect((await fixture.post('Prepare a second artifact, which will be revoked.',4)).status).toBe(200);
  await runChannelExecutionCycle(fixture.config,transport,fixture.signer);expect([research,draft,effects]).toEqual([2,2,1]);
  await disconnectTelegram(fixture.accountId,fixture.principalId,fixture.bindingId,fixture.config);
  expect((await telegramManagement(fixture.accountId,fixture.principalId,fixture.config)).state).toBe('REVOKED_CANCELLATION_PENDING');
  fixture.config.executionEnabled=false;
  expect(await runChannelCancellationCycle(fixture.config,transport,fixture.signer)).toMatchObject({state:'CONFIRMED'});
  expect((await telegramManagement(fixture.accountId,fixture.principalId,fixture.config)).state).toBe('REVOKED');
  expect((await query("SELECT count(*)::int n FROM task_runs WHERE status='cancelled'"))[0].n).toBe(1);expect(effects).toBe(1);

 });
});
