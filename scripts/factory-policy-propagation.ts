import {and,eq,gt,or,sql} from 'drizzle-orm';
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
type Cursor={createdAt:string;id:string};
const cursors=new Map<string,Cursor>();
const pendingScans=new Set<string>();
const destinationKey=(d:FactoryPropagationDestination)=>JSON.stringify([d.accountId,d.ownerId,d.organizationId,d.installationId,d.backendId,d.agentId,d.keyId]);
async function policyPage(destination:FactoryPropagationDestination,cursor:Cursor|undefined,limit:number){
 return db().select().from(controlOutbox).where(and(eq(controlOutbox.accountId,destination.accountId),
  eq(controlOutbox.aggregateType,'capability_policy'),eq(controlOutbox.aggregateId,destination.agentId),
  sql`${controlOutbox.payload}->'payload'->>'kind'='AGENT_REVOKED'`,
  cursor?or(gt(controlOutbox.createdAt,cursor.createdAt),and(eq(controlOutbox.createdAt,cursor.createdAt),gt(controlOutbox.id,cursor.id))):undefined))
  .orderBy(controlOutbox.createdAt,controlOutbox.id).limit(limit);
}
export async function runFactoryPolicyPropagation(records:FactoryPropagationRecords|undefined=originalRecords,send:typeof fetch=fetch){
 if(!records)return {status:'NOT_ENROLLED' as const,deliveries:[]};
 const destinations=await records();if(destinations.length>128)throw Error('FACTORY_POLICY_DESTINATION_BOUND');
 const currentKeys=new Set(destinations.map(destinationKey));for(const key of cursors.keys())if(!currentKeys.has(key))cursors.delete(key);
 for(const key of pendingScans)if(!currentKeys.has(key))pendingScans.delete(key);
 let scanningPending=false,scanned=0;
 const deliveries:Array<{eventId:string;backendId:string;status:string}>=[];
 for(const destination of destinations){
  if(scanned>=128){scanningPending=true;break;}
  try{
  const endpoint=new URL(destination.endpoint);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.hash||endpoint.search||endpoint.pathname!=='/api/relay-policy'
   ||!destination.ownerId||!destination.organizationId||!destination.agentId||typeof destination.headers!=='function')throw Error('FACTORY_POLICY_ENROLLMENT');
  const key=destinationKey(destination),limit=Math.min(128-scanned,Math.max(1,Math.floor(128/destinations.length))),events=await policyPage(destination,cursors.get(key),limit);
  if(events.length>limit)throw Error('FACTORY_POLICY_BATCH_BOUND');
  scanned+=events.length;
  if(events.length===limit){const last=events.at(-1)!;cursors.set(key,{createdAt:last.createdAt,id:last.id});scanningPending=true;}else cursors.delete(key);
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
    if(status!=='ACKNOWLEDGED')pendingScans.add(key);
   }catch{pendingScans.add(key);deliveries.push({eventId:event.id,backendId:destination.backendId,status:'PENDING_BACKEND'});}
  }
  // A short last page cannot certify earlier pages whose ACK is still pending.
  // Reset only the scan hint at wrap; durable native ACKs remain authoritative.
  if(events.length<limit){if(pendingScans.has(key))scanningPending=true;pendingScans.delete(key);}
  }catch{scanningPending=true;deliveries.push({eventId:'UNAVAILABLE',backendId:destination.backendId,status:'PENDING_BACKEND'});}
 }
 return {status:scanningPending||deliveries.some(x=>x.status!=='ACKNOWLEDGED')?'PENDING_BACKEND' as const:'DRAINED' as const,deliveries};
}
export function startFactoryPolicyPropagation(intervalMs=30000){
 let stopped=false,running=false;
 const cycle=async()=>{if(stopped||running)return;running=true;try{await runFactoryPolicyPropagation();}finally{running=false;}};
 const timer=setInterval(()=>{void cycle().catch(()=>{});},intervalMs);
 return {run:cycle,stop(){stopped=true;clearInterval(timer);}};
}
