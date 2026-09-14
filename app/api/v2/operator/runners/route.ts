import { z } from "zod";
import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { RelayError } from "@/lib/errors";
import { operatorContext } from "@/lib/v2/dashboard";
import { requireV2PlatformBindings } from "@/lib/v2/platform-bindings";
import { revokeRunner } from "@/lib/v2/runners";
const schema = z.object({ runnerId: z.string().regex(/^run_/), reason: z.string().min(3).max(500) }).strict();
export async function POST(request: Request) { try { if (!verifySameOrigin(request)) throw new RelayError("INVALID_CREDENTIAL", "Cross-origin operator mutation denied.", undefined, 403); const user = await requireApiUser(); const operator = await operatorContext(user.accountId, user.id); const input = schema.parse(await request.json()); return Response.json({ revoked: await revokeRunner({ accountId: user.accountId, principalId: operator.principalId, runnerId: input.runnerId, reason: input.reason }, requireV2PlatformBindings().signer) }); } catch (error) { return errorResponse(error); } }
