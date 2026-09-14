import { z } from "zod";
import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { dashboardAgent } from "@/lib/dashboard-agent";
import { executeCapability } from "@/lib/executor";

export async function DELETE(request: Request) { try { if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 }); const user = await requireApiUser(); const input = z.object({ agentId: z.string().min(1), browserSessionId: z.string().min(1) }).parse(await request.json()); const principal = await dashboardAgent(user, input.agentId); return Response.json(await executeCapability({ principal, capability: "browser.close", action: "browser.close", provider: "BROWSER", sessionId: `dashboard:${user.id}`, arguments: input })); } catch (error) { return errorResponse(error); } }
