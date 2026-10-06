import { z } from "zod";
import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { operatorContext } from "@/lib/v2/dashboard";
import { boundedBody, federationBindings } from "@/lib/v2/federation/api";
import { manageMessageEnrollment, readMessageEnrollment } from "@/lib/v2/federation/enrollment";

type Context = { params: Promise<{ id: string }> };
async function owner() {
  const user = await requireApiUser();
  const actor = await operatorContext(user.accountId, user.id);
  return { accountId: user.accountId, principalId: actor.principalId };
}
export async function GET(_: Request, context: Context) {
  try { return Response.json(await readMessageEnrollment(await owner(), (await context.params).id), { headers: { "cache-control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ code: "INVALID_CREDENTIAL" }, { status: 403 });
    const actor = await owner(), agentId = (await context.params).id;
    const { signer } = federationBindings();
    return Response.json(await manageMessageEnrollment(actor, agentId, await boundedBody(request), signer), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ code: "INVALID_INPUT" }, { status: 400 });
    return errorResponse(error);
  }
}
