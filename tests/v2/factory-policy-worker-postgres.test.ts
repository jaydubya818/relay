import {afterEach,expect,it} from 'vitest';
import {db,withTransaction} from '@/lib/db';
import {controlOutbox} from '@/lib/db/schema';
import {canonicalHash} from '@/lib/v2/contracts';
import {createLocalEd25519Signer} from '@/lib/v2/evidence/crypto';
import {acknowledgePolicyPropagation,enqueuePolicyPropagation,inspectPolicyPropagation} from '@/lib/v2/policy/propagation';
import {configureV2PlatformBindings} from '@/lib/v2/platform-bindings';
import {runFactoryPolicyPropagation,type FactoryPropagationDestination} from '@/scripts/factory-policy-propagation';
import {freshDatabase,cleanupDatabase} from '../helpers';
afterEach(cleanupDatabase);

it('real PostgreSQL pages beyond128 signed retained revocations and durably acknowledges the exact fresh event',async()=>{
 const actor=await freshDatabase(),signer=createLocalEd25519Signer('fixture-relay'),backend=createLocalEd25519Signer('fixture-backend');
 configureV2PlatformBindings({signer,keyResolver:{publicKeyForKeyId:async()=>undefined}});
 const destination={accountId:actor.accountId,ownerId:actor.userId,organizationId:actor.accountId,agentId:'fixture-agent',
  installationId:'isolated-postgres-fixture',backendId:'myfactory',keyId:backend.keyId,publicKeyPem:await backend.publicKeyPem(),
  endpoint:'https://fixture.invalid/api/relay-policy',headers:async()=>({'authorization':'local-fixture'})} satisfies FactoryPropagationDestination;
 const completed=async(event:{eventId:string;payloadHash:string})=>{
  const receipt={schema:'relay.policy-ack.v1',accountId:actor.accountId,eventId:event.eventId,eventHash:event.payloadHash,
   backendId:destination.backendId,installationId:destination.installationId,keyId:backend.keyId,sequence:1,
   admissionFence:'APPLIED',writers:'FENCED',executionAuthority:'INVALIDATED',cleanup:'CONFIRMED',accounting:'PRESERVE_UNKNOWN',evidenceReferences:['fixture-native-cleanup']};
  return {receipt,signature:await backend.sign(canonicalHash(receipt))};
 };
 const retained=[];
 for(let revision=1;revision<=129;revision++){
  const event=await withTransaction(tx=>enqueuePolicyPropagation(tx,{accountId:actor.accountId,aggregateId:destination.agentId,kind:'AGENT_REVOKED',revision,source:{fixture:true}},signer));
  retained.push(event);
  const ack=await completed(event);await acknowledgePolicyPropagation(ack.receipt,ack.signature,destination,signer);
 }
 // Irrelevant history exceeds the page bound as well. It must be excluded in SQL,
 // rather than consuming the receiving agent's scan allowance.
 await db().insert(controlOutbox).values(Array.from({length:130},(_,i)=>({id:'fixture-irrelevant-'+i,accountId:actor.accountId,
  aggregateType:'capability_policy',aggregateId:'foreign-agent',type:'capability.policy.changed',idempotencyKey:'fixture-irrelevant-'+i,
  createdAt:'2000-01-01T00:00:00.000Z',payload:{payload:{kind:i%2?'POLICY_CHANGED':'AGENT_REVOKED',aggregateId:'foreign-agent'}}})));
 const fresh=await withTransaction(tx=>enqueuePolicyPropagation(tx,{accountId:actor.accountId,aggregateId:destination.agentId,kind:'AGENT_REVOKED',revision:130,source:{fixture:true}},signer));
 const sends:string[]=[];
 const send=async(_url:Parameters<typeof fetch>[0],init?:RequestInit)=>{
  const envelope=JSON.parse(String(init?.body)).envelope;sends.push(envelope.payload.eventId);
  expect(envelope.payload.eventId).toBe(fresh.eventId);
  return Response.json(await completed(fresh));
 };
 const first=await runFactoryPolicyPropagation(async()=>[destination],send);
 expect(first.status).toBe('PENDING_BACKEND');expect(sends).toEqual([]);
 const second=await runFactoryPolicyPropagation(async()=>[destination],send);
 expect(second.status).toBe('DRAINED');expect(sends).toEqual([fresh.eventId]);
 expect(second.deliveries).toEqual([{eventId:fresh.eventId,backendId:'myfactory',status:'ACKNOWLEDGED'}]);
 expect(await inspectPolicyPropagation(actor.accountId,fresh.eventId,[destination])).toMatchObject({status:'ACKNOWLEDGED',accounting:'PRESERVE_UNKNOWN'});
 await runFactoryPolicyPropagation(async()=>[destination],send);
 await runFactoryPolicyPropagation(async()=>[destination],send);
 expect(sends).toHaveLength(1);
 expect(await inspectPolicyPropagation(actor.accountId,retained[0]!.eventId,[destination])).toMatchObject({status:'ACKNOWLEDGED'});
},60000);
