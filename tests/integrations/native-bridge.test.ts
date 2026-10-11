import { describe, expect, it } from 'vitest';
import { canonicalHash } from '@/lib/v2/contracts';
import { createNativeConsumerPort } from '@/lib/integrations/native-bridge';
import { binding, executionContext, fixture, scope, tool } from './fixtures';

async function setup() {
  const f = fixture(); const context = executionContext(); const descriptor = await f.adapter.getAction(tool.slug);
  const native = { accountId: scope.accountId, ownerId: 'canonical-owner', organizationId: 'canonical-org',
    installationId: scope.installationId, agentId: scope.agentId, connectionId: binding.connectionId,
    connectionAuthorityVersion: 1, descriptorHash: canonicalHash(descriptor), argumentHash: canonicalHash({ per_page: 10 }), targetResource: 'assigned-issues' };
  const port = createNativeConsumerPort({ ownerPrincipalId: scope.ownerPrincipalId, descriptors: [descriptor], adapter: f.adapter });
  const resolved = port.resolve([{ binding }], native, context.request.action);
  const input = { binding: native, action: context.request.action, claims: context.lease, material: resolved.material };
  return { ...f, port, input, native, context };
}

describe('canonical native consumer data port (no admission authority)', () => {
  it('binds qualified descriptor, canonical connection and full result identity', async () => {
    const f = await setup();
    const result = await f.port.execute({ ...f.input, signal: new AbortController().signal });
    expect(f.port.validateResult(f.input, result)).toMatchObject({ state: 'SUCCEEDED', trust: 'UNTRUSTED_EXTERNAL_DATA' });
    expect(f.sdk.getClient().tools.execute).toHaveBeenCalledTimes(1);
    expect(() => f.port.validateResult(f.input, { ...result, evidence: { ...result.evidence, leaseId: 'foreign' } })).toThrow();
  });
  it.each(['ownerPrincipalId', 'accountId', 'agentId', 'installationId'] as const)('rejects a connection from another %s', async key => {
    const f = await setup();
    expect(() => f.port.resolve([{ binding: { ...binding, [key]: 'foreign' } }], f.native, f.input.action)).toThrow();
    expect(f.sdk.getClient().tools.execute).not.toHaveBeenCalled();
  });
  it('rejects changed connection authority and unqualified descriptor', async () => {
    const f = await setup();
    expect(() => f.port.resolve([{ binding: { ...binding, authorityVersion: 2 } }], f.native, f.input.action)).toThrow();
    expect(() => f.port.resolve([{ binding }], { ...f.native, descriptorHash: canonicalHash('foreign') }, f.input.action)).toThrow();
  });
  it('does not dispatch after receiver abort during asynchronous provider metadata lookup', async () => {
    const f = await setup(); const controller = new AbortController();
    f.sdk.tools.getRawComposioToolBySlug.mockImplementationOnce(async () => { controller.abort(); return structuredClone(tool); });
    await expect(f.port.execute({ ...f.input, signal: controller.signal })).rejects.toBeDefined();
    expect(f.sdk.getClient().tools.execute).not.toHaveBeenCalled();
  });
  it('preserves UNKNOWN and rejects forged success evidence', async () => {
    const f = await setup(); f.sdk.getClient().tools.execute.mockRejectedValue(Error('private provider error'));
    const result = await f.port.execute({ ...f.input, signal: new AbortController().signal });
    expect(f.port.validateResult(f.input, result)).toMatchObject({ state: 'UNKNOWN' });
    expect(() => f.port.validateResult(f.input, { ...result, state: 'SUCCEEDED' })).toThrow();
  });
});
