import { z } from "zod";
import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { operatorContext } from "@/lib/v2/dashboard";
import { boundedBody, federationBindings } from "@/lib/v2/federation/api";
import { manageMessagePolicy } from "@/lib/v2/federation/message-policy";

export async function POST(request: Request) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ code: "INVALID_CREDENTIAL" }, { status: 403 });
    const user = await requireApiUser(), actor = await operatorContext(user.accountId, user.id);
    return Response.json(await manageMessagePolicy({ accountId: user.accountId, principalId: actor.principalId }, await boundedBody(request), federationBindings().signer), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ code: "INVALID_INPUT" }, { status: 400 });
    return errorResponse(error);
  }
}
