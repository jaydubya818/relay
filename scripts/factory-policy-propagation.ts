import {and,eq} from 'drizzle-orm';
import {db} from '../lib/db';
import {controlOutbox} from '../lib/db/schema';
import {flushRelayPolicyFences} from '../lib/v2/policy/ordering';
import {acknowledgePolicyPropagation,inspectPolicyPropagation,type PropagationBinding} from '../lib/v2/policy/propagation';
import {requireV2PlatformBindings} from '../lib/v2/platform-bindings';

export type FactoryPropagationDestination=PropagationBinding & {ownerId:string;organizationId:string;agentId:string;endpoint:string;
 headers:()=>Promise<Record<string,string>>};
/** Reader must return current original server-owned enrollment records. No
 * feature flag, request body, endpoint name or environment default enrolls one. */
export type FactoryPropagationRecords=()=>Promise<readonly FactoryPropagationDestination[]>;
let originalRecords:FactoryPropagationRecords|undefined;
export function configureFactoryPolicyPropagation(reader:FactoryPropagationRecords){originalRecords=reader;}
async function boundedResponse(response:Response){
 if(!response.ok||!response.body)throw Error('FACTORY_POLICY_UNAVAILABLE');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw Error('FACTORY_POLICY_ACK_BOUND');chunks.push(value);}}
 finally{await reader.cancel();}
 return JSON.parse(Buffer.concat(chunks).toString('utf8')) as {receipt:unknown;signature:string};
}
export async function runFactoryPolicyPropagation(records:FactoryPropagationRecords|undefined=originalRecords,send:typeof fetch=fetch){
 if(!records)return {status:'NOT_ENROLLED' as const,deliveries:[]};
 const destinations=await records();if(destinations.length>128)throw Error('FACTORY_POLICY_DESTINATION_BOUND');
 const deliveries:Array<{eventId:string;backendId:string;status:string}>=[];
 for(const destination of destinations){
  const endpoint=new URL(destination.endpoint);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.hash||endpoint.search||endpoint.pathname!=='/api/relay-policy'
   ||!destination.ownerId||!destination.organizationId||!destination.agentId||typeof destination.headers!=='function')throw Error('FACTORY_POLICY_ENROLLMENT');
  const events=await db().select().from(controlOutbox).where(and(eq(controlOutbox.accountId,destination.accountId),eq(controlOutbox.aggregateType,'capability_policy'))).limit(129);
  if(events.length>128)throw Error('FACTORY_POLICY_OUTBOX_BOUND');
  for(const event of events){
   if(event.cancelledAt)continue;
   const envelope=event.payload as {payload:{kind?:string;aggregateId?:string}};
   if(envelope.payload?.kind!=='AGENT_REVOKED'||envelope.payload.aggregateId!==destination.agentId)continue;
   if((await inspectPolicyPropagation(destination.accountId,event.id,[destination])).status==='ACKNOWLEDGED')continue;
   try{
    // Native flush and ACK helper each own their transaction. Network delivery
    // is outside either account lock, avoiding nested publisher transactions.
    await flushRelayPolicyFences(destination.accountId);
    const response=await send(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
     headers:{...await destination.headers(),'content-type':'application/json'},body:JSON.stringify({envelope})});
    const value=await boundedResponse(response);
    if(!value||Object.keys(value).sort().join(',')!=='receipt,signature'||typeof value.signature!=='string')throw Error('FACTORY_POLICY_ACK_INVALID');
    await acknowledgePolicyPropagation(value.receipt,value.signature,destination,requireV2PlatformBindings().signer);
    const status=(await inspectPolicyPropagation(destination.accountId,event.id,[destination])).status;
    deliveries.push({eventId:event.id,backendId:destination.backendId,status});
   }catch{deliveries.push({eventId:event.id,backendId:destination.backendId,status:'PENDING_BACKEND'});}
  }
 }
 return {status:deliveries.some(x=>x.status!=='ACKNOWLEDGED')?'PENDING_BACKEND' as const:'DRAINED' as const,deliveries};
}
export function startFactoryPolicyPropagation(intervalMs=30000){
 let stopped=false,running=false;
 const cycle=async()=>{if(stopped||running)return;running=true;try{await runFactoryPolicyPropagation();}finally{running=false;}};
 const timer=setInterval(()=>{void cycle().catch(()=>{});},intervalMs);
 return {run:cycle,stop(){stopped=true;clearInterval(timer);}};
}
