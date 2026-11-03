import {errorResponse} from '@/lib/api';
import {requireRuntimeActionsEnabled} from '@/lib/v2/deployment';
import {requireV2PlatformBindings} from '@/lib/v2/platform-bindings';
import {issueRemoteCapabilityLease} from '@/lib/v2/remote-capability-leases';
import {readRemoteCapabilityRequest} from '@/lib/v2/remote-capability-transport';

export async function POST(request:Request){
 try{
  requireRuntimeActionsEnabled();
  const input=await readRemoteCapabilityRequest(request),bindings=requireV2PlatformBindings();
  const result=await issueRemoteCapabilityLease({...input,oauthVerifier:bindings.oauthVerifier},bindings.signer,bindings.keyResolver);
  return Response.json(result,{headers:{'cache-control':'no-store','relay-api-version':'2026-09-13'}});
 }catch(error){return errorResponse(error);}
}
