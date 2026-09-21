import { qualificationEnabled } from "@/lib/qualification";
import { withQualificationSigningAuthority } from "@/lib/v2/evidence/qualification-admission";
import { authenticateFederationAgent } from "@/lib/v2/federation/service";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { bearer, boundedBody, executeFederationCommand, federationBindings } from "@/lib/v2/federation/api";
export async function POST(request: Request) {
  try {
    const bindings = federationBindings();
    const secret=bearer(request),command=await boundedBody(request);
    const execute=()=>executeFederationCommand(secret,command,bindings);
    const actor=qualificationEnabled()?await authenticateFederationAgent(secret):undefined;
    const result=actor?await withQualificationSigningAuthority({rootOperation:request.headers.get('x-fq-operation')??'',requestId:command.requestId??request.headers.get('x-fq-operation')??'',accountId:actor.ownerId,agentId:actor.agentId,operation:command.operation},execute):await execute();
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ code: "INVALID_INPUT", message: "Invalid federation request." }, { status: 400 });
    return errorResponse(error);
  }
}
