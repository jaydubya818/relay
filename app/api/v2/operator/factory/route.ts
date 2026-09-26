import { randomUUID } from "node:crypto";
import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { recordActivity } from "@/lib/activity";
import { RelayError } from "@/lib/errors";
import { factoryRequest } from "@/lib/myfactory";

export async function POST(request: Request) {
  try {
    if (!verifySameOrigin(request)) throw new RelayError("INVALID_CREDENTIAL", "Same-origin owner request required.", undefined, 403);
    const user = await requireApiUser();
    if (user.role !== "OWNER") throw new RelayError("CAPABILITY_DENIED", "Account owner required.", undefined, 403);
    const body = await request.text();
    if (body.length > 25000) throw new RelayError("INVALID_INPUT", "Factory request is too large.");
    const command = JSON.parse(body);
    if (!["create", "read"].includes(command.operation)) throw new RelayError("INVALID_INPUT", "Unsupported factory operation.");
    const result = await factoryRequest(user.accountId, command.operation, command.input);
    await recordActivity({ accountId: user.accountId, sessionId: `factory-owner:${randomUUID()}`, capability: `factory.workorder.${command.operation}`,
      action: `factory.workorder.${command.operation}`, status: "SUCCESS", durationMs: 0, provider: "MYFACTORY", resourceId: result.requestId });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
