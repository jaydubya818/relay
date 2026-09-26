import { z } from "zod";
import { requireApiUser, errorResponse, verifySameOrigin } from "@/lib/api";
import { issueBetaInvite } from "@/lib/auth";

const schema = z.object({ email: z.string().trim().email().max(254) });

export async function POST(request: Request) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const user = await requireApiUser();
    const { email } = schema.parse(await request.json());
    const invite = await issueBetaInvite(user, email);
    const configuredOrigin = process.env.NEXT_PUBLIC_RELAY_URL ?? process.env.RELAY_ISSUER_URL;
    const origin = new URL(configuredOrigin ?? request.headers.get("origin") ?? request.url).origin;
    if (process.env.NODE_ENV === "production" && !configuredOrigin) throw new Error("A canonical Relay URL is required to issue beta invitations.");
    return Response.json({ url: `${origin}/signup?invite=${encodeURIComponent(invite.token)}`, email: invite.email, expiresAt: invite.expiresAt }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
