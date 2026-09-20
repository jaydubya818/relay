import { randomUUID, createHash } from 'node:crypto';

export function qualificationEnabled(): boolean {
  return Boolean(process.env.FQ_SESSION_ID) || process.env.MYEVE_QUALIFICATION_MODE === 'true' || process.env.RELAY_QUALIFICATION_MODE === 'true';
}
export function assertQualificationConfiguration() {
  const url = new URL(process.env.FQ_CONTROLLER_URL ?? '');
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !/^[a-z0-9_-]{8,80}$/.test(process.env.FQ_SESSION_ID ?? '') || !process.env.FQ_COMPONENT_TOKEN || !process.env.FQ_OWNER_ID) throw new Error('Qualification controller configuration is unavailable.');
  for (const name of ['AI_GATEWAY_API_KEY','ANTHROPIC_API_KEY','OPENAI_API_KEY','GOOGLE_APPLICATION_CREDENTIALS','BLOB_READ_WRITE_TOKEN','MYEVE_RELAY_INGRESS_SECRETS']) {
    if (process.env[name]) throw new Error('Qualification bypass credential is forbidden.');
  }
  return url.origin;
}
async function boundedBody(body: ReadableStream<Uint8Array> | null, maximum: number): Promise<Buffer> {
  const parts: Uint8Array[]=[];let bytes=0;const reader=body?.getReader();
  if(reader)try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>maximum){await reader.cancel();throw new Error('Qualification body too large.');}parts.push(chunk.value);}}finally{reader.releaseLock();}
  return Buffer.concat(parts);
}
export async function qualificationRpc(action: string, input: unknown, signal?: AbortSignal): Promise<any> {
  const origin = assertQualificationConfiguration();
  const response = await fetch(`${origin}/${action}`, {
    method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(65000)]) : AbortSignal.timeout(65000),
    headers: {'content-type':'application/json', authorization:`Bearer ${process.env.FQ_COMPONENT_TOKEN}`},
    body: JSON.stringify({session:process.env.FQ_SESSION_ID, ...input as object}),
  });
  if (!response.ok) throw new Error('Qualification admission denied.');
  const text = (await boundedBody(response.body,600000)).toString();
  return JSON.parse(text);
}
export const qualificationOperation = () => randomUUID();
export async function qualificationFetch(url: string | URL, init: RequestInit = {}, route = 'relay'): Promise<Response> {
  if (!qualificationEnabled()) return fetch(url,init);
  const body = init.body === undefined ? '' : String(init.body);
  const result = await qualificationRpc('http', {operation:qualificationOperation(),route,url:String(url),method:init.method??'GET',
    headers:Object.fromEntries(new Headers(init.headers).entries()),bodyBase64:Buffer.from(body).toString('base64')},init.signal??undefined);
  return new Response([204,205,304].includes(result.status)?null:Buffer.from(result.bodyBase64,'base64'),{status:result.status,headers:result.headers});
}
export async function qualifyArtifact(ownerId: string, artifactId: string, content: string | Buffer) {
  if (!qualificationEnabled()) return;
  if (ownerId !== process.env.FQ_OWNER_ID) throw new Error('Qualification owner denied.');
  const bytes = Buffer.from(content);if(bytes.length>65536)throw new Error('Qualification artifact too large.');
  const receipt=await qualificationRpc('artifact',{operation:qualificationOperation(),ownerId,artifactId,bodyBase64:bytes.toString('base64')});
  if(receipt.ownerId!==ownerId||receipt.artifactId!==artifactId||receipt.bytes!==bytes.length||receipt.sha256!==createHash('sha256').update(bytes).digest('hex')||receipt.expiresAt<=Date.now())throw new Error('Qualification artifact permit invalid.');
}
export async function qualifyIngress(request: Request, allowedPath: RegExp): Promise<void> {
  if (!qualificationEnabled()) return;
  const url=new URL(request.url);
  if(!allowedPath.test(url.pathname))throw new Error('Qualification origin path denied.');
  const body=await boundedBody(request.clone().body,131072);
  await qualificationRpc('claim',{operation:request.headers.get('x-fq-operation'),permit:request.headers.get('x-fq-permit'),method:request.method,url:url.href,bodyBase64:body.toString('base64')});
}
export async function qualificationModel(ownerId: string, requestId: string, input: string, signal: AbortSignal) {
  if(ownerId!==process.env.FQ_OWNER_ID)throw new Error('Qualification owner denied.');
  // Stable operation across restart: an uncertain prior invocation is never retried implicitly.
  const result=await qualificationRpc('model',{operation:requestId,input},signal);
  return {text:String(result.text),providerMetadata:{gateway:{cost:result.actualMicrousd/1000000}},response:{id:`fq:${requestId}`}};
}
