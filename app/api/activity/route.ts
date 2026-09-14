import { errorResponse, requireApiUser } from "@/lib/api";
import { listActivity } from "@/lib/activity";
import type { ActivityStatus } from "@/lib/types";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const params = new URL(request.url).searchParams;
    return Response.json({ activity: await listActivity(user.accountId, {
      agentId: params.get("agentId") ?? undefined,
      capability: params.get("capability") ?? undefined,
      status: (params.get("status") ?? undefined) as ActivityStatus | undefined,
      provider: params.get("provider") ?? undefined,
    }) });
  } catch (error) { return errorResponse(error); }
}
