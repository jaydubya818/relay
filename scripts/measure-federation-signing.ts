/** No network or private production material. Exact production signing/verifier. */
import { generateKeyPairSync, sign } from 'node:crypto';
import { signDelivery, verifyDelivery } from '../lib/v2/federation/transport';
import { canonicalHash, canonicalJson } from '../lib/v2/contracts';
import { submissionSchema, viewSchema } from '../lib/v2/federation/contracts';
const pair=generateKeyPairSync('ed25519');
let signedBytes=0;
const signer={keyId:'fq-delivery-v1',async sign(material:string){signedBytes=Buffer.byteLength(material);return sign(null,Buffer.from(material),pair.privateKey).toString('base64url');},async verify(){return true;},async publicKeyPem(){return pair.publicKey.export({type:'spki',format:'pem'}).toString();}};
const target='relay://fq-owner-b/fq-agent-b',createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+60000).toISOString();
const bindings={signer,issuer:'https://relay.synthetic.invalid',keyWrapper:{keyId:'unused',async wrap(){throw Error('unused');},async unwrap(){throw Error('unused');}}};
const base={target,resource:'fq-resource',idempotencyKey:'fq-request-0001',expiresAt};
const cases=[
 {name:'message_representative',capability:'message.send',payload:{subject:'Qualification',body:'Synthetic federation message.'}},
 {name:'message_max_ascii_body',capability:'message.send',payload:{subject:'s'.repeat(200),body:'a'.repeat(16000),replyTo:'r'.repeat(255)}},
 {name:'message_max_json_escaped_fields',capability:'message.send',payload:{subject:'\u0000'.repeat(200),body:'\u0000'.repeat(16000),replyTo:'\u0000'.repeat(255)}},
 {name:'work_max_json_escaped_payload',capability:'work.request',payload:{category:'artifact_generation',task:'\u0000'.repeat(4000),expectedOutput:'\u0000'.repeat(1000),context:Array(10).fill('\u0000'.repeat(255)),budget:{runtimeSeconds:3600,cost:'999999.999999999',modelSteps:100,delegatedWorkers:0},deadline:expiresAt}},
 {name:'artifact_64KiB_metadata_only',capability:'artifact.share',payload:{reference:'fq-artifact',name:'synthetic.txt',type:'text/plain',size:65536,checksum:`sha256:${'a'.repeat(64)}`,visibility:'SHARED',expiresAt,retrieval:{url:'https://peer.synthetic.invalid/artifact',audience:'fq-owner-a',expiresAt}}},
 {name:'knowledge_representative',capability:'knowledge.query',payload:{mode:'RECORD_RETRIEVAL',query:'Synthetic record',requestedTypes:['note'],topics:[],maxRecords:1}},
];
async function main(){
 const measured=[];
 for(const entry of cases){
  const submission=submissionSchema.parse({...base,capability:entry.capability,payload:entry.payload});
  const envelope={id:base.idempotencyKey,protocol:'relay.federation',version:'1.0',caller:{ownerId:'fq-owner-a',agentId:'fq-agent-a'},target:{ownerId:'fq-owner-b',agentId:'fq-agent-b',address:target},capability:entry.capability,resource:base.resource,createdAt,expiresAt,idempotencyKey:base.idempotencyKey,payload:submission.payload,publication:null,authorizationContext:{grantId:'fq-grant',policyDecisionId:'fq-decision',localAuthorizationRequired:true}};
  const token=await signDelivery(envelope,target,base.idempotencyKey,expiresAt,bindings);
  await verifyDelivery(token,{issuer:bindings.issuer,audience:target,trustedPublicKey:async()=>signer.publicKeyPem(),claimRequest:async()=>true});
  measured.push({name:entry.name,submissionBytes:Buffer.byteLength(canonicalJson(submission)),signingInputBytes:signedBytes,tokenBytes:token.length,verified:true});
 }
 // Both API inputs fit the existing 128 KiB request cap. Their joined envelope
 // can nevertheless exceed the existing 256 KiB verifier limit. Do not shrink it.
 const long='\u0000'.repeat(255),topic='\u0000'.repeat(100);
 const query=submissionSchema.parse({...base,capability:'knowledge.query',payload:{mode:'RECORD_RETRIEVAL',query:'\u0000'.repeat(4000),requestedTypes:[long,...Array(29).fill(long)],topics:Array(30).fill(topic),maxRecords:50}});
 const entries=[];let document;
 for(let i=0;i<50;i++){
  entries.push({reference:`${i}`+long.slice(2),recordType:long,revision:long,eligibility:'OWNER_SELECTED',topics:Array(30).fill(topic)});
  const candidate={publisherAgentId:'fq-agent-b',name:'synthetic',description:'',topics:[],recordTypes:[long],visibility:'SHARED',allowedAudience:[],mode:'SNAPSHOT',entries:[...entries],provenancePolicy:'SOURCE_REFERENCES_REQUIRED',expiresAt,expectedVersion:0};
  if(Buffer.byteLength(canonicalJson(candidate))>128*1024)break;
  document=viewSchema.parse(candidate);
 }
 if(!document)throw Error('fixture');
 const projection={viewId:base.resource,version:1,visibility:document.visibility,provenancePolicy:document.provenancePolicy,entries:document.entries};
 const envelope={id:base.idempotencyKey,protocol:'relay.federation',version:'1.0',caller:{ownerId:'fq-owner-a',agentId:'fq-agent-a'},target:{ownerId:'fq-owner-b',agentId:'fq-agent-b',address:target},capability:'knowledge.query',resource:base.resource,createdAt,expiresAt,idempotencyKey:base.idempotencyKey,payload:query.payload,publication:projection,authorizationContext:{grantId:'fq-grant',policyDecisionId:'fq-decision',localAuthorizationRequired:true}};
 const material = `${Buffer.from(canonicalJson({alg:'EdDSA',typ:'relay-federation+jwt',kid:signer.keyId})).toString('base64url')}.${Buffer.from(canonicalJson({iss:bindings.issuer,aud:target,jti:base.idempotencyKey,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.parse(expiresAt)/1000),envelope})).toString('base64url')}`;
 signedBytes=0;
 let outcome='UNEXPECTED_ACCEPT';try{await signDelivery(envelope,target,base.idempotencyKey,expiresAt,bindings);}catch{outcome='REJECTED_BEFORE_SIGNING';}
 if(outcome!=='REJECTED_BEFORE_SIGNING'||signedBytes!==0)throw Error('Oversized producer regression');
 measured.push({name:'knowledge_join_of_individually_bounded_inputs',submissionBytes:Buffer.byteLength(canonicalJson(query)),publicationBytes:Buffer.byteLength(canonicalJson(document)),entries:document.entries.length,wouldBeSigningInputBytes:Buffer.byteLength(material),wouldBeTokenBytes:material.length+87,signerInvoked:false,outcome});
 console.log(JSON.stringify({mode:'local_exact_serialization_no_provider_call',measured,receiptHashBytes:Buffer.byteLength(canonicalHash({synthetic:'receipt'})),exportManifestHashBytes:Buffer.byteLength(canonicalHash({synthetic:"manifest"})),passportHashBytes:Buffer.byteLength(canonicalHash({synthetic:"passport"})),maxVerifierAcceptedSigningInputBytes:256*1024-87,signatureBytes:64,signatureBase64urlBytes:86,note:'Artifact content is not included in the signed delivery. All sizes use synthetic inputs; not a live KMS size attestation.'},null,2));
}
void main();
