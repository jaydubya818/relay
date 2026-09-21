import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,verify} from 'node:crypto';
import {writeFileSync,existsSync} from 'node:fs';
const source='/private/tmp/relay-kms-probe-20260920';
const load=async p=>{const m=await import(`${source}/${p}`);return m.default??m;};
const {signDelivery,verifyDelivery,MAX_FEDERATION_TOKEN_CHARS}=await load('lib/v2/federation/transport.ts');
const {GoogleKmsEd25519Provider,crc32c}=await load('lib/v2/evidence/google-kms.ts');
const {SigningKeyring}=await load('lib/v2/evidence/signing-provider.ts');
const {canonicalJson}=await load('lib/v2/contracts/index.ts');
const {federationSigningEnvelope}=await load('lib/v2/federation/signing-envelope.ts');
const {envelopeV2Fixtures,qualificationIssuer:issuer,qualificationAudience:audience,qualificationKeyVersion:version}=await load('scripts/production-qualification/envelope-v2-fixtures.ts');
const expected='68c8d8c92b65f7acfd6993e1714f0d1c1204f6b2';
const git=(...args)=>execFileSync('git',args,{cwd:source,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
assert.equal(git('rev-parse','HEAD'),expected);assert.equal(git('branch','--show-current'),'codex/relay-signing-envelope-v2');assert.equal(git('status','--porcelain'),'');
assert.equal(MAX_FEDERATION_TOKEN_CHARS,262144);
const fixtures=envelopeV2Fixtures(new Date()).filter(f=>[1291,132893,260000,262057].includes(f.materialBytes));
assert.deepEqual(fixtures.map(f=>f.materialBytes),[1291,132893,260000,262057]);
if(process.argv.includes('--prepare-only')){console.log(JSON.stringify({source:expected,cases:fixtures.map(f=>f.materialBytes),liveCalls:0}));process.exit(0);}
assert.equal(git('ls-remote','origin','refs/heads/codex/relay-signing-envelope-v2').split(/\s/)[0],expected);
const output='/private/tmp/relay-v2-live-results.json';assert.equal(existsSync(output),false,'Evidence already exists; no repeated live run');
const report={observedAt:new Date().toISOString(),source:{branch:'codex/relay-signing-envelope-v2',head:expected,remoteHead:expected,worktree:'CLEAN'},keyVersion:version,algorithm:'EC_SIGN_ED25519',protection:'SOFTWARE',status:'NOT_RUN',requests:[],cases:[],operations:{signing:0,metadata:0,publicKey:0,retries:0,newResources:0},tokenContract:262144,federation:'DISABLED',authorityChanges:false,productionOperations:0,independentSecurityReview:'NOT_RUN',productionPlatformQualification:'NOT_RUN',actualOperationCost:'UNAVAILABLE',estimatedOperationCostUSD:0.000015,credentialPrinted:false,credentialPersisted:false};
const save=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});save();
let bearer;let current;let expectedInput;
const urlBase=`https://cloudkms.googleapis.com/v1/${version}`;
const request=async(url,init={})=>{
 const suffix=String(url).slice(urlBase.length);assert.equal(String(url),urlBase+suffix);assert.ok(['','/publicKey',':asymmetricSign'].includes(suffix));
 const op=suffix==='/publicKey'?'publicKey':suffix===':asymmetricSign'?'signing':'metadata';
 assert.ok(report.operations[op]<(op==='publicKey'?1:4));assert.equal(init.method??'GET',op==='signing'?'POST':'GET');
 if(op==='signing'){const body=JSON.parse(init.body);assert.deepEqual(Object.keys(body).sort(),['data','dataCrc32c']);const data=Buffer.from(body.data,'base64');assert.ok(data.equals(expectedInput));assert.equal(String(crc32c(data)),body.dataCrc32c);current.kmsInputBytes=data.length;current.requestCrc32c='PASS';}
 report.operations[op]++;const entry={operation:op,caseBytes:current?.payloadBytes??null,httpStatus:null};report.requests.push(entry);save();
 const response=await fetch(url,{...init,redirect:'error'});entry.httpStatus=response.status;const body=await response.clone().json();
 if(response.ok&&op==='metadata'){assert.equal(body.name,version);assert.equal(body.algorithm,'EC_SIGN_ED25519');assert.equal(body.protectionLevel,'SOFTWARE');assert.equal(body.state,'ENABLED');current.metadata='PASS';}
 if(response.ok&&op==='signing'){assert.equal(body.name,version);assert.equal(body.protectionLevel,'SOFTWARE');assert.equal(body.verifiedDataCrc32c,true);assert.equal(String(crc32c(Buffer.from(body.signature,'base64'))),String(body.signatureCrc32c));current.responseCrc32c='PASS';current.googleApiAcceptance='PASS';current.returnedVersion=body.name;}
 if(!response.ok)entry.errorStatus=typeof body.error?.status==='string'?body.error.status:'OMITTED';save();return response;
};
try{
 bearer=execFileSync('/opt/homebrew/bin/gcloud',['auth','print-access-token','--account=jaydubya818@gmail.com'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();assert.ok(bearer&&!/\s/.test(bearer));
 const response=await request(urlBase+'/publicKey',{headers:{Authorization:`Bearer ${bearer}`},signal:AbortSignal.timeout(15000)});assert.ok(response.ok);const pub=await response.json();
 assert.equal(pub.name,version);assert.equal(pub.algorithm,'EC_SIGN_ED25519');assert.equal(pub.protectionLevel,'SOFTWARE');assert.equal(String(crc32c(Buffer.from(pub.pem))),String(pub.pemCrc32c));
 const fingerprint=createHash('sha256').update(pub.pem).digest('hex');assert.equal(fingerprint,'00daeee3bee0076681d1cd1927fa2a2d30786320e8e344341b0c981b976517e4');
 report.publicKey={name:pub.name,pem:pub.pem,sha256:fingerprint,crc32c:'PASS',algorithm:pub.algorithm,protection:pub.protectionLevel};save();
 const provider=new GoogleKmsEd25519Provider(new Set([version]),async()=>bearer,request);
 for(const f of fixtures){
  current={payloadBytes:f.materialBytes,payloadDigestAlgorithm:'SHA-256',envelopeVersion:2,keyId:f.keyId,keyVersion:version,status:'NOT_RUN'};report.cases.push(current);save();
  const key={keyId:f.keyId,keyVersion:version,purpose:'federation-delivery',algorithm:'Ed25519',publicKeyPem:pub.pem,state:'ACTIVE',activatedAt:'2020-01-01T00:00:00Z'};
  const wrapper={async sign(k,material){expectedInput=Buffer.from(material);current.envelopeBytes=material.length;assert.ok(material.length===406||material.length===407);const env=JSON.parse(expectedInput.toString());assert.equal(canonicalJson(env),expectedInput.toString());assert.equal(env.protocol,'relay.federation');assert.equal(env.version,2);assert.equal(env.purpose,'federation-delivery');assert.equal(env.signingAlgorithm,'Ed25519');current.payloadDigest=env.payloadDigest;return provider.sign(k,material);}};
  const signer=new SigningKeyring([key],wrapper).signer('federation-delivery');
  const signed=await signDelivery(f.envelope,audience,String(f.envelope.id),String(f.envelope.expiresAt),{signer,issuer});
  const parts=signed.split('.'),material=parts.slice(0,2).join('.'),signature=Buffer.from(parts[2],'base64url');assert.equal(material.length,f.materialBytes);assert.equal(signature.length,64);assert.equal(signed.length,f.materialBytes+87);assert.ok(signed.length<=262144);
  assert.equal(federationSigningEnvelope(material,{id:f.keyId,version}),expectedInput.toString());assert.equal(createHash('sha256').update(material).digest('hex'),current.payloadDigest);
  assert.ok(verify(null,expectedInput,pub.pem,signature));current.signatureBytes=signature.length;current.publicKeyVerification='PASS';current.rawInputSemantics='PASS';current.tokenCharacters=signed.length;
  const options={issuer,audience,trustedPublicKey:async(id,v)=>id===f.keyId&&v===version?pub.pem:undefined,claimRequest:async()=>true};
  await verifyDelivery(signed,options);current.relayV2Verification='PASS';
  const claims=JSON.parse(Buffer.from(parts[1],'base64url'));if(claims.envelope.payload.body!==undefined)claims.envelope.payload.body='X'+claims.envelope.payload.body.slice(1);else claims.envelope.payload.query='X'+claims.envelope.payload.query.slice(1);
  const changed=Buffer.from(canonicalJson(claims)).toString('base64url');let claimsCalled=false;
  await assert.rejects(()=>verifyDelivery(`${parts[0]}.${changed}.${parts[2]}`,{...options,claimRequest:async()=>{claimsCalled=true;return true;}}),/Invalid Relay signature/);assert.equal(claimsCalled,false);current.tamperRejection='PASS';current.status='PASS';save();
 }
 assert.equal(git('rev-parse','HEAD'),expected);assert.equal(git('status','--porcelain'),'');
 report.status='KMS COMPATIBILITY QUALIFIED';report.sourceAfterProbe='UNCHANGED_CLEAN';
}catch{report.status='KMS COMPATIBILITY FAILED';if(current)current.status='FAIL';report.stopReason='First provider or cryptographic assertion failure. No retry; remaining cases not run.';process.exitCode=1;}
finally{bearer=undefined;save();console.log(JSON.stringify(report,null,2));}
