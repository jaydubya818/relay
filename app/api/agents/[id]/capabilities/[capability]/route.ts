import { z } from "zod";
import { setCapabilityGrant } from "@/lib/agents";
import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { CAPABILITIES } from "@/lib/types";

export async function PUT(request: Request, context: { params: Promise<{ id: string; capability: string }> }) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const user = await requireApiUser();
    const body = z.object({ effect: z.enum(["ALLOW", "DENY"]) }).parse(await request.json());
    const params = await context.params;
    const capability = z.enum(CAPABILITIES).parse(decodeURIComponent(params.capability));
    await setCapabilityGrant(user.accountId, params.id, capability, body.effect);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
