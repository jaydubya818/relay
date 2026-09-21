import vector from '../../docs/federation/vectors/signing-envelope-v2.json';
import { envelopeV2Fixtures, qualificationAudience, qualificationIssuer } from '../../scripts/production-qualification/envelope-v2-fixtures';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '@/lib/v2/contracts';
import { createLocalEd25519Signer, type AuditSigner } from '@/lib/v2/evidence/crypto';
import { GoogleKmsEd25519Provider, crc32c } from '@/lib/v2/evidence/google-kms';
import { SigningKeyring, type SigningKey } from '@/lib/v2/evidence/signing-provider';
import { decodeCanonicalSegment, federationSigningEnvelope, federationV2Header, signingEnvelopeSchema } from '@/lib/v2/federation/signing-envelope';
import { signDelivery, verifyDelivery, MAX_FEDERATION_TOKEN_CHARS } from '@/lib/v2/federation/transport';

const clock = new Date('2030-01-01T00:00:00Z');
const audience = 'relay://synthetic-owner/agent';
const issuer = 'https://relay.synthetic.invalid';
const version = 'projects/relay-local-qualification/locations/us-east4/keyRings/fq-compatibility-probe/cryptoKeys/fq-ed25519-probe/cryptoKeyVersions/1';
function fixture(padding = '') {
  return { id:'synthetic-request', protocol:'relay.federation', version:'1.0',
    caller:{ownerId:'caller',agentId:'caller-agent'}, target:{ownerId:'synthetic-owner',agentId:'agent',address:audience},
    capability:'message.send',resource:'messages',createdAt:clock.toISOString(),expiresAt:new Date(+clock+60000).toISOString(),
    idempotencyKey:'synthetic-request',payload:{body:'Synthetic only'},publication:{padding},
    authorizationContext:{grantId:'synthetic-grant',policyDecisionId:'synthetic-decision',localAuthorizationRequired:true} };
}
function material(envelope: ReturnType<typeof fixture>, kid: string) {
  return [federationV2Header(kid,version),{iss:issuer,aud:audience,jti:envelope.id,iat:+clock/1000,exp:+clock/1000+60,envelope}]
    .map(x=>Buffer.from(canonicalJson(x)).toString('base64url')).join('.');
}
function sized(bytes: number) {
  for(let k=0;k<4;k++) {
    const kid='qualification-v2'+'x'.repeat(k);
    let low=0,high=bytes;
    while(low<=high) {
      const mid=Math.floor((low+high)/2),e=fixture('x'.repeat(mid)),length=material(e,kid).length;
      if(length===bytes)return {envelope:e,kid};
      if(length<bytes)low=mid+1;else high=mid-1;
    }
  }
  throw Error('Exact fixture unavailable');
}
function bindings(signer: AuditSigner) {
  return {signer,issuer,keyWrapper:{keyId:'unused',wrap:vi.fn(),unwrap:vi.fn()}};
}
function verifier(signer: AuditSigner) {
  return {issuer,audience,trustedPublicKey:async(id:string,v?:string)=>id===signer.keyId&&(!v||v===signer.keyVersion)?signer.publicKeyPem():undefined,claimRequest:vi.fn(async()=>true)};
}
function local(kid='qualification-v2') {
  const signer={...createLocalEd25519Signer(kid),keyVersion:version};
  return {...signer,sign:vi.fn(signer.sign)};
}
const encode=(x:unknown)=>Buffer.from(canonicalJson(x)).toString('base64url');
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(clock);});
afterEach(()=>{vi.useRealTimers();});

