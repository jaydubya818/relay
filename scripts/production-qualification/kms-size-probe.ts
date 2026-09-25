/** Operator-only existing-resource probe. Creates no resources. Never emits
 * credentials, request contents, provider error bodies or private material. */
import {verify} from 'node:crypto';
import {GoogleKmsEd25519Provider} from '../../lib/v2/evidence/google-kms';
import {MAX_FEDERATION_SIGNING_BYTES} from '../../lib/v2/federation/transport';
import type {SigningKey} from '../../lib/v2/evidence/signing-provider';
async function main(){
 const authorization=process.env.FQ_KMS_EXISTING_RESOURCE_AUTHORIZATION;
 if(!authorization||!/^[A-Za-z0-9_-]{8,120}$/.test(authorization))throw Error('EXISTING_RESOURCE_AUTHORIZATION_REQUIRED');
 const version=process.env.FQ_KMS_KEY_VERSION??'',publicKeyPem=process.env.FQ_KMS_PUBLIC_KEY_PEM??'';
 const key:SigningKey={keyId:'fq-size-probe',keyVersion:version,purpose:'federation-delivery',algorithm:'Ed25519',publicKeyPem,state:'ACTIVE',activatedAt:'2020-01-01T00:00:00Z'};
 const provider=new GoogleKmsEd25519Provider(new Set([version]),async()=>{const token=process.env.FQ_KMS_ACCESS_TOKEN;if(!token)throw Error();return token;});
 const material=Buffer.alloc(MAX_FEDERATION_SIGNING_BYTES,0x61);
 const result={rawInputBytes:material.length,base64TransportBytes:material.toString('base64').length,apiResult:'NOT_RUN',signatureBytes:0,crcVerified:false,pinnedPublicKeyVerified:false};
 try{const signature=await provider.sign(key,material);result.apiResult='SUCCESS';result.signatureBytes=signature.length;result.crcVerified=true;result.pinnedPublicKeyVerified=verify(null,material,publicKeyPem,signature);if(!result.pinnedPublicKeyVerified)process.exitCode=1;}catch{result.apiResult='UNCONFIRMED_PROVIDER_FAILURE';process.exitCode=1;}
 console.log(JSON.stringify(result,null,2));
}
main().catch(()=>{console.error('KMS compatibility probe configuration is unavailable.');process.exitCode=1;});
