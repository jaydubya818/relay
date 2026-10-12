import {and,eq,isNull,sql} from 'drizzle-orm';
import {z} from 'zod';
import {withTransaction} from '@/lib/db';
import {runtimeClients} from '@/lib/db/schema';
import {lockActiveAccount} from '@/lib/account-fence';
import {RelayError} from '@/lib/errors';
import {actionIntentSchema} from './contracts';
import {authenticateDeveloperClient,type DeveloperAccessTokenVerifier} from './developer-platform';
import {requireRuntimeActionsEnabled} from './deployment';
import type {AuditSigner} from './evidence/crypto';
import {issueCapabilityLeaseInTransaction,validateUnconsumedLeaseInTransaction,type LeaseKeyResolver} from './leases';
import {requireCurrentAgentPassport} from './passports';
import {requireRemoteAdmissionPolicy} from './policy/ordering';
import {verifyPolicyMessage,policyMessageHash} from './policy/ordering-wire';

export const remoteLeaseRequestSchema=z.object({
 action:actionIntentSchema,workloadId:z.string().regex(/^wkl_/).max(200),workloadIdentityToken:z.string().min(1).max(16384),
 audience:z.string().min(1).max(255),ttlSeconds:z.number().int().min(1).max(30).optional(),maxCalls:z.literal(1),
 approvalRequestId:z.string().min(1).max(200).optional(),budgetReservationId:z.string().min(1).max(200).optional(),
 remoteAdmission:z.object({message:z.string().min(1).max(16384),keyId:z.string().min(1).max(255),signature:z.string().min(1).max(128)}).strict(),
}).strict();
export async function issueRemoteCapabilityLease(input:{accountId:string;credential:string;expectedResource:string;request:unknown;oauthVerifier?:DeveloperAccessTokenVerifier},signer:AuditSigner,resolver:LeaseKeyResolver){
 requireRuntimeActionsEnabled();
 const parsed=remoteLeaseRequestSchema.safeParse(input.request);
 if(!parsed.success)throw new RelayError('INVALID_INPUT','Invalid remote capability lease request.',undefined,400);
 const request=parsed.data;
 const client=await authenticateDeveloperClient({accountId:input.accountId,credential:input.credential,expectedResource:input.expectedResource,oauthVerifier:input.oauthVerifier});
 if(request.action.accountId!==input.accountId||request.action.runtimeClientId!==client.runtimeClientId)
  throw new RelayError('CAPABILITY_DENIED','Remote lease runtime identity mismatch.',undefined,403);
 return withTransaction(async transaction=>{
  await transaction.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended('relay-safety-policy', 0))`);
  await lockActiveAccount(transaction,input.accountId);
  const [runtime]=await transaction.select({id:runtimeClients.id}).from(runtimeClients).where(and(eq(runtimeClients.accountId,input.accountId),eq(runtimeClients.id,client.runtimeClientId),isNull(runtimeClients.revokedAt),sql`${runtimeClients.verificationStatus} <> 'REVOKED'`)).limit(1);
  if(!runtime)throw new RelayError('CAPABILITY_DENIED','Runtime authority was revoked.',undefined,403);
  await requireCurrentAgentPassport(input.accountId,request.action.agentId,signer,transaction);
  const current=await requireRemoteAdmissionPolicy(transaction,{accountId:input.accountId,action:request.action,source:request.remoteAdmission});
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
