import { z } from "zod";
import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { RelayError } from "@/lib/errors";
import { pauseComputer, takeComputerControl } from "@/lib/v2/computer-control";
import { operatorContext } from "@/lib/v2/dashboard";
const schema = z.object({ controlSessionId: z.string().regex(/^ccs_/), fenceToken: z.number().int().positive(), action: z.enum(["pause", "take-control"]) }).strict();
export async function POST(request: Request) { try { if (!verifySameOrigin(request)) throw new RelayError("INVALID_CREDENTIAL", "Cross-origin operator mutation denied.", undefined, 403); const user = await requireApiUser(); const operator = await operatorContext(user.accountId, user.id); const input = schema.parse(await request.json()); const base = { accountId: user.accountId, principalId: operator.principalId, controlSessionId: input.controlSessionId, expectedFenceToken: input.fenceToken }; return Response.json(input.action === "pause" ? await pauseComputer(base) : await takeComputerControl(base)); } catch (error) { return errorResponse(error); } }
