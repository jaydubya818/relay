import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountOwner, issueBetaInvite, lookupBetaInvite } from "@/lib/auth";
import { betaInvites } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { eq } from "drizzle-orm";
import { cleanupDatabase, freshDatabase } from "../helpers";

describe("private beta invitations", () => {
  afterEach(async () => { vi.unstubAllEnvs(); await cleanupDatabase(); });

  it("requires an allowlisted owner and consumes an email-bound invitation once", async () => {
    const { accountId, userId } = await freshDatabase();
    const operator = { accountId, id: userId, email: "operator@example.com", name: "Operator", role: "OWNER" as const };
    vi.stubEnv("RELAY_BETA_INVITER_EMAILS", "operator@example.com");
    const { token } = await issueBetaInvite(operator, " Tester@Example.com ");
    expect(await db().select({ accountId: betaInvites.accountId }).from(betaInvites)).toEqual([{ accountId }]);
    expect(await lookupBetaInvite(token)).toMatchObject({ email: "tester@example.com" });
    vi.stubEnv("NODE_ENV", "production");
    await expect(createAccountOwner({ accountName: "Wrong", name: "Wrong", email: "wrong@example.com", password: "wrong-password-long", inviteToken: token })).rejects.toMatchObject({ status: 403 });
    const owner = await createAccountOwner({ accountName: "Tester", name: "Tester", email: "TESTER@example.com", password: "tester-password-long", inviteToken: token });
    expect(owner.email).toBe("tester@example.com");
    expect(await lookupBetaInvite(token)).toBeNull();
    await expect(createAccountOwner({ accountName: "Replay", name: "Replay", email: "tester@example.com", password: "tester-password-long", inviteToken: token })).rejects.toMatchObject({ status: 409 });
  });

  it("refuses an expired invitation and an unlisted issuer", async () => {
    const { accountId, userId } = await freshDatabase();
    const operator = { accountId, id: userId, email: "operator@example.com", name: "Operator", role: "OWNER" as const };
    await expect(issueBetaInvite(operator, "tester@example.com")).rejects.toMatchObject({ status: 403 });
    vi.stubEnv("RELAY_BETA_INVITER_EMAILS", "operator@example.com");
    const { token } = await issueBetaInvite(operator, "tester@example.com");
    await db().update(betaInvites).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(betaInvites.email, "tester@example.com"));
    vi.stubEnv("NODE_ENV", "production");
    expect(await lookupBetaInvite(token)).toBeNull();
    await expect(createAccountOwner({ accountName: "Tester", name: "Tester", email: "tester@example.com", password: "tester-password-long", inviteToken: token })).rejects.toMatchObject({ status: 403 });
  });
});
