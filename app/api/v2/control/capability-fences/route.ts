import { boundedBody } from '@/lib/v2/federation/api';
import { forwardOwnerPolicyFence } from '@/lib/v2/policy/ordering';
import type { SignedPolicyMessage } from '@/lib/v2/policy/ordering-wire';

export async function POST(request: Request) {
  try {
    const value = await boundedBody(request) as { envelope?: SignedPolicyMessage };
    if (!value.envelope) return Response.json({ code: 'CAPABILITY_PROTOCOL_INVALID' }, { status: 400 });
    return Response.json(await forwardOwnerPolicyFence(value.envelope), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ code: 'CAPABILITY_PROPAGATION_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
