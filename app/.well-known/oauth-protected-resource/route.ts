import { protectedResourceMetadata } from "@/lib/v2/developer-platform";
export function GET(request: Request) { const servers = (process.env.RELAY_AUTHORIZATION_SERVERS ?? "").split(",").filter(Boolean); if (!servers.length) return Response.json({ code: "CONNECTION_REQUIRED", message: "OAuth authorization server is not configured." }, { status: 503 }); return Response.json(protectedResourceMetadata(new URL("/api/v2/mcp", request.url).toString(), servers)); }

