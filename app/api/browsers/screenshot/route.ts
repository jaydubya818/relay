import { errorResponse, requireApiUser } from "@/lib/api";
import { dashboardAgent } from "@/lib/dashboard-agent";
import { executeCapability } from "@/lib/executor";

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const params = new URL(request.url).searchParams;
    const principal = await dashboardAgent(user, params.get("agentId") ?? "");
    const browserSessionId = params.get("browserSessionId") ?? "";
    const result = await executeCapability({ principal, capability: "browser.screenshot", action: "browser.screenshot", provider: "BROWSER", sessionId: `dashboard:${user.id}`, arguments: { browserSessionId } }) as { contentBase64: string };
    return new Response(Buffer.from(result.contentBase64, "base64"), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
