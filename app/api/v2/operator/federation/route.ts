import { withQualificationSigningAuthority } from "@/lib/v2/evidence/qualification-admission";
import { z } from "zod";
import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { RelayError } from "@/lib/errors";
import { operatorContext } from "@/lib/v2/dashboard";
import { boundedBody, federationBindings } from "@/lib/v2/federation/api";
import { createFederationGrant, invalidatePublicationReference, publishView, registerFederationAgent, revokeFederationGrant, setAvailability, setPublicationStatus, setRelationship } from "@/lib/v2/federation/registry";
const schema = z.object({ operation: z.enum(["register", "publish", "grant", "revoke-grant", "availability", "publication-status", "invalidate-reference", "relationship"]), id: z.string().max(255).optional(), input: z.unknown().optional() }).strict();
export async function POST(request: Request) {
  try {
    if (!verifySameOrigin(request)) throw new RelayError("INVALID_CREDENTIAL", "Cross-origin owner mutation denied.", undefined, 403);
    const user = await requireApiUser();
    const operator = await operatorContext(user.accountId, user.id);
    const actor = { accountId: user.accountId, principalId: operator.principalId };
    const { signer } = federationBindings();
    const command = schema.parse(await boundedBody(request));
    const result=await withQualificationSigningAuthority({rootOperation:request.headers.get('x-fq-operation')??'',requestId:command.id??request.headers.get('x-fq-operation')??'',accountId:actor.accountId,agentId:null,operation:command.operation},async()=>{
    let result: unknown;
    switch (command.operation) {
      case "register": result = await registerFederationAgent(actor, command.input, signer); break;
      case "publish": result = await publishView(actor, command.input, signer); break;
      case "grant": result = await createFederationGrant(actor, command.input, signer); break;
      case "revoke-grant": result = await revokeFederationGrant(actor, command.id ?? "", signer); break;
      case "availability": result = await setAvailability(actor, command.id ?? "", command.input, signer); break;
      case "publication-status": result = await setPublicationStatus(actor, command.id ?? "", command.input, signer); break;
      case "invalidate-reference": result = await invalidatePublicationReference(actor, command.id ?? "", signer); break;
      case "relationship": result = await setRelationship(actor, command.id ?? "", command.input, signer); break;
    }
    return result;
    });
    return Response.json(result ?? { success: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) { if (error instanceof z.ZodError) return Response.json({ code: "INVALID_INPUT" }, { status: 400 }); return errorResponse(error); }
}
