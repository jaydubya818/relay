import { expect, it, vi } from 'vitest';
import { vercelStsTokenSource } from '@/lib/v2/evidence/google-sts';
const identity={issuer:'https://oidc.vercel.com/fq',audience:'https://vercel.com/fq',ownerId:'team_fq',projectId:'prj_fq',environment:'federation-qualification',customEnvironmentId:'env_fq',subject:'owner:fq:project:relay:environment:federation-qualification',provider:'//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/fq/providers/vercel'};
const now=1700000000000;
function assertion(overrides:Record<string,unknown>={}) {return `e30.${Buffer.from(JSON.stringify({iss:identity.issuer,aud:identity.audience,owner_id:identity.ownerId,project_id:identity.projectId,environment:identity.environment,custom_environment_id:identity.customEnvironmentId,sub:identity.subject,iat:now/1000,exp:now/1000+300,...overrides})).toString('base64url')}.synthetic`;}
function response(){return Response.json({access_token:'synthetic-sts-token',token_type:'Bearer',issued_token_type:'urn:ietf:params:oauth:token-type:access_token',expires_in:300});}
it('exchanges current request assertions without credential caching',async()=>{
 const fetch=vi.fn(async()=>response()),get=vi.fn(async()=>assertion());const token=vercelStsTokenSource(identity,get,fetch,()=>now);
 expect(await token()).toBe('synthetic-sts-token');await token();expect(get).toHaveBeenCalledTimes(2);expect(fetch).toHaveBeenCalledTimes(2);
 const options=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(options[1].headers).not.toHaveProperty('Authorization');
});
it.each([{project_id:'prj_other'},{environment:'preview'},{custom_environment_id:'env_other'},{sub:'other'},{aud:'other'},{iss:'https://oidc.vercel.com/other'},{owner_id:'team_other'},{exp:now/1000},{iat:now/1000+60},{nbf:now/1000+60}])('rejects identity mismatch before STS %j',async(claim)=>{
 const request=vi.fn(async()=>response());await expect(vercelStsTokenSource(identity,async()=>assertion(claim),request,()=>now)()).rejects.toThrow('unavailable');expect(request).not.toHaveBeenCalled();
});
it('fails closed on STS denial',async()=>{await expect(vercelStsTokenSource(identity,async()=>assertion(),async()=>new Response('',{status:403}),()=>now)()).rejects.toThrow('unavailable');});
it('rejects an expiring access token',async()=>{await expect(vercelStsTokenSource(identity,async()=>assertion(),async()=>Response.json({access_token:'x',token_type:'Bearer',expires_in:0}),()=>now)()).rejects.toThrow('unavailable');});
