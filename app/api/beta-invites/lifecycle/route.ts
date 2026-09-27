import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { betaInvites } from "@/lib/db/schema";
import { hashSecret } from "@/lib/crypto";
import { planDisposableBetaRetirement } from "@/lib/beta-account-retirement";
import { errorResponse } from "@/lib/api";

const schema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

/** Bearer-link readback for the exact managed invitation; no owner cookie or token in a URL. */
export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Invitation unavailable." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const [invite] = await db().select({ id: betaInvites.id, consumedAt: betaInvites.consumedAt, revokedAt: betaInvites.revokedAt, expiresAt: betaInvites.expiresAt, acceptedAccountId: betaInvites.acceptedAccountId })
      .from(betaInvites).where(eq(betaInvites.tokenHash, hashSecret(parsed.data.token))).limit(1);
    if (!invite) return Response.json({ error: "Invitation unavailable." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const state = invite.revokedAt ? "REVOKED" : invite.consumedAt ? "ACCEPTED" : Date.parse(invite.expiresAt) <= Date.now() ? "EXPIRED" : "PENDING";
    const plan = invite.acceptedAccountId ? await planDisposableBetaRetirement(invite.acceptedAccountId) : null;
    return Response.json({ invitationId: invite.id, state, accountId: invite.acceptedAccountId, accountState: plan?.state ?? null,
      activeSessions: plan?.activeSessions ?? 0, activeCredentials: plan?.activeCredentials ?? 0,
      activeAgentIdentities: plan?.activeAgentIdentities ?? 0, activeDelegations: plan?.activeDelegations ?? 0,
      activeGrants: plan?.activeGrants ?? 0, queuedDeliveries: plan?.queuedDeliveries ?? 0,
      publishedKnowledge: plan?.publishedKnowledge ?? 0, privateDataObjects: plan?.privateDataObjects ?? 0 },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
