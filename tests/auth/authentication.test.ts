import { afterEach, describe, expect, it } from "vitest";
import { authenticateDashboardUser, createAccountOwner, createSession, parseSession, revokeSession } from "@/lib/auth";
import { cleanupDatabase, freshDatabase } from "../helpers";

describe("production dashboard authentication", () => {
  afterEach(cleanupDatabase);

  it("creates isolated account owners and authenticates normalized email", async () => {
    await freshDatabase();
    const first = await createAccountOwner({ accountName: "First", name: "First Owner", email: "FIRST@example.com", password: "first-password-strong" });
    const second = await createAccountOwner({ accountName: "Second", name: "Second Owner", email: "second@example.com", password: "second-password-strong" });
    expect(first.role).toBe("OWNER");
    expect(second.accountId).not.toBe(first.accountId);
    await expect(authenticateDashboardUser("first@example.com", "first-password-strong")).resolves.toMatchObject({ accountId: first.accountId, role: "OWNER" });
    await expect(authenticateDashboardUser("first@example.com", "wrong-password")).resolves.toBeNull();
  });

  it("uses opaque durable sessions and revokes them on logout", async () => {
    await freshDatabase();
    const user = await createAccountOwner({ accountName: "Session Test", name: "Owner", email: "session@example.com", password: "session-password-strong" });
    const token = await createSession(user);
    expect(token).not.toContain(user.id);
    await expect(parseSession(token)).resolves.toMatchObject({ id: user.id, accountId: user.accountId });
    await expect(revokeSession(token)).resolves.toBe(true);
    await expect(parseSession(token)).resolves.toBeNull();
  });

  it("rejects duplicate email ownership", async () => {
    await freshDatabase();
    await createAccountOwner({ accountName: "First", name: "Owner", email: "owner@example.com", password: "owner-password-strong" });
    await expect(createAccountOwner({ accountName: "Second", name: "Other", email: "OWNER@example.com", password: "other-password-strong" })).rejects.toMatchObject({ status: 409 });
  });
});
