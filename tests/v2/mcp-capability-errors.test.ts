import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ thrown: new Error('CAPABILITY_PROPAGATION_PENDING') as Error }));
vi.mock('@/lib/v2/developer-platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/v2/developer-platform')>();
  return { ...actual, handleV2Mcp: vi.fn(async () => { throw mocks.thrown; }) };
});
vi.mock('@/lib/v2/platform-bindings', () => ({
  requireV2PlatformBindings: () => ({ oauthVerifier: undefined, signer: {}, keyResolver: {} }),
}));

import { POST } from '@/app/api/v2/mcp/route';

function request() {
  return new Request('https://relay.test/api/v2/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer rly_synthetic', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'initialize' }),
  });
}

it('maps a raw CAPABILITY_PROPAGATION_PENDING throw on v2 MCP instead of INTERNAL_ERROR', async () => {
  mocks.thrown = new Error('CAPABILITY_PROPAGATION_PENDING');
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('retry-after')).toBe('1');
  expect(await response.json()).toMatchObject({
    jsonrpc: '2.0',
    id: 7,
    error: {
      code: -32602,
      data: { code: 'CAPABILITY_PENDING', reason: 'CAPABILITY_PROPAGATION_PENDING', retryAfter: 1, message: 'CAPABILITY_PROPAGATION_PENDING' },
    },
  });
});

it('maps a raw CAPABILITY_ACK_TOO_LARGE throw on v2 MCP as a denial, not unavailable', async () => {
  mocks.thrown = new Error('CAPABILITY_ACK_TOO_LARGE');
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('retry-after')).toBeNull();
  expect(await response.json()).toMatchObject({
    jsonrpc: '2.0',
    id: 7,
    error: {
      code: -32003,
      data: { code: 'CAPABILITY_DENIED', reason: 'CAPABILITY_ACK_TOO_LARGE', message: 'CAPABILITY_ACK_TOO_LARGE' },
    },
  });
});

it('maps a raw CAPABILITY_ENROLLMENT_UNAVAILABLE throw on v2 MCP as unavailable', async () => {
  mocks.thrown = new Error('CAPABILITY_ENROLLMENT_UNAVAILABLE');
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('retry-after')).toBeNull();
  expect(await response.json()).toMatchObject({
    jsonrpc: '2.0',
    id: 7,
    error: {
      code: -32602,
      data: { code: 'CAPABILITY_UNAVAILABLE', reason: 'CAPABILITY_ENROLLMENT_UNAVAILABLE', message: 'CAPABILITY_ENROLLMENT_UNAVAILABLE' },
    },
  });
});
