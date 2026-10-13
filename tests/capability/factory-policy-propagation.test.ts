import {beforeEach,describe,it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({events:[] as any[],status:'PENDING_BACKEND',trace:[] as string[],reject:false}));
vi.mock('../../lib/db',()=>({db:()=>({select:()=>({from:()=>({where:()=>({limit:async()=>fixture.events})})})})}));
vi.mock('../../lib/v2/policy/ordering',()=>({flushRelayPolicyFences:async()=>{fixture.trace.push('flush');}}));
vi.mock('../../lib/v2/platform-bindings',()=>({requireV2PlatformBindings:()=>({signer:{keyId:'original-key'}})}));
vi.mock('../../lib/v2/policy/propagation',()=>({
 inspectPolicyPropagation:async()=>{fixture.trace.push('inspect');return {status:fixture.status};},
 acknowledgePolicyPropagation:async()=>{fixture.trace.push('ack');if(fixture.reject)throw Error('WRONG_SIGNATURE');},
}));
import {runFactoryPolicyPropagation,type FactoryPropagationDestination} from '../../scripts/factory-policy-propagation';
const destination={accountId:'account',ownerId:'owner',organizationId:'org',agentId:'agent',backendId:'factory',installationId:'install',keyId:'original-backend',publicKeyPem:'original-pem',endpoint:'https://fixture.invalid/api/relay-policy',headers:async()=>({'authorization':'fixture-only'})} satisfies FactoryPropagationDestination;
describe('Factory agent policy worker preserves native acknowledgment authority',()=>{
 beforeEach(()=>{fixture.events=[{id:'event',cancelledAt:null,payload:{payload:{kind:'AGENT_REVOKED',aggregateId:'agent'}}}];fixture.status='PENDING_BACKEND';fixture.trace=[];fixture.reject=false;});
 const send=async()=>{fixture.trace.push('send');return Response.json({receipt:{schema:'relay.policy-ack.v1'},signature:'native-signed-fixture'});};
 it('is not enrolled without original records and never creates a destination',async()=>{expect(await runFactoryPolicyPropagation(undefined,send)).toEqual({status:'NOT_ENROLLED',deliveries:[]});expect(fixture.trace).toEqual([]);});
 it('flushes original fences before delivery and waits for durable native ACK status',async()=>{
  const result=await runFactoryPolicyPropagation(async()=>[destination],send);expect(result.status).toBe('PENDING_BACKEND');
  expect(fixture.trace).toEqual(['inspect','flush','send','ack','inspect']);
 });
 it('acknowledged duplicate delivery performs no network or native transaction',async()=>{fixture.status='ACKNOWLEDGED';expect((await runFactoryPolicyPropagation(async()=>[destination],send)).deliveries).toEqual([]);expect(fixture.trace).toEqual(['inspect']);});
 it('signature/owner rejection stays pending and cannot be upgraded by HTTP success',async()=>{fixture.reject=true;const result=await runFactoryPolicyPropagation(async()=>[destination],send);expect(result.status).toBe('PENDING_BACKEND');expect(result.deliveries[0].status).toBe('PENDING_BACKEND');});
 it('ignores other native event kinds and foreign agents',async()=>{fixture.events[0].payload.payload.kind='POLICY_CHANGED';expect((await runFactoryPolicyPropagation(async()=>[destination],send)).deliveries).toEqual([]);fixture.events[0].payload.payload.kind='AGENT_REVOKED';fixture.events[0].payload.payload.aggregateId='foreign';expect((await runFactoryPolicyPropagation(async()=>[destination],send)).deliveries).toEqual([]);expect(fixture.trace).toEqual([]);});
 it('rejects unbound endpoint and overflow before remote delivery',async()=>{await expect(runFactoryPolicyPropagation(async()=>[{...destination,endpoint:'http://fixture.invalid/api/relay-policy'}],send)).rejects.toThrow('ENROLLMENT');fixture.events=Array(129).fill(fixture.events[0]);await expect(runFactoryPolicyPropagation(async()=>[destination],send)).rejects.toThrow('OUTBOX_BOUND');expect(fixture.trace).toEqual([]);});
});
