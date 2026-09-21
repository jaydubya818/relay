import { federationSigningEnvelope } from '@/lib/v2/federation/signing-envelope';
import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SigningKeyring, purposeSigner, type SigningKey, type SigningPurpose } from "@/lib/v2/evidence/signing-provider";
import { GoogleKmsEd25519Provider, crc32c } from "@/lib/v2/evidence/google-kms";
import { createLocalEd25519Signer } from "@/lib/v2/evidence/crypto";
import { signDelivery, verifyDelivery } from "@/lib/v2/federation/transport";
import { canonicalHash } from "@/lib/v2/contracts";
import { submissionSchema } from "@/lib/v2/federation/contracts";

function fixture(purpose: SigningPurpose = "evidence", keyId = `${purpose}-v1`) {
 const pair=generateKeyPairSync("ed25519");
 const key: SigningKey={keyId,keyVersion:`projects/synthetic-project/locations/us-west1/keyRings/fq/cryptoKeys/${keyId}/cryptoKeyVersions/1`,purpose,algorithm:"Ed25519",publicKeyPem:pair.publicKey.export({type:"spki",format:"pem"}).toString(),state:"ACTIVE",activatedAt:"2026-01-01T00:00:00Z"};
 return {pair,key};
}
afterEach(()=>vi.unstubAllEnvs());
describe("purpose-specific signing and lifecycle",()=>{
 it("uses only the active version and retains historical public verification",async()=>{
  const old=fixture(),current=fixture("evidence","evidence-v2");old.key.state="RETIRED";old.key.retiredAt="2026-06-01T00:00:00Z";
  const used:string[]=[];const ring=new SigningKeyring([old.key,current.key],{async sign(key,data){used.push(key.keyId);return sign(null,data,current.pair.privateKey);}},()=>Date.parse("2026-09-20T00:00:00Z"));
  const material=canonicalHash({receipt:"synthetic"});
  expect(await ring.signer("evidence").sign(material)).toHaveLength(86);expect(used).toEqual([current.key.keyId]);
  expect(ring.verificationKey(old.key.keyId,"evidence","2026-05-01T00:00:00Z")).toBeDefined();
  expect(ring.verificationKey(old.key.keyId,"evidence","2026-07-01T00:00:00Z")).toBeUndefined();
  expect(ring.signer("evidence").verificationKeys?.()).toHaveLength(2);
 });
 it.each(["RETIRED","DISABLED","REVOKED"] as const)("never signs with %s key",state=>{
  const {key}=fixture();key.state=state;if(state==="REVOKED")key.revokedAt="2026-08-01T00:00:00Z";const ring=new SigningKeyring([key],{sign:vi.fn()});expect(()=>ring.signer("evidence")).toThrow();
  expect(Boolean(ring.verificationKey(key.keyId,"evidence"))).toBe(state!=="REVOKED");
 });
 it("rejects unknown and wrong-purpose keys",()=>{
  const {key}=fixture();const ring=new SigningKeyring([key],{sign:vi.fn()});expect(ring.verificationKey("missing","evidence")).toBeUndefined();expect(ring.verificationKey(key.keyId,"passport")).toBeUndefined();expect(()=>ring.signer("lease")).toThrow();
 });
 it("rejects algorithm mismatch, duplicate active keys and cross-purpose key reuse",()=>{
  const {key}=fixture();expect(()=>new SigningKeyring([{...key,algorithm:"ES256" as "Ed25519"}],{sign:vi.fn()})).toThrow();
  expect(()=>new SigningKeyring([key,fixture("evidence","another").key],{sign:vi.fn()})).toThrow();
  expect(()=>new SigningKeyring([key,{...key,keyId:"passport",keyVersion:key.keyVersion.replace("evidence","passport"),purpose:"passport"}],{sign:vi.fn()})).toThrow();
 });
 it("rejects provider failures or wrong-key signatures without fallback",async()=>{
  const {key}=fixture();const other=fixture();for(const provider of [{async sign(){throw Error("private diagnostic");}},{async sign(){return sign(null,Buffer.from("x"),other.pair.privateKey);}}])await expect(new SigningKeyring([key],provider).signer("evidence").sign("x")).rejects.toThrow("unavailable");
 });
 it("refuses an unscoped production signer; explicit non-production behavior remains",()=>{
  const local=createLocalEd25519Signer();expect(purposeSigner(local,"passport")).toBe(local);vi.stubEnv("NODE_ENV","production");expect(()=>purposeSigner(local,"passport")).toThrow();
 });
});

