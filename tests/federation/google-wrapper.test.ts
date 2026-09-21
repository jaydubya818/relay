import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { expect,it,vi } from 'vitest';
import { GoogleKmsKeyWrapper, type WrappingVersion } from '@/lib/v2/evidence/google-wrapper';
import { crc32c } from '@/lib/v2/evidence/google-kms';
const base='projects/fq/locations/us-east4/keyRings/fq/cryptoKeys/envelope',v1=`${base}/cryptoKeyVersions/1`,v2=`${base}/cryptoKeyVersions/2`;
function provider(){
 const keys=new Map([[v1,randomBytes(32)],[v2,randomBytes(32)]]),disabled=new Set<string>();
 const request=vi.fn(async(url: string|URL|Request,init?:RequestInit)=>{
  const path=String(url).replace('https://cloudkms.googleapis.com/v1/',''),body=JSON.parse(String(init?.body??'{}'));
  if(!init?.body)return Response.json({name:path,state:disabled.has(path)?'DISABLED':'ENABLED',algorithm:'GOOGLE_SYMMETRIC_ENCRYPTION',protectionLevel:'SOFTWARE'});
  try{
   if(path.endsWith(':encrypt')){
    const version=path.slice(0,-8),key=keys.get(version)!;if(disabled.has(version))throw Error();
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(body.additionalAuthenticatedData,'base64'));
    const ciphertext=Buffer.from(JSON.stringify({version,iv:iv.toString('base64'),data:Buffer.concat([cipher.update(Buffer.from(body.plaintext,'base64')),cipher.final()]).toString('base64'),tag:cipher.getAuthTag().toString('base64')}));
    return Response.json({name:version,ciphertext:ciphertext.toString('base64'),ciphertextCrc32c:String(crc32c(ciphertext)),verifiedPlaintextCrc32c:true,verifiedAdditionalAuthenticatedDataCrc32c:true});
   }
   const c=JSON.parse(Buffer.from(body.ciphertext,'base64').toString());if(disabled.has(c.version))throw Error();
   const cipher=createDecipheriv('aes-256-gcm',keys.get(c.version)!,Buffer.from(c.iv,'base64'));cipher.setAAD(Buffer.from(body.additionalAuthenticatedData,'base64'));cipher.setAuthTag(Buffer.from(c.tag,'base64'));
   const plaintext=Buffer.concat([cipher.update(Buffer.from(c.data,'base64')),cipher.final()]);return Response.json({plaintext:plaintext.toString('base64'),plaintextCrc32c:String(crc32c(plaintext))});
  }catch{return new Response('',{status:400});}
 });return {request,disabled};
}
function wrapper(p:ReturnType<typeof provider>,versions:WrappingVersion[]=[{version:v1,state:'ACTIVE'}]){return new GoogleKmsKeyWrapper('owner-envelope',versions,async()=>'synthetic-token',p.request);}
it('wraps only a random 32-byte DEK with authenticated owner binding',async()=>{const p=provider(),w=wrapper(p),key=randomBytes(32),blob=await w.wrap('owner-a',key);expect(await w.unwrap('owner-a',blob)).toEqual(key);await expect(w.unwrap('owner-b',blob)).rejects.toThrow('unavailable');});
it('decrypts historical ciphertext after rotation and uses the new version for writes',async()=>{const p=provider(),key=randomBytes(32),blob=await wrapper(p).wrap('a',key),w=wrapper(p,[{version:v1,state:'RETIRED'},{version:v2,state:'ACTIVE'}]);expect(await w.unwrap('a',blob)).toEqual(key);expect(JSON.parse(Buffer.from(await w.wrap('a',key),'base64url').toString()).version).toBe(v2);});
it.each(['DISABLED','REVOKED'] as const)('rejects %s historical versions before provider access',async(state)=>{const p=provider(),blob=await wrapper(p).wrap('a',randomBytes(32));p.request.mockClear();await expect(wrapper(p,[{version:v1,state},{version:v2,state:'ACTIVE'}]).unwrap('a',blob)).rejects.toThrow('unavailable');expect(p.request).not.toHaveBeenCalled();});
it('prevents relabeling a revoked ciphertext as an active version',async()=>{const p=provider(),blob=await wrapper(p).wrap('a',randomBytes(32)),value=JSON.parse(Buffer.from(blob,'base64url').toString());value.version=v2;await expect(wrapper(p,[{version:v1,state:'REVOKED'},{version:v2,state:'ACTIVE'}]).unwrap('a',Buffer.from(JSON.stringify(value)).toString('base64url'))).rejects.toThrow('unavailable');});
it('rejects remotely disabled keys',async()=>{const p=provider();p.disabled.add(v1);await expect(wrapper(p).wrap('a',randomBytes(32))).rejects.toThrow('unavailable');});
it('fails closed on IAM denial',async()=>{const w=new GoogleKmsKeyWrapper('owner-envelope',[{version:v1,state:'ACTIVE'}],async()=>'synthetic',async()=>new Response('',{status:403}));await expect(w.wrap('a',randomBytes(32))).rejects.toThrow('unavailable');});
