import { z } from "zod";
import { errorResponse, requireApiUser } from "@/lib/api";
import { dashboardMemories } from "@/lib/memory";

const filtersSchema = z.object({
  query: z.string().max(200).optional(),
  type: z.enum(["FACT", "PREFERENCE", "PROJECT", "DECISION", "OTHER"]).optional(),
  scope: z.enum(["SHARED", "AGENT_PRIVATE"]).optional(),
  createdByAgentId: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const url = new URL(request.url);
    const filters = filtersSchema.parse(Object.fromEntries(url.searchParams));
    return Response.json({ memories: dashboardMemories(user.accountId, filters) });
  } catch (error) { return errorResponse(error); }
}
