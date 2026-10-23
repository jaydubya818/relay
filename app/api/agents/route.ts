import { z } from "zod";
import { createAgent, listAgents } from "@/lib/agents";
import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { CAPABILITIES } from "@/lib/types";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(280).optional(),
  capabilities: z.array(z.enum(CAPABILITIES)).optional(),
});

export async function GET() {
  try {
    const user = await requireApiUser();
    return Response.json({ agents: await listAgents(user.accountId) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const user = await requireApiUser();
    const input = schema.parse(await request.json());
    return Response.json(await createAgent(user.accountId, input), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
