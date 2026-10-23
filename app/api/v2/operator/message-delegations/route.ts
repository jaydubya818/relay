import { z } from "zod";
import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { RelayError } from "@/lib/errors";
import { boundedBody, federationBindings } from "@/lib/v2/federation/api";
import { authenticateMessageDelegation, delegationToken, issueMessageDelegation, revokeMessageDelegation } from "@/lib/v2/federation/message-delegations";

export async function POST(request: Request) {
  try {
    if (!verifySameOrigin(request)) throw new RelayError("INVALID_CREDENTIAL", "Cross-origin owner mutation denied.", undefined, 403);
    const user = await requireApiUser();
    const body = await boundedBody(request);
    const { signer } = federationBindings();
    return Response.json(await issueMessageDelegation(user, body, signer), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ code: "INVALID_INPUT" }, { status: 400 });
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    if (!verifySameOrigin(request)) throw new RelayError("INVALID_CREDENTIAL", "Cross-origin owner mutation denied.", undefined, 403);
    const token = delegationToken(request);
    if (!token) throw new RelayError("INVALID_CREDENTIAL", "Delegation credential required.", undefined, 401);
    const delegation = await authenticateMessageDelegation(token);
    if (!delegation) throw new RelayError("INVALID_CREDENTIAL", "Delegation credential is invalid or expired.", undefined, 401);
    const { signer } = federationBindings();
    await revokeMessageDelegation(delegation, signer);
    return Response.json({ revoked: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
