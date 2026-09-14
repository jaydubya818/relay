import { errorResponse } from "@/lib/api";
import { RelayError } from "@/lib/errors";
import { submitDurableRuntimeAction } from "@/lib/v2/developer-platform";
import { requireRuntimeActionsEnabled } from "@/lib/v2/deployment";
import { requireV2PlatformBindings } from "@/lib/v2/platform-bindings";

function bearer(request: Request) { const value = request.headers.get("authorization"); if (!value?.startsWith("Bearer ")) throw new RelayError("INVALID_CREDENTIAL", "Bearer credential required.", undefined, 401); return value.slice(7); }
export async function POST(request: Request) { try { const body = await request.json(); const accountId = request.headers.get("x-relay-account-id") ?? ""; const runtimeCredential = bearer(request); requireRuntimeActionsEnabled(); const bindings = requireV2PlatformBindings(); const result = await submitDurableRuntimeAction({ accountId, runtimeCredential, expectedResource: new URL("/api/v2", request.url).toString(), action: body.action, leaseToken: request.headers.get("x-relay-lease") ?? "", expectedAudience: request.headers.get("x-relay-audience") ?? "relay-api", workloadId: request.headers.get("x-relay-workload-id") ?? "", idempotencyKey: request.headers.get("idempotency-key") ?? body.idempotencyKey ?? "", oauthVerifier: bindings.oauthVerifier }, bindings.signer, bindings.keyResolver); return Response.json(result, { status: result.idempotentReplay ? 200 : 202, headers: { "relay-api-version": "2026-09-13", location: `/api/v2/runtime/actions/${result.commandId}?taskId=${result.taskId}` } }); } catch (error) { return errorResponse(error); } }
