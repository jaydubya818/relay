import { expect, it, vi } from 'vitest';
import { createLocalEd25519Signer } from '@/lib/v2/evidence/crypto';
import { submissionSchema, viewSchema } from '@/lib/v2/federation/contracts';
import { canonicalJson } from '@/lib/v2/contracts';
import { signDelivery, verifyDelivery, MAX_FEDERATION_SIGNING_BYTES, MAX_FEDERATION_TOKEN_CHARS } from '@/lib/v2/federation/transport';
import { federationV2Header } from '@/lib/v2/federation/signing-envelope';
const audience='relay://owner-b/agent-b';
function fixture(){
 const createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+60000).toISOString();
 return {id:'request-0001',protocol:'relay.federation',version:'1.0',caller:{ownerId:'owner-a',agentId:'agent-a'},target:{ownerId:'owner-b',agentId:'agent-b',address:audience},capability:'knowledge.query',resource:'view',createdAt,expiresAt,idempotencyKey:'request-0001',payload:{mode:'RECORD_RETRIEVAL',query:'Synthetic',requestedTypes:['note'],topics:[],maxRecords:50},publication:{entries:[] as unknown[],padding:''},authorizationContext:{grantId:'grant',policyDecisionId:'decision',localAuthorizationRequired:true}};
}
async function run(envelope:ReturnType<typeof fixture>,keyId='delivery-v1'){
 const local=createLocalEd25519Signer(keyId);const sign=vi.fn(local.sign.bind(local));
 const bindings={signer:{...local,sign},issuer:'https://relay.synthetic.invalid',keyWrapper:{keyId:'unused',wrap:vi.fn(),unwrap:vi.fn()}};
 const token=await signDelivery(envelope,audience,envelope.id,envelope.expiresAt,bindings);
 await verifyDelivery(token,{issuer:bindings.issuer,audience,trustedPublicKey:async()=>local.publicKeyPem(),claimRequest:async()=>true});
 return {token,sign};
}
it('signs and verifies safely below the canonical limit',async()=>{expect((await run(fixture())).token.length).toBeLessThan(MAX_FEDERATION_TOKEN_CHARS);});
it('accepts the exact maximum and rejects one signing character beyond before signing',async()=>{
 const e=fixture();let exact:{envelope:typeof e,keyId:string}|undefined;
 for(let k=1;k<=4;k++){
  const keyId='k'.repeat(k),header=Buffer.from(canonicalJson(federationV2Header(keyId,keyId))).toString('base64url');
  const length=(n:number)=>{e.publication.padding='x'.repeat(n);return header.length+1+Buffer.from(canonicalJson({iss:'https://relay.synthetic.invalid',aud:audience,jti:e.id,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60,envelope:e})).toString('base64url').length;};
  let n=Math.floor(MAX_FEDERATION_SIGNING_BYTES*3/4)-1000;while(length(n)<MAX_FEDERATION_SIGNING_BYTES)n++;
  if(length(n)===MAX_FEDERATION_SIGNING_BYTES){exact={envelope:structuredClone(e),keyId};break;}
 }
 expect(exact).toBeDefined();const {token}=await run(exact!.envelope,exact!.keyId);expect(token.length).toBe(MAX_FEDERATION_TOKEN_CHARS);
 const local=createLocalEd25519Signer(exact!.keyId);const sign=vi.fn(local.sign.bind(local));
 const beyond=structuredClone(exact!.envelope);
 let found=false;
 for(let k=1;k<=4&&!found;k++)for(let delta=-4;delta<=4&&!found;delta++){
  Object.assign(local,{keyId:'k'.repeat(k),keyVersion:'k'.repeat(k)});
  beyond.publication.padding='x'.repeat(exact!.envelope.publication.padding.length+delta);
  const header=Buffer.from(canonicalJson(federationV2Header(local.keyId,local.keyVersion!))).toString('base64url');
  const length=header.length+1+Buffer.from(canonicalJson({iss:'https://relay.synthetic.invalid',aud:audience,jti:beyond.id,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60,envelope:beyond})).toString('base64url').length;
  found=length===MAX_FEDERATION_SIGNING_BYTES+1;
 }
 expect(found).toBe(true);
 await expect(signDelivery(beyond,audience,beyond.id,beyond.expiresAt,{signer:{...local,sign},issuer:'https://relay.synthetic.invalid',keyWrapper:{keyId:'unused',wrap:vi.fn(),unwrap:vi.fn()}})).rejects.toMatchObject({status:413});expect(sign).not.toHaveBeenCalled();
});
it.each(['plain','escaped'])('rejects aggregate multi-record projection expansion (%s) before signing',async(kind)=>{
 const e=fixture();e.publication.entries=Array.from({length:50},(_,i)=>({reference:`r${i}`,recordType:'note',revision:'v1',eligibility:'OWNER_SELECTED',topics:Array(30).fill((kind==='escaped'?'\u0000':'x').repeat(100))}));
 const local=createLocalEd25519Signer();const sign=vi.fn(local.sign.bind(local));
 // Plain records add enough references across the aggregate to cross the bound.
 if(kind==='plain')e.publication.entries=e.publication.entries.concat(e.publication.entries);
 await expect(signDelivery(e,audience,e.id,e.expiresAt,{signer:{...local,sign},issuer:'https://relay.synthetic.invalid',keyWrapper:{keyId:'unused',wrap:vi.fn(),unwrap:vi.fn()}})).rejects.toThrow('canonical 256 KiB');expect(sign).not.toHaveBeenCalled();
});

it('rejects a schema-valid knowledge join even when both inputs fit their HTTP bounds',async()=>{
 const e=fixture(),long='\u0000'.repeat(255),topic='\u0000'.repeat(100);
 const query=submissionSchema.parse({target:audience,resource:'view',idempotencyKey:e.id,expiresAt:e.expiresAt,capability:'knowledge.query',payload:{mode:'RECORD_RETRIEVAL',query:'\u0000'.repeat(4000),requestedTypes:Array(30).fill(long),topics:Array(30).fill(topic),maxRecords:50}});
 const entries=[];let document;
 for(let i=0;i<50;i++){
  entries.push({reference:`${i}`+long.slice(2),recordType:long,revision:long,eligibility:'OWNER_SELECTED',topics:Array(30).fill(topic)});
  const candidate={publisherAgentId:'agent-b',name:'synthetic',description:'',topics:[],recordTypes:[long],visibility:'SHARED',allowedAudience:[],mode:'SNAPSHOT',entries:[...entries],provenancePolicy:'SOURCE_REFERENCES_REQUIRED',expiresAt:e.expiresAt,expectedVersion:0};
  if(Buffer.byteLength(canonicalJson(candidate))>128*1024)break;
  document=viewSchema.parse(candidate);
 }
 expect(document).toBeDefined();expect(Buffer.byteLength(canonicalJson(query))).toBeLessThanOrEqual(128*1024);expect(Buffer.byteLength(canonicalJson(document))).toBeLessThanOrEqual(128*1024);
 const local=createLocalEd25519Signer(),sign=vi.fn(local.sign.bind(local));
 await expect(signDelivery({...e,payload:query.payload,publication:{viewId:'view',version:1,entries:document!.entries}},audience,e.id,e.expiresAt,{signer:{...local,sign},issuer:'https://relay.synthetic.invalid',keyWrapper:{keyId:'unused',wrap:vi.fn(),unwrap:vi.fn()}})).rejects.toMatchObject({status:413});expect(sign).not.toHaveBeenCalled();
});
