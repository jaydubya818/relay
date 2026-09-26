import { z } from "zod";
import { errorResponse, verifySameOrigin } from "@/lib/api";
import { lookupBetaInvite } from "@/lib/auth";

const schema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

export async function POST(request: Request) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Invitation unavailable." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const { token } = parsed.data;
    const invite = await lookupBetaInvite(token);
    return Response.json(invite ?? { error: "Invitation unavailable." }, {
      status: invite ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
