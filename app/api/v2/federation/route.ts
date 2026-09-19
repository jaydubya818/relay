import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { bearer, boundedBody, executeFederationCommand, federationBindings } from "@/lib/v2/federation/api";
export async function POST(request: Request) {
  try {
    const bindings = federationBindings();
    const result = await executeFederationCommand(bearer(request), await boundedBody(request), bindings);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ code: "INVALID_INPUT", message: "Invalid federation request." }, { status: 400 });
    return errorResponse(error);
  }
}
