import { createHash } from 'node:crypto';
import type { KeyWrapper } from './crypto';
import { crc32c } from './google-kms';
export interface WrappingVersion { version: string; state: 'ACTIVE' | 'RETIRED' | 'DISABLED' | 'REVOKED' }
/** Stable logical wrapper ID; opaque wrappedKey records the immutable KMS version.
 * Retired ENABLED versions decrypt only; disabled/revoked versions fail closed.
 * The owner hash is authenticated data, never an RSA-OAEP label. */
export class GoogleKmsKeyWrapper implements KeyWrapper {
  private readonly versions: readonly WrappingVersion[];
  constructor(readonly keyId: string, versions: WrappingVersion[], private readonly token: () => Promise<string>, private readonly request: typeof fetch = fetch) {
    this.versions = versions.map(v => Object.freeze({...v}));
    if (!keyId || this.versions.filter(v=>v.state==='ACTIVE').length!==1 || new Set(versions.map(v=>v.version)).size!==versions.length ||
        versions.some(v=>!/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+\/cryptoKeyVersions\/[1-9][0-9]*$/.test(v.version) || !['ACTIVE','RETIRED','DISABLED','REVOKED'].includes(v.state))) throw new Error('Invalid wrapping registry.');
  }
  private async call(version: string, action: string, body?: object) {
    const token = await this.token();
    if (!token || /\s/.test(token)) throw new Error();
    const response = await this.request(`https://cloudkms.googleapis.com/v1/${version}${action}`, {
      method: body ? 'POST' : 'GET', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(5000), redirect:'error',
    });
    if (!response.ok) throw new Error();
    return await response.json() as Record<string, unknown>;
  }
  private async available(version: string) {
    const metadata=await this.call(version,'');
    if(metadata.name!==version || metadata.state!=='ENABLED' || metadata.algorithm!=='GOOGLE_SYMMETRIC_ENCRYPTION' || metadata.protectionLevel!=='SOFTWARE') throw new Error();
  }
  async wrap(owner: string, key: Buffer): Promise<string> {
    try {
      if(!owner || key.length!==32) throw new Error();
      const version=this.versions.find(v=>v.state==='ACTIVE')!.version;
      await this.available(version);
      const aad=createHash('sha256').update(JSON.stringify(['relay-owner-dek-v1',version,owner])).digest();
      const result=await this.call(version,':encrypt',{plaintext:key.toString('base64'),plaintextCrc32c:String(crc32c(key)),additionalAuthenticatedData:aad.toString('base64'),additionalAuthenticatedDataCrc32c:String(crc32c(aad))});
      if(result.name!==version || result.verifiedPlaintextCrc32c!==true || result.verifiedAdditionalAuthenticatedDataCrc32c!==true || typeof result.ciphertext!=='string') throw new Error();
      const ciphertext=Buffer.from(result.ciphertext,'base64');
      if(!ciphertext.length || String(crc32c(ciphertext))!==String(result.ciphertextCrc32c)) throw new Error();
      return Buffer.from(JSON.stringify({format:'google-kms-dek-v1',version,ciphertext:result.ciphertext})).toString('base64url');
    } catch { throw new Error('KMS envelope wrapping is unavailable.'); }
  }
  async unwrap(owner: string, wrapped: string): Promise<Buffer> {
    try {
      if(!owner || wrapped.length>16384) throw new Error();
      const value=JSON.parse(Buffer.from(wrapped,'base64url').toString());
      if(value.format!=='google-kms-dek-v1' || typeof value.ciphertext!=='string' || typeof value.version!=='string') throw new Error();
      const version=this.versions.find(v=>v.version===value.version);
      if(!version || !['ACTIVE','RETIRED'].includes(version.state)) throw new Error();
      await this.available(version.version);
      const aad=createHash('sha256').update(JSON.stringify(['relay-owner-dek-v1',version.version,owner])).digest(), ciphertext=Buffer.from(value.ciphertext,'base64');
      // Decrypt addresses CryptoKey; opaque KMS ciphertext selects its version.
      const result=await this.call(version.version.replace(/\/cryptoKeyVersions\/[0-9]+$/,''),':decrypt',{ciphertext:value.ciphertext,ciphertextCrc32c:String(crc32c(ciphertext)),additionalAuthenticatedData:aad.toString('base64'),additionalAuthenticatedDataCrc32c:String(crc32c(aad))});
      if(typeof result.plaintext!=='string') throw new Error();
      const key=Buffer.from(result.plaintext,'base64');
      if(key.length!==32 || String(crc32c(key))!==String(result.plaintextCrc32c)) throw new Error();
      return key;
    } catch { throw new Error('KMS envelope unwrapping is unavailable.'); }
  }
}
