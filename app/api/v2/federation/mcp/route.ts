import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { bearer, boundedBody, federationBindings } from "@/lib/v2/federation/api";
import { handleFederationMcp } from "@/lib/v2/federation/mcp";
export async function POST(request: Request) {
  try {
    const bindings = federationBindings();
    const result = await handleFederationMcp(bearer(request), await boundedBody(request), bindings);
    return result === null ? new Response(null, { status: 202 }) : Response.json(result, { headers: { "cache-control": "no-store" } });
  }
  catch (error) { if (error instanceof z.ZodError) return Response.json({ code: "INVALID_INPUT" }, { status: 400 }); return errorResponse(error); }
}
