import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { qualificationEnabled, qualificationRpc } from '../../qualification';
import type { RemoteSigningProvider, SigningKey } from './signing-provider';

type SigningAuthority = { rootOperation: string; requestId: string; accountId: string; agentId: string | null; operation: string };
const authority = new AsyncLocalStorage<SigningAuthority>();
const admitted = new AsyncLocalStorage<{purpose:string; keyVersion:string; payloadHash:string; consumed:boolean}>();
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/** Called only after native Relay authentication. Canonical federation policy,
 * grants, budgets and local authority still run inside the wrapped operation. */
export function withQualificationSigningAuthority<T>(context: SigningAuthority, execute: () => Promise<T>): Promise<T> {
  if (!qualificationEnabled()) return execute();
  if (!context.rootOperation || !context.requestId || !context.accountId || !context.operation) throw new Error('Qualification signing authority missing.');
  return authority.run(Object.freeze({...context}), execute);
}

/** Application policy, not a replacement for Google IAM. The controller sees
 * public bindings/hashes only; it receives no assertion, OAuth token or key. */
export class AdmittedSigningProvider implements RemoteSigningProvider {
  constructor(private readonly provider: RemoteSigningProvider) {}
  async sign(key: Readonly<SigningKey>, material: Uint8Array): Promise<Uint8Array> {
    const context = authority.getStore();
    if (!context) throw new Error('Qualification signing requires Relay authority.');
    const binding = {...context,purpose:key.purpose,keyVersion:key.keyVersion,payloadHash:digest(material)};
    const permit = await qualificationRpc('signing-admit',binding);
    const result = await qualificationRpc('signing-claim',{...binding,...permit});
    if(result.admitted!==true)throw new Error('Qualification signing permit denied.');
    return admitted.run({purpose:key.purpose,keyVersion:key.keyVersion,payloadHash:binding.payloadHash,consumed:false},()=>this.provider.sign(key,material));
  }
}

export function consumeApplicationSigningAdmission(key: Readonly<SigningKey>, material: Uint8Array): void {
  if(!qualificationEnabled())return;
  const permit=admitted.getStore();
  if(!permit||permit.consumed||permit.purpose!==key.purpose||permit.keyVersion!==key.keyVersion||permit.payloadHash!==digest(material))throw new Error('Application signing permit required.');
  permit.consumed=true;
}

/** One factory invocation represents ONE real provider attempt. Wrappers share
 * its execute function. Duplicate callbacks share the same buffered outcome;
 * an explicit retry constructs another attempt and consumes another allowance.
 * Redirects are rejected, never followed as an unmetered second request. */
export function providerAttempt(url: string, init: RequestInit, route: string, request: typeof fetch = fetch) {
  const operation=randomUUID(), method=init.method??'GET';
  if(init.body!==undefined&&typeof init.body!=='string')throw new Error('Canonical provider body required.');
  const body=init.body??'';
  const context=authority.getStore();
  const binding={operation,route,url,method,bodyHash:digest(body),rootOperation:context?.rootOperation};
  let pending:Promise<{status:number;headers:Headers;body:Buffer}>|undefined;
  return async():Promise<Response>=>{
    pending??=(async()=>{
      const permit=await qualificationRpc('provider-admit',binding,init.signal??undefined);
      init.signal?.throwIfAborted();
      const claim=await qualificationRpc('provider-claim',{...binding,...permit},init.signal??undefined);
      if(claim.admitted!==true)throw new Error('Provider attempt denied.');
      init.signal?.throwIfAborted();
      const response=await request(url,{...init,redirect:'error'});
      const chunks:Uint8Array[]=[];let bytes=0;const reader=response.body?.getReader();
      if(reader)try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>393216){await reader.cancel();throw new Error('Provider response too large.');}chunks.push(part.value);}}finally{reader.releaseLock();}
      // Only complete after the full body. Errors/abort keep the durable slot.
      await qualificationRpc('provider-complete',{operation});
      return {status:response.status,headers:response.headers,body:Buffer.concat(chunks)};
    })();
    const result=await pending;
    return new Response([204,205,304].includes(result.status)?null:Uint8Array.from(result.body),{status:result.status,headers:result.headers});
  };
}
export const qualificationProviderFetch: typeof fetch = (input,init={})=>{
  const url=input instanceof Request?input.url:String(input);
  if(input instanceof Request)throw new Error('Explicit provider request parameters required.');
  return providerAttempt(url,init,new URL(url).hostname==='sts.googleapis.com'?'google-sts':'google-kms')();
};
