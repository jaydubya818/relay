import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ sameOrigin:vi.fn(),user:vi.fn(),operator:vi.fn(),manage:vi.fn(),inspect:vi.fn(),signer:{} }));
vi.mock('@/lib/api',()=>({verifySameOrigin:mocks.sameOrigin,requireApiUser:mocks.user,errorResponse:()=>Response.json({code:'DENIED'},{status:403})}));
vi.mock('@/lib/v2/dashboard',()=>({operatorContext:mocks.operator}));
vi.mock('@/lib/v2/policy/administration',()=>({manageCapabilityAdministration:mocks.manage,inspectCapabilityAdministration:mocks.inspect}));
vi.mock('@/lib/v2/platform-bindings',()=>({requireV2PlatformBindings:()=>({signer:mocks.signer})}));
vi.mock('@/lib/v2/federation/api',()=>({boundedBody:(request:Request)=>request.json()}));
import { GET, POST } from '@/app/api/v2/operator/capability-policy/route';
beforeEach(()=>{vi.clearAllMocks();mocks.sameOrigin.mockReturnValue(true);mocks.user.mockResolvedValue({id:'authenticated-user',accountId:'authenticated-account'});mocks.operator.mockResolvedValue({principalId:'authenticated-principal'});mocks.manage.mockResolvedValue({status:'STAGED'});mocks.inspect.mockResolvedValue([]);});
it('rejects cross-origin administration before reading identity or commands',async()=>{
  mocks.sameOrigin.mockReturnValue(false);
  expect((await POST(new Request('http://localhost/api',{method:'POST',body:'{}'}))).status).toBe(403);
  expect(mocks.user).not.toHaveBeenCalled();expect(mocks.manage).not.toHaveBeenCalled();
});
it('requires an authenticated user for read and mutation',async()=>{
  mocks.user.mockRejectedValue(Error('unauthenticated'));
  expect((await GET()).status).toBe(403);
  expect((await POST(new Request('http://localhost/api',{method:'POST',body:'{}'}))).status).toBe(403);
  expect(mocks.inspect).not.toHaveBeenCalled();expect(mocks.manage).not.toHaveBeenCalled();
});
it('derives the account and principal only from authenticated administrative records',async()=>{
  const input={operation:'stage_policy',accountId:'untrusted-payload'};
  const response=await POST(new Request('http://localhost/api',{method:'POST',body:JSON.stringify(input)}));
  expect(response.status).toBe(200);
  expect(mocks.manage).toHaveBeenCalledWith({accountId:'authenticated-account',principalId:'authenticated-principal'},input,mocks.signer);
  expect(response.headers.get('cache-control')).toBe('no-store');
});
it('rejects malformed JSON without running a command',async()=>{
  expect((await POST(new Request('http://localhost/api',{method:'POST',body:'{'}))).status).toBe(403);
  expect(mocks.manage).not.toHaveBeenCalled();
});