describe('canonical signing envelope V2',()=>{
  it('verifies the fixed public-only canonical vector',async()=>{
    expect(createHash('sha256').update(vector.canonicalAuthenticatedPayload).digest('hex')).toBe(vector.expectedDigest);
    expect(federationSigningEnvelope(vector.canonicalAuthenticatedPayload,{id:'qualification-vector-v2',version:'qualification-version-1'})).toBe(vector.canonicalEnvelope);
    expect(createHash('sha256').update(vector.canonicalEnvelope).digest('hex')).toBe(vector.canonicalEnvelopeSha256);
    expect(Buffer.byteLength(vector.canonicalEnvelope)).toBe(vector.providerInputBytes);
    await expect(verifyDelivery(vector.token,{issuer,audience:'relay://b/b',trustedPublicKey:async()=>vector.publicKeyPem,claimRequest:async()=>true})).resolves.toMatchObject({id:'vector-request'});
  });
  it('authenticates schema-valid publication joins through the exact maximum',async()=>{
    const sizes=[];
    for(const f of envelopeV2Fixtures(clock)) {
      const signer=local(f.keyId);
      const token=await signDelivery(f.envelope,qualificationAudience,String(f.envelope.id),String(f.envelope.expiresAt),{...bindings(signer),issuer:qualificationIssuer});
      expect(token.length).toBe(f.materialBytes+87);
      sizes.push(Buffer.byteLength(signer.sign.mock.calls[0][0]));
      await expect(verifyDelivery(token,{...verifier(signer),audience:qualificationAudience,issuer:qualificationIssuer})).resolves.toEqual(f.envelope);
    }
    expect(Math.max(...sizes)).toBeLessThan(1024);
  });
  it.each(['alg','typ','kid','keyVersion'])('rejects modified protected %s metadata',async field=>{
    const signer=local(),e=fixture(),token=await signDelivery(e,audience,e.id,e.expiresAt,bindings(signer)),parts=token.split('.');
    const header=JSON.parse(Buffer.from(parts[0],'base64url').toString());header[field]='invalid';parts[0]=encode(header);
    await expect(verifyDelivery(parts.join('.'),verifier(signer))).rejects.toThrow();
  });
  it.each([2048,65536,132693,260000,262057])('authenticates %i exact bytes through the local signer and simulated KMS',async bytes=>{
    const {envelope,kid}=sized(bytes),signer=local(kid);
    const token=await signDelivery(envelope,audience,envelope.id,envelope.expiresAt,bindings(signer));
    expect(token.length).toBe(bytes+87);expect(token.length).toBeLessThanOrEqual(MAX_FEDERATION_TOKEN_CHARS);
    await expect(verifyDelivery(token,verifier(signer))).resolves.toEqual(envelope);
    const input=signer.sign.mock.calls[0][0];expect(Buffer.byteLength(input)).toBeLessThan(1024);
    expect(input).toBe(federationSigningEnvelope(token.split('.').slice(0,2).join('.'),{id:kid,version}));
    const pair=generateKeyPairSync('ed25519');const publicKeyPem=pair.publicKey.export({type:'spki',format:'pem'}).toString();
    const key:SigningKey={keyId:kid,keyVersion:version,purpose:'federation-delivery',algorithm:'Ed25519',publicKeyPem,state:'ACTIVE',activatedAt:'2020-01-01T00:00:00Z'};
    const request=vi.fn(async(url: Parameters<typeof fetch>[0],init?:RequestInit)=>{
      expect(String(url)).toMatch(new RegExp('^https://cloudkms.googleapis.com/v1/'+version));
      if(init?.method!=='POST')return Response.json({name:version,state:'ENABLED',algorithm:'EC_SIGN_ED25519',protectionLevel:'SOFTWARE'});
      const body=JSON.parse(String(init.body));expect(body.digest).toBeUndefined();const raw=Buffer.from(body.data,'base64');
      expect(raw.toString()).toBe(input);expect(body.dataCrc32c).toBe(String(crc32c(raw)));
      const signature=sign(null,raw,pair.privateKey);
      return Response.json({name:version,signature:signature.toString('base64'),signatureCrc32c:String(crc32c(signature)),verifiedDataCrc32c:true,protectionLevel:'SOFTWARE'});
    });
    const kms=new SigningKeyring([key],new GoogleKmsEd25519Provider(new Set([version]),async()=>'synthetic-test-token',request)).signer('federation-delivery');
    const kmsToken=await signDelivery(envelope,audience,envelope.id,envelope.expiresAt,bindings(kms));
    await expect(verifyDelivery(kmsToken,verifier(kms))).resolves.toEqual(envelope);expect(request).toHaveBeenCalledTimes(2);
  });
  it('rejects maximum plus one before either signer/provider invocation',async()=>{
    const {envelope,kid}=sized(262058),signer=local(kid);
    await expect(signDelivery(envelope,audience,envelope.id,envelope.expiresAt,bindings(signer))).rejects.toMatchObject({status:413});
    expect(signer.sign).not.toHaveBeenCalled();
  });
  it('keeps provider input constant for the same identity, independent of payload size',async()=>{
    const signer=local();const sizes=[];
    for(const n of [0,48000,98000,190000]) {const e=fixture('x'.repeat(n));await signDelivery(e,audience,e.id,e.expiresAt,bindings(signer));sizes.push(Buffer.byteLength(signer.sign.mock.calls.at(-1)![0]));}
    expect(new Set(sizes).size).toBe(1);
  });
  it('rejects mutations at the start, middle and end of the maximum payload without claiming authority',async()=>{
    const {envelope,kid}=sized(262057),signer=local(kid),options=verifier(signer);
    const token=await signDelivery(envelope,audience,envelope.id,envelope.expiresAt,bindings(signer));
    const parts=token.split('.'),original=Buffer.from(parts[1],'base64url').toString();
    const start=original.indexOf('x'.repeat(100));
    for(const offset of [start,start+Math.floor(envelope.publication.padding.length/2),start+envelope.publication.padding.length-1]) {
      const changed=original.slice(0,offset)+'y'+original.slice(offset+1);
      await expect(verifyDelivery([parts[0],Buffer.from(changed).toString('base64url'),parts[2]].join('.'),options)).rejects.toThrow();
    }
    expect(options.claimRequest).not.toHaveBeenCalled();
  });
  it.each(['digest','purpose','version','algorithm','key','keyVersion','protocol'])('rejects a signature for a different %s envelope',async field=>{
    const signer=local(),e=fixture(),token=await signDelivery(e,audience,e.id,e.expiresAt,bindings(signer));
    const altered=JSON.parse(signer.sign.mock.calls[0][0]);
    if(field==='digest')altered.payloadDigest='0'.repeat(64);
    if(field==='purpose')altered.purpose='passport';
    if(field==='version')altered.version=1;
    if(field==='algorithm')altered.signingAlgorithm='RSA';
    if(field==='key')altered.keyIdentity.id='other';
    if(field==='keyVersion')altered.keyIdentity.version='other';
    if(field==='protocol')altered.protocol='other.protocol';
    const signature=await signer.sign(canonicalJson(altered));
    await expect(verifyDelivery(token.split('.').slice(0,2).concat(signature).join('.'),verifier(signer))).rejects.toThrow();
  });
  it('rejects wrong public keys and immutable version bindings',async()=>{
    const signer=local(),e=fixture(),token=await signDelivery(e,audience,e.id,e.expiresAt,bindings(signer));
    await expect(verifyDelivery(token,{...verifier(signer),trustedPublicKey:async()=>createLocalEd25519Signer().publicKeyPem()})).rejects.toThrow();
    await expect(verifyDelivery(token,verifier({...signer,keyVersion:'other-version'}))).rejects.toThrow();
  });
  it('retains explicit legacy verification and rejects downgrade and upgrade substitutions',async()=>{
    const signer=local(),e=fixture(),v2=await signDelivery(e,audience,e.id,e.expiresAt,bindings(signer));
    const p=v2.split('.'),legacyHeader=encode({alg:'EdDSA',typ:'relay-federation+jwt',kid:signer.keyId});
    const legacyMaterial=legacyHeader+'.'+p[1];
    const legacy=legacyMaterial+'.'+await signer.sign(legacyMaterial);
    await expect(verifyDelivery(legacy,verifier(signer))).resolves.toEqual(e);
    await expect(verifyDelivery(legacyMaterial+'.'+p[2],verifier(signer))).rejects.toThrow();
    await expect(verifyDelivery(p[0]+'.'+p[1]+'.'+legacy.split('.')[2],verifier(signer))).rejects.toThrow();
  });
  it.each(['whitespace','ordering','duplicate','padding'])('rejects noncanonical %s even with a correctly signed alternate encoding',async kind=>{
    const signer=local(),e=fixture(),token=await signDelivery(e,audience,e.id,e.expiresAt,bindings(signer)),parts=token.split('.');
    const parsed=JSON.parse(Buffer.from(parts[1],'base64url').toString());let text=canonicalJson(parsed);
    if(kind==='whitespace')text=JSON.stringify(parsed,null,2);
    if(kind==='ordering')text=JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse()));
    if(kind==='duplicate')text=text.replace('{','{"iss":"ignored",');
    parts[1]=Buffer.from(text).toString('base64url')+(kind==='padding'?'=':'');
    parts[2]=await signer.sign(federationSigningEnvelope(parts.slice(0,2).join('.'),{id:signer.keyId,version}));
    await expect(verifyDelivery(parts.join('.'),verifier(signer))).rejects.toThrow();
  });
  it('canonicalizes ordering, Unicode, escapes, empty values and arrays deterministically',()=>{
    const a={z:['é','e\u0301','🙂','\u0000','"','\\',' ',null,{},[]],empty:''};
    const b={empty:'',z:a.z};expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(decodeCanonicalSegment(encode(a))).toEqual(a);
    expect(federationSigningEnvelope(canonicalJson(a),{id:'test',version:'1'})).toBe(federationSigningEnvelope(canonicalJson(b),{id:'test',version:'1'}));
    expect(canonicalJson('é')).not.toBe(canonicalJson('e\u0301'));
    expect(signingEnvelopeSchema.safeParse({...JSON.parse(federationSigningEnvelope('x',{id:'test',version:'1'})),version:1}).success).toBe(false);
    expect(createHash('sha256').update(canonicalJson(a)).digest('hex')).toHaveLength(64);
  });
  it('rejects truncated signatures',async()=>{
    const signer=local(),e=fixture(),token=await signDelivery(e,audience,e.id,e.expiresAt,bindings(signer));
    await expect(verifyDelivery(token.slice(0,-1),verifier(signer))).rejects.toThrow();
  });
});
