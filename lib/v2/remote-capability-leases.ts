import {and,eq,isNull,sql} from 'drizzle-orm';
import {z} from 'zod';
import {withTransaction,type RelayDatabase} from '@/lib/db';
import {runtimeClients,controlOutbox,policyDecisions} from '@/lib/db/schema';
import {lockActiveAccount} from '@/lib/account-fence';
import {RelayError} from '@/lib/errors';
import {actionIntentSchema,canonicalHash} from './contracts';
import {authenticateDeveloperClient,type DeveloperAccessTokenVerifier} from './developer-platform';
import {boundedRemotePort,boundedRemoteSigner,boundedRemoteResolver,REMOTE_CAPABILITY_DEADLINE_MS} from './remote-capability-transport';
import {requireRuntimeActionsEnabled} from './deployment';
import type {AuditSigner} from './evidence/crypto';
import {issueCapabilityLeaseInTransaction,validateUnconsumedLeaseInTransaction,validateWorkloadForPreparation,type LeaseKeyResolver} from './leases';
import {id,now} from '@/lib/ids';
import {evaluatePolicyInTransaction,type PolicyResourceResolver,type PolicyFactResolver} from './policy';
import {createApprovalRequestInTransaction} from './approvals';
import {requireCurrentAgentPassport} from './passports';
import {requireRemoteAdmissionPolicy} from './policy/ordering';
import {verifyPolicyMessage,policyMessageHash} from './policy/ordering-wire';

