/** Local-only checkpoint. Uses disposable Ed25519 keys and never calls a provider. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createLocalEd25519Signer } from '../../lib/v2/evidence/crypto';
import { signDelivery, verifyDelivery } from '../../lib/v2/federation/transport';
import { envelopeV2Fixtures, qualificationAudience, qualificationIssuer, qualificationKeyVersion } from './envelope-v2-fixtures';
async function main() {
  const cases=[];
  for(const fixture of envelopeV2Fixtures(new Date())) {
    const reference=createLocalEd25519Signer(fixture.keyId);let providerInput='';
    const signer={...reference,keyVersion:qualificationKeyVersion,async sign(material:string){providerInput=material;return reference.sign(material);}};
    const token=await signDelivery(fixture.envelope,qualificationAudience,String(fixture.envelope.id),String(fixture.envelope.expiresAt),{signer,issuer:qualificationIssuer,keyWrapper:{keyId:'unused',wrap:async()=>{throw Error('Unused');},unwrap:async()=>{throw Error('Unused');}}});
    const key=await reference.publicKeyPem();
    const options={issuer:qualificationIssuer,audience:qualificationAudience,trustedPublicKey:async(id:string,version?:string)=>id===fixture.keyId&&version===qualificationKeyVersion?key:undefined,claimRequest:async()=>true};
    await verifyDelivery(token,options);
    assert.equal(token.length,fixture.materialBytes+87);
    assert.ok(Buffer.byteLength(providerInput)<1024);
    const signature=token.split('.')[2];assert.equal(Buffer.from(signature,'base64url').length,64);
    cases.push({name:fixture.name,authenticatedMaterialBytes:fixture.materialBytes,tokenCharacters:token.length,digestBytes:32,canonicalEnvelopeBytes:Buffer.byteLength(providerInput),signatureBytes:64,localSigner:'PASS',canonicalVerifier:'PASS'});
  }
  const beyond=envelopeV2Fixtures(new Date(),[262058]).at(-1)!;let calls=0;
  const ref=createLocalEd25519Signer(beyond.keyId);
  await assert.rejects(()=>signDelivery(beyond.envelope,qualificationAudience,String(beyond.envelope.id),String(beyond.envelope.expiresAt),{signer:{...ref,keyVersion:qualificationKeyVersion,sign:async()=>{calls++;throw Error('Must not sign');}},issuer:qualificationIssuer,keyWrapper:{keyId:'unused',wrap:async()=>'',unwrap:async()=>Buffer.alloc(0)}}),{status:413});
  assert.equal(calls,0);
  const report={status:'LOCAL_QUALIFIED_LIVE_NOT_RUN',protocolTokenCharacters:262144,cases,maximumPlusOne:{tokenCharacters:262145,result:'REJECT',providerCalls:calls},kmsOperations:0,cloudResourcesCreated:0,federation:'DISABLED',independentSecurityReview:'NOT_RUN',productionPlatformQualification:'NOT_RUN'};
  if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}
main().catch(()=>{console.error('Local signing-envelope qualification failed.');process.exitCode=1;});
