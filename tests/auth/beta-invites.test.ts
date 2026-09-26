import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountOwner, issueBetaInvite, lookupBetaInvite } from "@/lib/auth";
import { cleanupDatabase, freshDatabase } from "../helpers";

describe("private beta invitations", () => {
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await cleanupDatabase(); });

  it("requires an allowlisted owner and consumes an email-bound invitation once", async () => {
    const { accountId, userId } = await freshDatabase();
    const operator = { accountId, id: userId, email: "operator@example.com", name: "Operator", role: "OWNER" as const };
    vi.stubEnv("RELAY_ADMIN_EMAIL", "operator@example.com");
    const { token } = await issueBetaInvite(operator, " Tester@Example.com ");
    expect(await lookupBetaInvite(token)).toMatchObject({ expiresAt: expect.any(String) });
    vi.stubEnv("NODE_ENV", "production");
    await expect(createAccountOwner({ accountName: "Wrong", name: "Wrong", email: "wrong@example.com", password: "wrong-password-long", inviteToken: token })).rejects.toMatchObject({ status: 403 });
    const owner = await createAccountOwner({ accountName: "Tester", name: "Tester", email: "TESTER@example.com", password: "tester-password-long", inviteToken: token });
    expect(owner.email).toBe("tester@example.com");
    await expect(createAccountOwner({ accountName: "Replay", name: "Replay", email: "tester@example.com", password: "tester-password-long", inviteToken: token })).rejects.toMatchObject({ status: 409 });
    expect(await lookupBetaInvite(`${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`)).toBeNull();
  });

  it("refuses an expired invitation and an unlisted issuer", async () => {
    const { accountId, userId } = await freshDatabase();
    const operator = { accountId, id: userId, email: "operator@example.com", name: "Operator", role: "OWNER" as const };
    await expect(issueBetaInvite(operator, "tester@example.com")).rejects.toMatchObject({ status: 403 });
    vi.stubEnv("RELAY_ADMIN_EMAIL", "operator@example.com");
    const { token } = await issueBetaInvite(operator, "tester@example.com");
    const issuedAt = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(issuedAt + 49 * 60 * 60 * 1000);
    vi.stubEnv("NODE_ENV", "production");
    expect(await lookupBetaInvite(token)).toBeNull();
    await expect(createAccountOwner({ accountName: "Tester", name: "Tester", email: "tester@example.com", password: "tester-password-long", inviteToken: token })).rejects.toMatchObject({ status: 403 });
  });
});