export const remoteLeaseRequestSchema=z.object({
 action:actionIntentSchema,workloadId:z.string().regex(/^wkl_/).max(200),workloadIdentityToken:z.string().min(1).max(16384),
 audience:z.string().min(1).max(255),ttlSeconds:z.number().int().min(1).max(30).default(30),maxCalls:z.literal(1),
 approvalRequestId:z.string().min(1).max(200).optional(),budgetReservationId:z.string().min(1).max(200).optional(),
 remoteAdmission:z.object({message:z.string().min(1).max(16384),keyId:z.string().min(1).max(255),signature:z.string().min(1).max(128)}).strict(),
}).strict();
type RemoteInput={accountId:string;credential:string;expectedResource:string;request:unknown;oauthVerifier?:DeveloperAccessTokenVerifier};
type RemoteContext={transaction:RelayDatabase;request:z.infer<typeof remoteLeaseRequestSchema>;current:Awaited<ReturnType<typeof requireRemoteAdmissionPolicy>>;signer:AuditSigner;resolver:LeaseKeyResolver};
async function withRemoteContext<T>(input:RemoteInput,signer:AuditSigner,resolver:LeaseKeyResolver,operation:(context:RemoteContext)=>Promise<T>){
 requireRuntimeActionsEnabled();
 signer=boundedRemoteSigner(signer);resolver=boundedRemoteResolver(resolver);
 const parsed=remoteLeaseRequestSchema.safeParse(input.request);
 if(!parsed.success)throw new RelayError('INVALID_INPUT','Invalid remote capability lease request.',undefined,400);
 const request=parsed.data;
 const client=await boundedRemotePort(()=>authenticateDeveloperClient({accountId:input.accountId,credential:input.credential,expectedResource:input.expectedResource,oauthVerifier:input.oauthVerifier}));
 if(request.action.accountId!==input.accountId||request.action.runtimeClientId!==client.runtimeClientId)
  throw new RelayError('CAPABILITY_DENIED','Remote lease runtime identity mismatch.',undefined,403);
 return withTransaction(async transaction=>{
  await transaction.execute(sql`SELECT set_config('statement_timeout', ${String(REMOTE_CAPABILITY_DEADLINE_MS)}, true), set_config('lock_timeout', ${String(REMOTE_CAPABILITY_DEADLINE_MS)}, true)`);
  await transaction.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended('relay-safety-policy', 0))`);
  await lockActiveAccount(transaction,input.accountId);
  const [runtime]=await transaction.select({id:runtimeClients.id}).from(runtimeClients).where(and(eq(runtimeClients.accountId,input.accountId),eq(runtimeClients.id,client.runtimeClientId),isNull(runtimeClients.revokedAt),sql`${runtimeClients.verificationStatus} <> 'REVOKED'`)).limit(1);
  if(!runtime)throw new RelayError('CAPABILITY_DENIED','Runtime authority was revoked.',undefined,403);
  await requireCurrentAgentPassport(input.accountId,request.action.agentId,signer,transaction);
  const current=await requireRemoteAdmissionPolicy(transaction,{accountId:input.accountId,action:request.action,source:request.remoteAdmission});
  await validateWorkloadForPreparation(transaction,{accountId:input.accountId,...request},resolver);
  return operation({transaction,request,current,signer,resolver});
 });
}

export async function issueRemoteCapabilityLease(input:RemoteInput,signer:AuditSigner,resolver:LeaseKeyResolver){
 return withRemoteContext(input,signer,resolver,async({transaction,request,current,signer,resolver})=>{
  const result=await issueCapabilityLeaseInTransaction(transaction,{accountId:input.accountId,...request,allowOffline:false},signer,resolver);
  if(!result.remotePermit)throw new RelayError('CAPABILITY_DENIED','Canonical remote permit unavailable.',undefined,403);
  const proof=await verifyPolicyMessage(result.remotePermit,current.config.signer);
  if(proof.kind!=='PERMIT'||proof.authority!=='relay'||proof.version!==current.epoch.version||proof.policyId!==current.epoch.policyId
   ||proof.expiresAt<=Date.now()||proof.sourcePermitHash!==await policyMessageHash(current.permit))
   throw new RelayError('CAPABILITY_DENIED','Remote lease receipt is stale.',undefined,403);
  await validateUnconsumedLeaseInTransaction(transaction,{token:result.token,expectedAccountId:input.accountId,expectedAudience:request.audience,expectedWorkloadId:request.workloadId,action:request.action},resolver);
  return result;
 });
}

export interface RemoteCapabilityPreparationBindings {
 resourceResolver:PolicyResourceResolver;
 factResolvers?:PolicyFactResolver[];
 /** Trusted enrollment maps the policy obligation to owner-facing evidence and approvers. Never supplied by HTTP callers. */
 approvalRequest?: (input:{accountId:string;action:z.infer<typeof actionIntentSchema>;decision:Awaited<ReturnType<typeof evaluatePolicyInTransaction>>})=>Promise<Pick<Parameters<typeof createApprovalRequestInTransaction>[1],'approvalClass'|'summary'|'consequence'|'displayEvidence'|'assignedPrincipalIds'>>;
}
export async function prepareRemoteCapabilityLease(input:RemoteInput,signer:AuditSigner,resolver:LeaseKeyResolver,bindings?:RemoteCapabilityPreparationBindings){
 if(!bindings)throw new RelayError('CONNECTION_REQUIRED','Trusted remote capability preparation is not configured.',undefined,503);
 return withRemoteContext(input,signer,resolver,async({transaction,request,current,signer})=>{
  const key=`remote-preparation:${canonicalHash(request.remoteAdmission.message)}`;
  const fingerprint=canonicalHash({action:request.action,workloadId:request.workloadId,audience:request.audience,relayPolicyId:current.epoch.policyId,relayVersion:current.epoch.version});
  type Prepared={decision:Awaited<ReturnType<typeof evaluatePolicyInTransaction>>;approvalRequest:Awaited<ReturnType<typeof createApprovalRequestInTransaction>>|null};
  const [prior]=await transaction.select().from(controlOutbox).where(and(eq(controlOutbox.accountId,input.accountId),eq(controlOutbox.idempotencyKey,key))).limit(1);
  if(prior){
   const saved=prior.payload as {fingerprint:string;result:Prepared};
   if(saved.fingerprint!==fingerprint)throw new RelayError('CAPABILITY_DENIED','Preparation changed or policy is stale.',undefined,409);
   const [decision]=await transaction.select({id:policyDecisions.id}).from(policyDecisions).where(and(eq(policyDecisions.accountId,input.accountId),eq(policyDecisions.id,saved.result.decision.decisionId),sql`${policyDecisions.expiresAt}>${now()}`)).limit(1);
   if(!decision)throw new RelayError('CAPABILITY_DENIED','Prepared policy decision expired; prepare a fresh source reference.',undefined,403);
   return saved.result;
  }
  const decision=await evaluatePolicyInTransaction(transaction,{accountId:input.accountId,action:request.action,
   resourceResolver:{resolveOwnership:value=>boundedRemotePort(()=>bindings.resourceResolver.resolveOwnership(value))},
   factResolvers:bindings.factResolvers?.map(resolver=>({name:resolver.name,resolve:value=>boundedRemotePort(()=>resolver.resolve(value))})),
  },signer);
  let approvalRequest:Prepared['approvalRequest']=null;
  if(decision.outcome==='REQUIRE_APPROVAL'){
   if(!bindings.approvalRequest)throw new RelayError('CONNECTION_REQUIRED','Owner approval preparation is not configured.',undefined,503);
   const display=await boundedRemotePort(()=>bindings.approvalRequest!({accountId:input.accountId,action:request.action,decision}));
   approvalRequest=await createApprovalRequestInTransaction(transaction,{...display,accountId:input.accountId,action:request.action,policyDecisionId:decision.decisionId,
    expiresAt:new Date(Math.min(Date.parse(decision.expiresAt),current.permit.expiresAt)).toISOString()},signer);
  }
  const result:Prepared={decision,approvalRequest};
  await transaction.insert(controlOutbox).values({id:id('obx'),accountId:input.accountId,aggregateType:'remote_capability_preparation',aggregateId:decision.decisionId,type:'capability.prepared',payload:{fingerprint,result},idempotencyKey:key,publishedAt:now()});
  return result;
 });
}
