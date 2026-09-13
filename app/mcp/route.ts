import { randomUUID } from "node:crypto";
import { RelayError } from "@/lib/errors";
import { handleMcp } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rpcError(id: unknown, error: unknown) {
  const relayError = error instanceof RelayError ? error : new RelayError("INTERNAL_ERROR", "Relay could not complete the MCP request.", undefined, 500);
  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code: relayError.status === 401 ? -32001 : relayError.status === 403 ? -32003 : -32000, message: relayError.message, data: relayError.toJSON() },
  }, { status: relayError.status === 401 ? 401 : 200 });
}

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  let body: any;
  try {
    body = await request.json();
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) throw new RelayError("INVALID_CREDENTIAL", "Use Authorization: Bearer <Relay credential>.", undefined, 401);
    const result = await handleMcp(authorization.slice(7), body, requestId);
    return Response.json({ jsonrpc: "2.0", id: body.id ?? null, result }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    return rpcError(body?.id, error);
  }
}

export function GET() {
  return Response.json({ name: "Relay MCP", transport: "Streamable HTTP", endpoint: "/mcp" });
}
