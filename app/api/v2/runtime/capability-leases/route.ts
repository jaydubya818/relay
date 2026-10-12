import {errorResponse} from '@/lib/api';
import {RelayError} from '@/lib/errors';
import {requireRuntimeActionsEnabled} from '@/lib/v2/deployment';
import {requireV2PlatformBindings} from '@/lib/v2/platform-bindings';
import {issueRemoteCapabilityLease} from '@/lib/v2/remote-capability-leases';

export async function POST(request:Request){
 try{
  requireRuntimeActionsEnabled();
  const authorization=request.headers.get('authorization');
  if(!authorization?.startsWith('Bearer ')||authorization.length>20000)throw new RelayError('INVALID_CREDENTIAL','Runtime Bearer credential required.',undefined,401);
  if(!request.body)throw new RelayError('INVALID_INPUT','Request body required.');
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const{done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>65536)throw new RelayError('INVALID_INPUT','Remote lease request exceeds size limit.',undefined,413);chunks.push(value);}}finally{await reader.cancel();}
  let body:unknown;
  try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new RelayError('INVALID_INPUT','A JSON request body is required.',undefined,400);}
  const bindings=requireV2PlatformBindings();
  const result=await issueRemoteCapabilityLease({accountId:request.headers.get('x-relay-account-id')??'',credential:authorization.slice(7),expectedResource:new URL('/api/v2',request.url).toString(),request:body,oauthVerifier:bindings.oauthVerifier},bindings.signer,bindings.keyResolver);
  return Response.json(result,{headers:{'cache-control':'no-store','relay-api-version':'2026-09-13'}});
 }catch(error){return errorResponse(error);}
}
