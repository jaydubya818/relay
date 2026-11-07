import { beforeEach, expect, it, vi } from 'vitest';
import { RelayError } from '@/lib/errors';
const mocks = vi.hoisted(() => ({ sameOrigin: vi.fn(), user: vi.fn(), operator: vi.fn(), install: vi.fn(), signer: {} }));
vi.mock('@/lib/api', async () => ({ ...(await vi.importActual<typeof import('@/lib/api')>('@/lib/api')), verifySameOrigin: mocks.sameOrigin, requireApiUser: mocks.user }));
vi.mock('@/lib/v2/dashboard', () => ({ operatorContext: mocks.operator }));
vi.mock('@/lib/v2/hosted-enrollment', () => ({ installHostedEnrollment: mocks.install }));
vi.mock('@/lib/v2/platform-bindings', () => ({ requireV2PlatformBindings: () => ({ signer: mocks.signer }) }));
vi.mock('@/lib/v2/federation/api', () => ({ boundedBody: (request: Request) => request.json() }));
import { POST } from '@/app/api/v2/operator/hosted-enrollment/route';
const post = (body: unknown) => POST(new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) }));
beforeEach(() => { vi.clearAllMocks(); mocks.sameOrigin.mockReturnValue(true);
  mocks.user.mockResolvedValue({ id: 'usr_owner', accountId: 'acct_owner' }); mocks.operator.mockResolvedValue({ principalId: 'prn_owner' }); });

it('returns 401 without a session and runs nothing', async () => {
  mocks.user.mockRejectedValue(new RelayError('INVALID_CREDENTIAL', 'Dashboard authentication required.', undefined, 401));
  expect((await post({})).status).toBe(401); expect(mocks.install).not.toHaveBeenCalled();
});
it('rejects cross-origin requests before reading identity', async () => {
  mocks.sameOrigin.mockReturnValue(false);
  expect((await post({})).status).toBe(403); expect(mocks.user).not.toHaveBeenCalled();
});
it('passes only the authenticated account/principal and returns no-store', async () => {
  mocks.install.mockResolvedValue({ agentId: 'agt_x', workloadToken: 'secret' });
  const response = await post({ installationId: 'jay', accountId: 'untrusted' });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.install).toHaveBeenCalledWith({ accountId: 'acct_owner', principalId: 'prn_owner' }, { installationId: 'jay', accountId: 'untrusted' }, mocks.signer);
});
it('maps step-up and role refusals to 403', async () => {
  mocks.install.mockRejectedValue(new RelayError('CAPABILITY_DENIED', 'Password step-up required.', undefined, 403));
  expect((await post({ installationId: 'jay' })).status).toBe(403);
});
