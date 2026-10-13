import {beforeEach,describe,it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({events:[] as any[],status:'PENDING_BACKEND',trace:[] as string[],reject:false,pages:undefined as any[][]|undefined}));
vi.mock('../../lib/db',()=>({db:()=>({select:()=>({from:()=>({where:()=>({orderBy:()=>({limit:async()=>fixture.pages?.shift()??fixture.events})})})})})}));
vi.mock('../../lib/v2/policy/ordering',()=>({flushRelayPolicyFences:async()=>{fixture.trace.push('flush');}}));
vi.mock('../../lib/v2/platform-bindings',()=>({requireV2PlatformBindings:()=>({signer:{keyId:'original-key'}})}));
vi.mock('../../lib/v2/policy/propagation',()=>({
 inspectPolicyPropagation:async(_account:string,eventId:string)=>{fixture.trace.push('inspect');return {status:eventId.startsWith('old-')?'ACKNOWLEDGED':fixture.status};},
 acknowledgePolicyPropagation:async()=>{fixture.trace.push('ack');if(fixture.reject)throw Error('WRONG_SIGNATURE');},
}));
import {runFactoryPolicyPropagation,type FactoryPropagationDestination} from '../../scripts/factory-policy-propagation';
const destination={accountId:'account',ownerId:'owner',organizationId:'org',agentId:'agent',backendId:'factory',installationId:'install',keyId:'original-backend',publicKeyPem:'original-pem',endpoint:'https://fixture.invalid/api/relay-policy',headers:async()=>({'authorization':'fixture-only'})} satisfies FactoryPropagationDestination;
describe('Factory agent policy worker preserves native acknowledgment authority',()=>{
 beforeEach(()=>{fixture.events=[{id:'event',cancelledAt:null,payload:{payload:{kind:'AGENT_REVOKED',aggregateId:'agent'}}}];fixture.status='PENDING_BACKEND';fixture.trace=[];fixture.reject=false;fixture.pages=undefined;});
 const send=async()=>{fixture.trace.push('send');return Response.json({receipt:{schema:'relay.policy-ack.v1'},signature:'native-signed-fixture'});};
 it('is not enrolled without original records and never creates a destination',async()=>{expect(await runFactoryPolicyPropagation(undefined,send)).toEqual({status:'NOT_ENROLLED',deliveries:[]});expect(fixture.trace).toEqual([]);});
 it('flushes original fences before delivery and waits for durable native ACK status',async()=>{
  const result=await runFactoryPolicyPropagation(async()=>[destination],send);expect(result.status).toBe('PENDING_BACKEND');
  expect(fixture.trace).toEqual(['inspect','flush','send','ack','inspect']);
 });
 it('acknowledged duplicate delivery performs no network or native transaction',async()=>{fixture.status='ACKNOWLEDGED';expect((await runFactoryPolicyPropagation(async()=>[destination],send)).deliveries).toEqual([]);expect(fixture.trace).toEqual(['inspect']);});
 it('signature/owner rejection stays pending and cannot be upgraded by HTTP success',async()=>{fixture.reject=true;const result=await runFactoryPolicyPropagation(async()=>[destination],send);expect(result.status).toBe('PENDING_BACKEND');expect(result.deliveries[0].status).toBe('PENDING_BACKEND');});
 it('ignores other native event kinds and foreign agents',async()=>{fixture.events[0].payload.payload.kind='POLICY_CHANGED';expect((await runFactoryPolicyPropagation(async()=>[destination],send)).deliveries).toEqual([]);fixture.events[0].payload.payload.kind='AGENT_REVOKED';fixture.events[0].payload.payload.aggregateId='foreign';expect((await runFactoryPolicyPropagation(async()=>[destination],send)).deliveries).toEqual([]);expect(fixture.trace).toEqual([]);});
 it('isolates malformed original destinations without blocking another account',async()=>{const result=await runFactoryPolicyPropagation(async()=>[{...destination,endpoint:'http://fixture.invalid/api/relay-policy'},destination],send);expect(result.status).toBe('PENDING_BACKEND');expect(fixture.trace).toEqual(['inspect','flush','send','ack','inspect']);});
 it('pages past129 retained acknowledged events and then delivers a fresh relevant revocation',async()=>{
  const old=Array.from({length:129},(_,i)=>({id:'old-'+String(i).padStart(4,'0'),createdAt:new Date(0).toISOString(),cancelledAt:null,payload:{payload:{kind:'AGENT_REVOKED',aggregateId:'agent'}}}));
  const fresh={id:'fresh-event',createdAt:new Date(1000).toISOString(),cancelledAt:null,payload:{payload:{kind:'AGENT_REVOKED',aggregateId:'agent'}}};
  fixture.pages=[old.slice(0,128),[old[128],fresh]];
  const read=async()=>[{...destination,backendId:'paging-fixture'}];
  expect((await runFactoryPolicyPropagation(read,send)).status).toBe('PENDING_BACKEND');expect(fixture.trace.filter(x=>x==='send')).toHaveLength(0);
  const second=await runFactoryPolicyPropagation(read,send);expect(second.deliveries).toEqual([{eventId:'fresh-event',backendId:'paging-fixture',status:'PENDING_BACKEND'}]);
  expect(fixture.trace.filter(x=>x==='send')).toHaveLength(1);expect(fixture.trace.filter(x=>x==='ack')).toHaveLength(1);
 });
 it('a continuously full first destination cannot starve a second owner',async()=>{
  const old=Array.from({length:64},(_,i)=>({id:'old-fair-'+i,createdAt:new Date(0).toISOString(),cancelledAt:null,payload:{payload:{kind:'AGENT_REVOKED',aggregateId:'agent'}}}));
  const fresh={id:'fresh-second-owner',createdAt:new Date(1000).toISOString(),cancelledAt:null,payload:{payload:{kind:'AGENT_REVOKED',aggregateId:'agent'}}};
  const read=async()=>[{...destination,backendId:'busy-owner'},{...destination,accountId:'second-account',backendId:'second-owner'}];
  for(let i=0;i<3;i++){
   fixture.pages=[old,[fresh]];
   const result=await runFactoryPolicyPropagation(read,send);
   expect(result.deliveries).toEqual([{eventId:'fresh-second-owner',backendId:'second-owner',status:'PENDING_BACKEND'}]);
  }
  expect(fixture.trace.filter(x=>x==='send')).toHaveLength(3);
 });
 it('an empty final page cannot call an earlier failed delivery drained',async()=>{
  const old=Array.from({length:127},(_,i)=>({id:'old-pending-'+i,createdAt:new Date(0).toISOString(),cancelledAt:null,payload:{payload:{kind:'AGENT_REVOKED',aggregateId:'agent'}}}));
  const fresh={id:'pending-first-page',createdAt:new Date(0).toISOString(),cancelledAt:null,payload:{payload:{kind:'AGENT_REVOKED',aggregateId:'agent'}}};
  fixture.pages=[[fresh,...old],[]];fixture.reject=true;
  const read=async()=>[{...destination,backendId:'pending-scan-fixture'}];
  expect((await runFactoryPolicyPropagation(read,send)).status).toBe('PENDING_BACKEND');
  expect((await runFactoryPolicyPropagation(read,send)).status).toBe('PENDING_BACKEND');
  fixture.reject=false;fixture.status='ACKNOWLEDGED';fixture.pages=[[fresh,...old],[]];
  expect((await runFactoryPolicyPropagation(read,send)).status).toBe('PENDING_BACKEND');
  expect((await runFactoryPolicyPropagation(read,send)).status).toBe('DRAINED');
 });

});
