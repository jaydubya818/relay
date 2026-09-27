import { z } from "zod";
import { errorResponse, requireApiUser, verifySameOrigin } from "@/lib/api";
import { planDisposableBetaRetirement, retireDisposableBetaAccount } from "@/lib/beta-account-retirement";
import { RelayError } from "@/lib/errors";
import { requireV2PlatformBindings } from "@/lib/v2/platform-bindings";

const confirmationSchema = z.object({ accountId: z.string().min(1).max(255), confirmation: z.literal("RETIRE") }).strict();

export async function GET() {
  try {
    const user = await requireApiUser();
    if (user.role !== "OWNER") throw new RelayError("CAPABILITY_DENIED", "Account owner required.", undefined, 403);
    return Response.json(await planDisposableBetaRetirement(user.accountId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    if (!verifySameOrigin(request)) throw new RelayError("INVALID_CREDENTIAL", "Cross-origin account retirement denied.", undefined, 403);
    const user = await requireApiUser();
    if (user.role !== "OWNER") throw new RelayError("CAPABILITY_DENIED", "Account owner required.", undefined, 403);
    const input = confirmationSchema.parse(await request.json());
    if (input.accountId !== user.accountId) throw new RelayError("CAPABILITY_DENIED", "Account identity did not match.", undefined, 403);
    const { signer } = requireV2PlatformBindings();
    return Response.json(await retireDisposableBetaAccount({ accountId: user.accountId, ownerUserId: user.id, signer }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
