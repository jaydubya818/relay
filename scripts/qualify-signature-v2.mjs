// Authorized v2 synthetic probe. No resource creation, retries, fallback or legacy evidence overwrite.
// gcloud credentials stay in memory; only public metadata and redacted results are written.
import {execFileSync} from 'node:child_process';
import {createHash,generateKeyPairSync,sign,verify} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const source=process.env.FQ_RELAY_SOURCE;
const load=async p=>{const m=await import(`${source}/${p}`);return m.default??m;};
const {signDelivery,verifyDelivery,MAX_FEDERATION_SIGNING_BYTES}=await load('lib/v2/federation/transport.ts');
const {deliverySignatureHeader}=await load('lib/v2/federation/signature.ts');
const {verifyEnvelope}=await import(`${process.env.FQ_MYEVE_SOURCE}/apps/eve/lib/relay/transport.ts`);
const {canonicalJson}=await load('lib/v2/contracts/index.ts');
const {submissionSchema,viewSchema}=await load('lib/v2/federation/contracts.ts');
const {GoogleKmsEd25519Provider,crc32c}=await load('lib/v2/evidence/google-kms.ts');
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
assert.equal(sha,process.env.FQ_RELAY_EXPECTED_SHA);
assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:source,encoding:'utf8'}).trim(),'');
assert.equal(MAX_FEDERATION_SIGNING_BYTES,262057);
const version='projects/relay-local-qualification/locations/us-east4/keyRings/fq-compatibility-probe/cryptoKeys/fq-ed25519-probe/cryptoKeyVersions/1';
const audience='relay://fq-owner-b/fq-agent-b',issuer='https://relay.synthetic.invalid';
const createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+600000).toISOString();
const pair=generateKeyPairSync('ed25519');
let kid='fq-delivery-v1',captured='';
const base={id:'fq-request-0001',protocol:'relay.federation',version:'1.0',caller:{ownerId:'fq-owner-a',agentId:'fq-agent-a'},target:{ownerId:'fq-owner-b',agentId:'fq-agent-b',address:audience},resource:'fq-resource',createdAt,expiresAt,idempotencyKey:'fq-request-0001',publication:null,authorizationContext:{grantId:'fq-grant',policyDecisionId:'fq-decision',localAuthorizationRequired:true}};
const fixtures=[
 {name:'representative',envelope:{...base,capability:'message.send',payload:{subject:'Qualification',body:'Synthetic federation message.'}}},
 {name:'intermediate',envelope:{...base,capability:'message.send',payload:{subject:'s'.repeat(200),body:'a'.repeat(16000),replyTo:'r'.repeat(255)}}},
 {name:'work_intermediate',envelope:{...base,capability:'work.request',payload:{category:'artifact_generation',task:'\u0001'.repeat(4000),expectedOutput:'\u0001'.repeat(1000),context:Array(10).fill('\u0001'.repeat(255)),budget:{runtimeSeconds:3600,cost:'999999.999999999',modelSteps:100,delegatedWorkers:0},deadline:expiresAt}}},
 {name:'escaped_intermediate',envelope:{...base,capability:'message.send',payload:{subject:'\u0001'.repeat(200),body:'\u0001'.repeat(16000),replyTo:'\u0001'.repeat(255)}}},
];
const materialFor=(envelope,keyId)=>`${Buffer.from(canonicalJson(deliverySignatureHeader(keyId))).toString('base64url')}.${Buffer.from(canonicalJson({iss:issuer,aud:audience,jti:base.id,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+60,envelope})).toString('base64url')}`;
// Valid bounded submission plus a valid snapshot projection. Tune only synthetic
// topic content to reach the unchanged canonical signing-input maximum exactly.
const long='\u0001'.repeat(255);
const query={mode:'RECORD_RETRIEVAL',query:'\u0001'.repeat(4000),requestedTypes:Array(30).fill(long),topics:Array(30).fill('\u0001'.repeat(100)),maxRecords:50};
function large(n,ascii){
 const entries=Array.from({length:5},(_,i)=>({reference:String(i)+long.slice(2),recordType:long,revision:long,eligibility:'OWNER_SELECTED',topics:Array.from({length:30},(_,j)=>i<4?'\u0001'.repeat(100):('\u0001'.repeat(Math.max(0,Math.min(100,n-j*100)))||'a'))}));
 if(ascii){const index=entries[4].topics.findIndex(t=>t.length+ascii<=100);if(index<0)return null;entries[4].topics[index]+='a'.repeat(ascii);}
 const document=viewSchema.parse({publisherAgentId:'fq-agent-b',name:'synthetic',description:'',topics:[],recordTypes:[long],visibility:'SHARED',allowedAudience:[],mode:'SNAPSHOT',entries,provenancePolicy:'SOURCE_REFERENCES_REQUIRED',expiresAt,expectedVersion:0});
 assert.ok(Buffer.byteLength(canonicalJson(document))<=131072);
 return {...base,capability:'knowledge.query',payload:query,publication:{viewId:base.resource,version:1,visibility:document.visibility,provenancePolicy:document.provenancePolicy,entries:document.entries}};
}
for(const targetSize of [260000,262057]){
let maximum;
for(let suffix=0;suffix<3&&!maximum;suffix++){
 const keyId='fq-delivery-v1'+'x'.repeat(suffix);let low=0,high=3000;
 while(low<=high){const mid=Math.floor((low+high)/2);if(materialFor(large(mid,0),keyId).length<=targetSize)low=mid+1;else high=mid-1;}
 for(let n=Math.max(0,high-2);n<=high;n++)for(let a=0;a<6;a++){const envelope=large(n,a);if(envelope&&materialFor(envelope,keyId).length===targetSize)maximum={name:targetSize===262057?'canonical_limit':'near_limit',envelope,keyId};}
}
assert.ok(maximum,'Exact maximum fixture unavailable');fixtures.push(maximum);
}
const verification=(pem)=>({issuer,audience,trustedPublicKey:async()=>pem,claimRequest:async()=>true});
for(const fixture of fixtures){
 const e=fixture.envelope;submissionSchema.parse({target:audience,resource:e.resource,idempotencyKey:e.idempotencyKey,expiresAt,capability:e.capability,payload:e.payload});
 assert.ok(Buffer.byteLength(canonicalJson({target:audience,resource:e.resource,idempotencyKey:e.idempotencyKey,expiresAt,capability:e.capability,payload:e.payload}))<=131072);
 const signer={keyId:fixture.keyId??kid,sign:async material=>{captured=material;return sign(null,Buffer.from(material),pair.privateKey).toString('base64url');}};
 const token=await signDelivery(e,audience,e.id,expiresAt,{signer,issuer});
 await verifyDelivery(token,verification(pair.publicKey.export({type:'spki',format:'pem'}).toString()));
 fixture.rawBytes=token.split('.').slice(0,2).join('.').length;fixture.signingBytes=Buffer.byteLength(captured);assert.ok(fixture.signingBytes<256);fixture.base64Bytes=Buffer.from(captured).toString('base64').length;fixture.localCanonicalVerification=true;
}
const report={observedAt:new Date().toISOString(),relaySha:sha,keyVersion:version,status:'NOT_RUN',federationEnabled:false,externalGates:{independentSecurity:'NOT_RUN',productionPlatform:'NOT_RUN'},cases:fixtures.map(({name,rawBytes,signingBytes,base64Bytes,localCanonicalVerification})=>({name,rawBytes,signingBytes,base64Bytes,localCanonicalVerification,kms:'NOT_RUN',relayVerification:'NOT_RUN'})),requests:[]};
if(process.argv.includes('--prepare-only')){console.log(JSON.stringify(report,null,2));process.exit(0);}
assert.equal(process.env.FQ_KMS_PROBE_AUTHORIZED,'existing-key-versioned-contract');
const token=execFileSync('gcloud',['auth','print-access-token','--account=jaydubya818@gmail.com'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const request=async(url,init={})=>{
 assert.ok(String(url).startsWith('https://cloudkms.googleapis.com/v1/'+version));
 const response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});
 const body=await response.clone().json();
 const record={method:init.method??'GET',operation:String(url).split(version)[1]||'metadata',httpStatus:response.status};
 if(!response.ok){record.code=body.error?.code;record.status=body.error?.status;const message=body.error?.message??'';record.message=message.length<=500&&!message.includes(token)?message:'Provider message omitted';}
 report.requests.push(record);return response;
};
const pubResponse=await request(`https://cloudkms.googleapis.com/v1/${version}/publicKey`,{headers:{authorization:`Bearer ${token}`}});assert.ok(pubResponse.ok);const pub=await pubResponse.json();
assert.equal(pub.name,version);assert.equal(pub.algorithm,'EC_SIGN_ED25519');assert.equal(pub.protectionLevel,'SOFTWARE');assert.equal(String(crc32c(Buffer.from(pub.pem))),String(pub.pemCrc32c));
report.publicKey={algorithm:pub.algorithm,protectionLevel:pub.protectionLevel,pem:pub.pem,sha256:createHash('sha256').update(pub.pem).digest('hex'),crcVerified:true};
const provider=new GoogleKmsEd25519Provider(new Set([version]),async()=>token,request);
for(let i=0;i<fixtures.length;i++){
 const fixture=fixtures[i],result=report.cases[i];let providerSignature;
 const signer={keyId:fixture.keyId??kid,sign:async material=>{captured=material;assert.equal(Buffer.byteLength(material),fixture.signingBytes);providerSignature=await provider.sign({keyId:fixture.keyId??kid,keyVersion:version,purpose:'federation-delivery',algorithm:'Ed25519',publicKeyPem:pub.pem,state:'ACTIVE',activatedAt:'2020-01-01T00:00:00Z'},Buffer.from(material));return Buffer.from(providerSignature).toString('base64url');}};
 try{
  const signed=await signDelivery(fixture.envelope,audience,base.id,expiresAt,{signer,issuer});
  result.kms='SUCCESS';result.signatureBytes=providerSignature.length;result.crcVerified=true;result.publicKeyVerified=verify(null,Buffer.from(captured),pub.pem,providerSignature);assert.ok(result.publicKeyVerified);
  const verifyOptions={...verification(pub.pem),trustedPublicKey:async id=>id===(fixture.keyId??kid)?pub.pem:undefined};
  await verifyDelivery(signed,verifyOptions);result.relayVerification='PASS';
  verifyEnvelope(signed,{issuer,address:audience,ownerId:'fq-owner-b',agentId:'fq-agent-b',keyId:fixture.keyId??kid,publicKey:pub.pem});result.myEveVerification='PASS';
  result.mutationRejections={};
  for(const attack of ['payload-bit','purpose','version','key-id']){
   const parts=signed.split('.');
   if(attack==='payload-bit'){const bytes=Buffer.from(parts[1],'base64url');const pos=bytes.indexOf(Buffer.from('fq-owner-a'));assert.ok(pos>=0);bytes[pos]^=1;parts[1]=bytes.toString('base64url');}
   else{const header=JSON.parse(Buffer.from(parts[0],'base64url').toString());if(attack==='purpose')header.purpose='passport';if(attack==='version')header.v=3;if(attack==='key-id')header.kid='wrong-version-id';parts[0]=Buffer.from(canonicalJson(header)).toString('base64url');}
   await assert.rejects(()=>verifyDelivery(parts.join('.'),verifyOptions));
   assert.throws(()=>verifyEnvelope(parts.join('.'),{issuer,address:audience,ownerId:'fq-owner-b',agentId:'fq-agent-b',keyId:fixture.keyId??kid,publicKey:pub.pem}));
   result.mutationRejections[attack]='DENY_BOTH_VERIFIERS';
  }
  result.protocol='Relay-Ed25519-SHA256-v2';result.signedInputSha256=createHash('sha256').update(captured).digest('hex');result.tokenBytes=signed.length;
 }catch{result.kms=result.kms==='SUCCESS'?'SUCCESS':'FAILED';report.status='FAILED';report.stopReason='First KMS or canonical verification failure; no smaller payload substitution or retry.';break;}
}
if(report.status!=='FAILED')report.status='PASSED_LIVE';
writeFileSync(process.env.FQ_KMS_EVIDENCE_OUTPUT,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,cases:report.cases,requests:report.requests},null,2));
if(report.status!=='PASSED_LIVE')process.exitCode=1;
