import { errorResponse } from "@/lib/api";
import { RelayError } from "@/lib/errors";
import { getDurableRuntimeAction } from "@/lib/v2/developer-platform";
import { requireV2PlatformBindings } from "@/lib/v2/platform-bindings";

function bearer(request: Request) { const value = request.headers.get("authorization"); if (!value?.startsWith("Bearer ")) throw new RelayError("INVALID_CREDENTIAL", "Bearer credential required.", undefined, 401); return value.slice(7); }
export async function GET(request: Request, context: { params: Promise<{ commandId: string }> }) { try { const { commandId } = await context.params; const bindings = requireV2PlatformBindings(); return Response.json(await getDurableRuntimeAction({ accountId: request.headers.get("x-relay-account-id") ?? "", runtimeCredential: bearer(request), expectedResource: new URL("/api/v2", request.url).toString(), taskId: new URL(request.url).searchParams.get("taskId") ?? "", commandId, oauthVerifier: bindings.oauthVerifier }), { headers: { "relay-api-version": "2026-09-13" } }); } catch (error) { return errorResponse(error); } }