describe("Google KMS raw Ed25519 provider contract (local, not a live provider attestation)",()=>{
 it("matches CRC32C standard vector",()=>expect(crc32c(Buffer.from("123456789"))).toBe(0xe3069283));
 it.each([71,4096,65536,196608,262057,270431])("preserves all %i raw message bytes and verifies unchanged Ed25519",async(size)=>{
  const {pair,key}=fixture();const material="a".repeat(size);let seen:Buffer|undefined;
  const request=vi.fn(async(_url,options)=>{
   if(options?.method!=="POST")return Response.json({name:key.keyVersion,state:"ENABLED",algorithm:"EC_SIGN_ED25519",protectionLevel:"SOFTWARE"});
   const body=JSON.parse(String(options.body));expect(body.digest).toBeUndefined();seen=Buffer.from(body.data,"base64");expect(body.dataCrc32c).toBe(String(crc32c(seen)));
   const signature=sign(null,seen,pair.privateKey);return Response.json({name:key.keyVersion,signature:signature.toString("base64"),signatureCrc32c:String(crc32c(signature)),verifiedDataCrc32c:true,protectionLevel:"SOFTWARE"});
  }) as unknown as typeof fetch;
  const provider=new GoogleKmsEd25519Provider(new Set([key.keyVersion]),async()=>"synthetic-token",request);
  const signer=new SigningKeyring([key],provider).signer("evidence");const signature=await signer.sign(material);expect(seen?.equals(Buffer.from(material))).toBe(true);expect(await signer.verify(material,signature)).toBe(true);
 });
 it.each(["DISABLED","DESTROYED","PENDING_GENERATION"])("rejects provider state %s",async(state)=>{
  const {key}=fixture();const request=vi.fn(async()=>Response.json({name:key.keyVersion,state,algorithm:"EC_SIGN_ED25519",protectionLevel:"SOFTWARE"})) as unknown as typeof fetch;
  await expect(new GoogleKmsEd25519Provider(new Set([key.keyVersion]),async()=>"synthetic-token",request).sign(key,Buffer.from("x"))).rejects.toThrow("unavailable");expect(request).toHaveBeenCalledTimes(1);
 });
 it("fails closed on absent workload identity before network access",async()=>{
  const {key}=fixture();const request=vi.fn();await expect(new GoogleKmsEd25519Provider(new Set([key.keyVersion]),async()=>"",request).sign(key,Buffer.from("x"))).rejects.toThrow("unavailable");expect(request).not.toHaveBeenCalled();
 });
 it("signs the exact qualified delivery serialization and preserves replay rejection",async()=>{
  const {pair,key}=fixture("federation-delivery");const captured:Uint8Array[]=[];
  const request=vi.fn(async(_url,options)=>{
   if(options?.method!=="POST")return Response.json({name:key.keyVersion,state:"ENABLED",algorithm:"EC_SIGN_ED25519",protectionLevel:"SOFTWARE"});
   const body=JSON.parse(String(options.body));expect(body.digest).toBeUndefined();const bytes=Buffer.from(body.data,"base64");captured.push(bytes);
   const signature=sign(null,bytes,pair.privateKey);return Response.json({name:key.keyVersion,signature:signature.toString("base64"),signatureCrc32c:String(crc32c(signature)),verifiedDataCrc32c:true,protectionLevel:"SOFTWARE"});
  }) as unknown as typeof fetch;
  const ring=new SigningKeyring([key],new GoogleKmsEd25519Provider(new Set([key.keyVersion]),async()=>"synthetic-token",request));
  const target="relay://owner-b/agent-b",id="request-0001",expiry=new Date(Date.now()+60000).toISOString();
  const payload={body:"🙂".repeat(8000)};submissionSchema.parse({target,resource:"messages",idempotencyKey:id,expiresAt:expiry,capability:"message.send",payload});
  const envelope={id,protocol:"relay.federation",version:"1.0",caller:{ownerId:"owner-a",agentId:"agent-a"},target:{ownerId:"owner-b",agentId:"agent-b",address:target},capability:"message.send",resource:"messages",createdAt:new Date().toISOString(),expiresAt:expiry,idempotencyKey:id,payload,publication:null,authorizationContext:{grantId:"grant",policyDecisionId:"decision",localAuthorizationRequired:true}};
  const token=await signDelivery(envelope,target,id,expiry,{signer:ring.signer("federation-delivery"),issuer:"https://relay.synthetic.invalid",keyWrapper:{keyId:"unused",wrap:vi.fn(),unwrap:vi.fn()}});
  expect(Buffer.from(captured[0]).toString()).toBe(federationSigningEnvelope(token.split('.').slice(0,2).join('.'), {id:key.keyId,version:key.keyVersion}));
  let claimed=false;const options={issuer:"https://relay.synthetic.invalid",audience:target,trustedPublicKey:async(id:string)=>ring.verificationKey(id,"federation-delivery")?.publicKeyPem,claimRequest:async()=>{if(claimed)return false;claimed=true;return true;}};
  expect((await verifyDelivery(token,options)).id).toBe(id);await expect(verifyDelivery(token,options)).rejects.toThrow("already claimed");
 });
});

describe('hosted federation composition',()=>{
 it('requires all three active qualification signing purposes',async()=>{
  const {productionCryptoBindings}=await import('@/lib/v2/production-crypto');
  const fixtures=[fixture('evidence'),fixture('federation-delivery'),fixture('passport')];
  const provider={async sign(key:Readonly<SigningKey>,material:Uint8Array){const item=fixtures.find(x=>x.key.keyId===key.keyId)!;return sign(null,material,item.pair.privateKey);}};
  const environment={NODE_ENV:'production',RELAY_CRYPTO_BACKEND:'kms',RELAY_ISSUER_URL:'https://relay.synthetic.invalid'};
  const keyWrapper={keyId:'synthetic-kms-wrapper',wrap:vi.fn(),unwrap:vi.fn()};
  expect(()=>productionCryptoBindings(environment,{keyring:new SigningKeyring(fixtures.slice(0,2).map(x=>x.key),provider),keyWrapper})).toThrow();
  const configured=productionCryptoBindings(environment,{keyring:new SigningKeyring(fixtures.map(x=>x.key),provider),keyWrapper});
  expect(configured.signer.forPurpose?.('passport').keyId).toBe('passport-v1');
  expect(()=>configured.signer.forPurpose?.('lease')).toThrow();
  expect(()=>configured.signer.forPurpose?.('session')).toThrow();
  expect(await configured.keyResolver.publicKeyForKeyId('evidence-v1')).toBeUndefined();
  expect(await configured.keyResolver.publicKeyForPurpose?.('evidence-v1','lease')).toBeUndefined();
 });
});
