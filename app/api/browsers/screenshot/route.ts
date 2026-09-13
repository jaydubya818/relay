import { errorResponse, requireApiUser } from "@/lib/api";
import { dashboardAgent } from "@/lib/dashboard-agent";
import { screenshotBrowser } from "@/lib/browsers";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const params = new URL(request.url).searchParams;
    const principal = await dashboardAgent(user, params.get("agentId") ?? "");
    const result = await screenshotBrowser(principal, params.get("browserSessionId") ?? "");
    return new Response(Buffer.from(result.contentBase64, "base64"), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
