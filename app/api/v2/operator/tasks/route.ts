import { z } from "zod";
import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { RelayError } from "@/lib/errors";
import { operatorContext } from "@/lib/v2/dashboard";
import { cancelTask } from "@/lib/v2/orchestration";
import { requireV2PlatformBindings } from "@/lib/v2/platform-bindings";
const schema = z.object({ taskId: z.string().regex(/^tsk_/), reason: z.string().min(3).max(500) }).strict();
export async function POST(request: Request) { try { if (!verifySameOrigin(request)) throw new RelayError("INVALID_CREDENTIAL", "Cross-origin operator mutation denied.", undefined, 403); const user = await requireApiUser(); const operator = await operatorContext(user.accountId, user.id); const input = schema.parse(await request.json()); const gateway = { startWorkflow: async () => ({ runId: "not-used" }), cancelWorkflow: async () => { throw new Error("Temporal cancellation delivery pending"); } }; return Response.json(await cancelTask({ accountId: user.accountId, actorPrincipalId: operator.principalId, taskId: input.taskId, reason: input.reason }, gateway, requireV2PlatformBindings().signer)); } catch (error) { return errorResponse(error); } }
