import { AdmittedSigningProvider, qualificationProviderFetch } from "./evidence/qualification-admission";
import { headers } from 'next/headers';
import { GoogleKmsEd25519Provider } from './evidence/google-kms';
import { GoogleKmsKeyWrapper, type WrappingVersion } from './evidence/google-wrapper';
import { vercelStsTokenSource, type VercelWorkloadIdentity } from './evidence/google-sts';
import { SigningKeyring, type SigningKey } from './evidence/signing-provider';

/** Public configuration only. Assertion acquisition occurs inside each incoming
 * Vercel request, never at instrumentation startup or through build/ADC tokens. */
export function qualificationCrypto(environment: Record<string,string|undefined>, assertion = async () => {
  const value=(await headers()).get('x-vercel-oidc-token');
  if(!value)throw new Error('Missing request workload identity.');
  return value;
}, request: typeof fetch = qualificationProviderFetch) {
  if(environment.RELAY_QUALIFICATION_MODE!=='true' || environment.VERCEL!=='1' || environment.VERCEL_TARGET_ENV!=='federation-qualification') throw new Error('Qualification crypto requires the dedicated hosted environment.');
  const identity=JSON.parse(environment.RELAY_QUALIFICATION_IDENTITY_JSON ?? '') as VercelWorkloadIdentity;
  if(identity.projectId!=='prj_3IRvr9knK5VJcBTgTYMvhv6ixmJK' || identity.ownerId!=='team_p8z8exJRTGfOPk1GC9vUOpv3' || identity.issuer!=='https://oidc.vercel.com/jaydubya818' || identity.subject!=='owner:jaydubya818:project:relay:environment:federation-qualification') throw new Error('Qualification identity is not the authorized Relay deployment.');
  const token=vercelStsTokenSource(identity,assertion,request);
  const keys=JSON.parse(environment.RELAY_QUALIFICATION_SIGNING_KEYS_JSON ?? '') as SigningKey[];
  const versions=JSON.parse(environment.RELAY_QUALIFICATION_WRAPPING_VERSIONS_JSON ?? '') as WrappingVersion[];
  return {keyring:new SigningKeyring(keys,new AdmittedSigningProvider(new GoogleKmsEd25519Provider(new Set(keys.map(k=>k.keyVersion)),token,request))),
    keyWrapper:new GoogleKmsKeyWrapper('fq-owner-envelope',versions,token,request)};
}
