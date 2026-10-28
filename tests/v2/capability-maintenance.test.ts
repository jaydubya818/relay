import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ owner: vi.fn(), relay: vi.fn() }));
vi.mock('@/lib/browsers', () => ({ cleanupExpiredBrowserSessions: async () => 0 }));
vi.mock('@/lib/sandboxes', () => ({ cleanupExpiredSandboxes: async () => 0 }));
vi.mock('@/lib/v2/federation/service', () => ({ expireFederationContent: async () => undefined }));
vi.mock('@/lib/v2/policy/ordering', () => ({
  orderingConfiguration: () => ({ destinations: [{ accountId: 'owner-a' }, { accountId: 'owner-b' }] }),
  flushOwnerPolicyFences: mocks.owner, flushRelayPolicyFences: mocks.relay,
}));
import { runMaintenanceCycle } from '@/lib/worker';
afterEach(() => vi.clearAllMocks());
it('one unavailable receiver cannot starve another owner revocation delivery', async () => {
  mocks.owner.mockImplementation(async (id: string) => [{ backendId: id, status: 'ACKNOWLEDGED' }]);
  mocks.relay.mockImplementation(async (id: string) => { if (id === 'owner-a') throw Error('receiver unavailable'); });
  const result = await runMaintenanceCycle();
  expect(mocks.owner).toHaveBeenCalledWith('owner-b');
  expect(mocks.relay).toHaveBeenCalledWith('owner-b');
  expect(result.policyDeliveries).toEqual([
    { accountId: 'owner-a', owner: 'DRAINED', relay: 'PENDING_BACKEND' },
    { accountId: 'owner-b', owner: 'DRAINED', relay: 'DRAINED' },
  ]);
});
it('an owner-delivery failure preserves independent Relay and other-owner progress', async () => {
  mocks.owner.mockImplementation(async (id: string) => { if (id === 'owner-a') throw Error('owner delivery unavailable'); return []; });
  mocks.relay.mockResolvedValue(undefined);
  const result = await runMaintenanceCycle();
  expect(result.policyDeliveries[0]).toEqual({ accountId: 'owner-a', owner: 'PENDING_BACKEND', relay: 'DRAINED' });
  expect(result.policyDeliveries[1].owner).toBe('DRAINED');
});
