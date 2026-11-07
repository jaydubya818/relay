import { z } from 'zod';
import { errorResponse, requireApiUser, verifySameOrigin } from '@/lib/api';
import { operatorContext } from '@/lib/v2/dashboard';
import { boundedBody } from '@/lib/v2/federation/api';
import { installHostedEnrollment } from '@/lib/v2/hosted-enrollment';
import { requireV2PlatformBindings } from '@/lib/v2/platform-bindings';

const headers = { 'Cache-Control': 'no-store' };
/** Owner-only hosted Sofie enrollment (session + password step-up). The response carries secrets once; nothing here logs it. */
export async function POST(request: Request) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ code: 'INVALID_CREDENTIAL' }, { status: 403, headers });
    const user = await requireApiUser();
    const operator = await operatorContext(user.accountId, user.id);
    return Response.json(await installHostedEnrollment({ accountId: user.accountId, principalId: operator.principalId }, await boundedBody(request),
      requireV2PlatformBindings().signer), { headers });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ code: 'INVALID_INPUT' }, { status: 400, headers });
    return errorResponse(error);
  }
}
