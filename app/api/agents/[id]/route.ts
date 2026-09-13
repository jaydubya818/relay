import { z } from "zod";
import { getAgent, updateAgentStatus } from "@/lib/agents";
import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    return Response.json({ agent: await getAgent(user.accountId, (await context.params).id) });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const user = await requireApiUser();
    const input = z.object({ status: z.enum(["ACTIVE", "DISABLED"]) }).parse(await request.json());
    await updateAgentStatus(user.accountId, (await context.params).id, input.status);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
