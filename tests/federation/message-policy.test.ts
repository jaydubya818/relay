import { eq } from "drizzle-orm";
import { canonicalHash } from "@/lib/v2/contracts";
import { requireCurrentAgentPassport, issueAgentPassport } from "@/lib/v2/passports";
import { registerCapabilityDefinition, publishRelaySafetyPolicy, evaluatePolicy, stageAccountPolicy } from "@/lib/v2/policy";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accountMemberships, principals, users, policyBundles } from "@/lib/db/schema";
import { hashPassword } from "@/lib/crypto";
import { id } from "@/lib/ids";
import { createAgent } from "@/lib/agents";
import { createLocalEd25519Signer, createLocalRsaKeyWrapper } from "@/lib/v2/evidence/crypto";
import { provisionFederationCapabilities } from "@/lib/v2/federation/capabilities";
import { manageMessageEnrollment } from "@/lib/v2/federation/enrollment";
import { manageMessagePolicy } from "@/lib/v2/federation/message-policy";
import { createFederationGrant, registerFederationAgent, revokeFederationGrant } from "@/lib/v2/federation/registry";
import { submitFederationRequest, pollFederationInbox, respondToFederationRequest, getFederationRequest } from "@/lib/v2/federation/service";
import { verifyDelivery } from "@/lib/v2/federation/transport";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";
const password="correct-horse-battery-staple", expires=()=>new Date(Date.now()+3600000).toISOString();
async function fixture() {
 const a=await freshDatabase(), owners=[a];
 for(const name of ["B","C"]) {
  const accountId=await secondAccount(), userId=id("usr"), principalId=id("prn");
  await db().insert(users).values({id:userId,accountId,email:`${name}@example.invalid`,name,role:"OWNER",passwordHash:hashPassword(password)});
  await db().insert(principals).values({id:principalId,type:"HUMAN",userId,displayName:name});
  await db().insert(accountMemberships).values({accountId,principalId,role:"OWNER"});owners.push({accountId,userId,principalId});
 }
 const signer=createLocalEd25519Signer(), bindings={signer,keyWrapper:createLocalRsaKeyWrapper(),issuer:"https://relay.local"};
 await provisionFederationCapabilities(signer);
 const agents=[];
 for(const owner of owners) {
  const agent=await createAgent(owner.accountId,{name:"Synthetic peer",capabilities:[]});agents.push(agent);
  await registerFederationAgent(owner,{agentId:agent.agentId,platform:"qualification",capabilities:[{name:"message.send",version:"1.0"},{name:"message.receive",version:"1.0"}]},signer);
  await manageMessageEnrollment(owner,agent.agentId,{operation:"issue",expectedVersion:0,expiresAt:expires()},signer);
 }
 return {owners,agents,bindings,signer};
}
afterEach(cleanupDatabase);
describe("explicit owner peer-message policy",()=>{
 it("requires fresh password and exact owner/hash scope before allowing all six correlated directions",async()=>{
  const f=await fixture(), bundles=[];
  for(let target=0;target<3;target++){
   const staged=await manageMessagePolicy(f.owners[target],{operation:"stage",agentId:f.agents[target].agentId,peers:f.owners.flatMap((o,i)=>i===target?[]:[{ownerId:o.accountId,agentId:f.agents[i].agentId}])},f.signer);
   bundles.push(staged.bundleId);
  }
  expect((await db().select().from(policyBundles)).every(p=>p.status==="STAGED")).toBe(true);
  const make=(source:number,target:number,suffix:string)=>({target:`relay://${f.owners[target].accountId}/${f.agents[target].agentId}`,capability:"message.send",resource:"messages",idempotencyKey:`message-${source}-${target}-${suffix}`,expiresAt:expires(),conversationId:`conversation-${source}-${target}`,payload:{body:`Hello ${source} to ${target}`}});
  const grants=[];
  for(let source=0;source<3;source++)for(let target=0;target<3;target++)if(source!==target){
   const grant=await createFederationGrant(f.owners[target],{grantorAgentId:f.agents[target].agentId,granteeOwnerId:f.owners[source].accountId,granteeAgentId:f.agents[source].agentId,capability:"message.send",resource:"messages",conditions:{expiresAt:expires(),rateLimit:{calls:10,windowSeconds:60},allowedTopics:[],approvalRequired:false}},f.signer);grants.push({source,target,id:grant.grantId});
   await expect(submitFederationRequest(f.agents[source].credential,make(source,target,"staged"),f.bindings)).rejects.toMatchObject({status:403});
  }
  for(let target=0;target<3;target++){
   const command={operation:"activate",agentId:f.agents[target].agentId,bundleId:bundles[target],password:"wrong-password"};
   await expect(manageMessagePolicy(f.owners[target],command,f.signer)).rejects.toMatchObject({status:401});
   await expect(manageMessagePolicy(f.owners[(target+1)%3],{...command,password},f.signer)).rejects.toMatchObject({status:404});
   expect(await manageMessagePolicy(f.owners[target],{...command,password},f.signer)).toMatchObject({status:"ACTIVE"});
  }
  const claimed=new Set<string>();
  for(const {source,target,id:grantId} of grants){
   const request=await submitFederationRequest(f.agents[source].credential,make(source,target,"authorized"),f.bindings);
   const deliveries=await pollFederationInbox(f.agents[target].credential,f.bindings),delivery=deliveries.deliveries.find(d=>d.requestId===request.requestId)!;
   const envelope=await verifyDelivery(delivery.token,{issuer:f.bindings.issuer,audience:`relay://${f.owners[target].accountId}/${f.agents[target].agentId}`,trustedPublicKey:async()=>f.signer.publicKeyPem(),claimRequest:async requestId=>{if(claimed.has(requestId))return false;claimed.add(requestId);return true;}});
   expect(envelope.caller.agentId).toBe(f.agents[source].agentId);
   await respondToFederationRequest(f.agents[target].credential,request.requestId,{status:"ACCEPTED"},f.bindings);
   await respondToFederationRequest(f.agents[target].credential,request.requestId,{status:"COMPLETED",result:{acknowledged:true,reply:{body:`Response ${target} to ${source}`,replyTo:request.requestId}}},f.bindings);
   expect(await getFederationRequest(f.agents[source].credential,request.requestId,f.bindings)).toMatchObject({status:"COMPLETED",result:{acknowledged:true,reply:{replyTo:request.requestId}}});
   const third=[0,1,2].find(i=>i!==source&&i!==target)!;
   await expect(getFederationRequest(f.agents[third].credential,request.requestId,f.bindings)).rejects.toMatchObject({status:403});
   await revokeFederationGrant(f.owners[target],grantId,f.signer);
   await expect(submitFederationRequest(f.agents[source].credential,make(source,target,"revoked"),f.bindings)).rejects.toMatchObject({status:403});
  }
  for(let target=0;target<3;target++){
   await expect(manageMessagePolicy(f.owners[target],{operation:"retire",agentId:f.agents[target].agentId,bundleId:bundles[target],password:"wrong"},f.signer)).rejects.toMatchObject({status:401});
   expect(await manageMessagePolicy(f.owners[target],{operation:"retire",agentId:f.agents[target].agentId,bundleId:bundles[target],password},f.signer)).toMatchObject({status:"RETIRED"});
  }
  expect((await db().select().from(policyBundles)).every(p=>p.status==="RETIRED")).toBe(true);
 },15000);
 it("rejects generic reserved-name policies and durable document tampering",async()=>{
  const f=await fixture(), owner=f.owners[0],agentId=f.agents[0].agentId;
  const arbitrary=await stageAccountPolicy({accountId:owner.accountId,actorPrincipalId:owner.principalId,name:`peer-messages:${agentId}`,layer:"ACCOUNT",rules:[{id:"arbitrary-work",effect:"ALLOW",match:{capability:{name:"work.request",version:"1.0"}},reasonCode:"UNRELATED_WORK"}]},f.signer);
  await expect(manageMessagePolicy(owner,{operation:"activate",agentId,bundleId:arbitrary.bundleId,password},f.signer)).rejects.toBeDefined();
  const narrow=await manageMessagePolicy(owner,{operation:"stage",agentId,peers:[{ownerId:f.owners[1].accountId,agentId:f.agents[1].agentId}]},f.signer);
  await db().update(policyBundles).set({rules:[{id:"arbitrary-work",effect:"ALLOW",match:{capability:{name:"work.request",version:"1.0"}},reasonCode:"UNRELATED_WORK"}]}).where(eq(policyBundles.id,narrow.bundleId));
  await expect(manageMessagePolicy(owner,{operation:"activate",agentId,bundleId:narrow.bundleId,password},f.signer)).rejects.toBeDefined();
  expect((await db().select().from(policyBundles)).every(p=>p.status==="STAGED")).toBe(true);
 });
 it("preserves unrelated allowed capabilities while requiring facts for applicable message rules",async()=>{
  const f=await fixture(),owner=f.owners[0],agentId=f.agents[0].agentId, capability={name:"memory.read",version:"1.0"};
  await registerCapabilityDefinition({...capability,domain:"memory",description:"Local read",effectClass:"read",riskClass:"low",resourceType:"memory",inputSchema:{},outputSchema:{}},f.signer);
  await publishRelaySafetyPolicy({name:"memory-only",rules:[{id:"memory-read",effect:"ALLOW",match:{capability},reasonCode:"READ_ALLOWED"}]},f.signer);
  const current=await requireCurrentAgentPassport(owner.accountId,agentId,f.signer),p=current.passport;
  await issueAgentPassport({accountId:owner.accountId,ownerPrincipalId:owner.principalId,agentId,policy:{trustTier:p.trustTier,capabilityEligibility:[...p.capabilityEligibility,capability],policyReferences:[],budgetReferences:[],allowedEnvironments:p.allowedEnvironments,dataAccess:[],expiresAt:expires()}},f.signer);
  const staged=await manageMessagePolicy(owner,{operation:"stage",agentId,peers:[{ownerId:f.owners[1].accountId,agentId:f.agents[1].agentId}]},f.signer);
  await manageMessagePolicy(owner,{operation:"activate",agentId,bundleId:staged.bundleId,password},f.signer);
  const actionFor=(name:string,type:string)=>{const material={capability:{name,version:"1.0"},resource:{type,ids:["resource-1"]},parameters:{}};return {schemaVersion:"relay.action-intent.v2" as const,id:id("act"),accountId:owner.accountId,agentId,runtimeClientId:id("rtc"),taskId:id("tsk"),...material,idempotencyKey:crypto.randomUUID(),createdAt:new Date().toISOString(),canonicalHash:canonicalHash(material)}};
  const resourceResolver={resolveOwnership:async()=>({name:"resource.account_id",value:owner.accountId,authoritative:true,observedAt:new Date().toISOString(),expiresAt:expires(),sourceRevision:"1"})};
  expect(await evaluatePolicy({accountId:owner.accountId,action:actionFor("memory.read","memory"),resourceResolver},f.signer)).toMatchObject({outcome:"ALLOW"});
  expect(await evaluatePolicy({accountId:owner.accountId,action:actionFor("message.receive","federation_resource"),resourceResolver},f.signer)).toMatchObject({outcome:"DENY",reasonCodes:["MISSING_AUTHORITATIVE_FACT"]});
 });

});
