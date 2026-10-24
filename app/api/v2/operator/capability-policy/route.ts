import { z } from 'zod';
import { errorResponse, requireApiUser, verifySameOrigin } from '@/lib/api';
import { operatorContext } from '@/lib/v2/dashboard';
import { boundedBody } from '@/lib/v2/federation/api';
import { requireV2PlatformBindings } from '@/lib/v2/platform-bindings';
import { inspectCapabilityAdministration, manageCapabilityAdministration } from '@/lib/v2/policy/administration';

async function actor() {
  const user = await requireApiUser();
  const operator = await operatorContext(user.accountId, user.id);
  return { accountId: user.accountId, principalId: operator.principalId };
}
const headers = { 'Cache-Control': 'no-store' };
export async function GET() {
  try { return Response.json(await inspectCapabilityAdministration(await actor()), { headers }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ code: 'INVALID_CREDENTIAL' }, { status: 403, headers });
    const operator = await actor();
    return Response.json(await manageCapabilityAdministration(operator, await boundedBody(request), requireV2PlatformBindings().signer), { headers });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ code: 'INVALID_INPUT' }, { status: 400, headers });
    return errorResponse(error);
  }
}
