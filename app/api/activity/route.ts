import { errorResponse, requireApiUser } from "@/lib/api";
import { listActivity } from "@/lib/activity";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const params = new URL(request.url).searchParams;
    return Response.json({ activity: listActivity(user.accountId, {
      agentId: params.get("agentId") ?? undefined,
      capability: params.get("capability") ?? undefined,
      status: params.get("status") ?? undefined,
      provider: params.get("provider") ?? undefined,
    }) });
  } catch (error) { return errorResponse(error); }
}
