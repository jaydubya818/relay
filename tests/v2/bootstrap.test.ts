import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { verifyPassword } from "@/lib/crypto";
import { db } from "@/lib/db";
import { accounts, principals, users } from "@/lib/db/schema";
import { bootstrapPrivatePreviewOwner } from "@/lib/v2/bootstrap";
import { cleanupDatabase, freshDatabase } from "@/tests/helpers";

const input = {
  accountName: "Relay Private Preview",
  name: "Relay Owner",
  email: "OWNER@example.com",
  password: "correct-horse-battery-staple",
};

describe("private-preview owner bootstrap", () => {
  beforeEach(async () => {
    await freshDatabase();
    await db().delete(accounts);
    process.env.RELAY_DEPLOYMENT_MODE = "private-preview";
  });

  afterEach(async () => {
    delete process.env.RELAY_DEPLOYMENT_MODE;
    await cleanupDatabase();
  });

  it("creates only the owner identity in an empty database", async () => {
    const result = await bootstrapPrivatePreviewOwner(input);
    expect(result).toMatchObject({ created: true, email: "owner@example.com" });
    expect(await db().select().from(accounts)).toHaveLength(1);
    expect(await db().select().from(users)).toHaveLength(1);
    expect(await db().select().from(principals)).toHaveLength(1);
  });

  it("is idempotent and does not reset the existing password", async () => {
    const first = await bootstrapPrivatePreviewOwner(input);
    const [before] = await db().select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, first.userId));
    const second = await bootstrapPrivatePreviewOwner({ ...input, password: "a-different-password-that-is-long" });
    const [after] = await db().select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, first.userId));
    expect(second).toEqual({ ...first, created: false });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(verifyPassword(input.password, after.passwordHash)).toBe(true);
  });

  it("fails closed on unexpected existing tenant state", async () => {
    await bootstrapPrivatePreviewOwner(input);
    await expect(bootstrapPrivatePreviewOwner({ ...input, accountName: "Another Account" })).rejects.toThrow("does not exactly match");
  });

  it("cannot run outside private-preview mode", async () => {
    process.env.RELAY_DEPLOYMENT_MODE = "production";
    await expect(bootstrapPrivatePreviewOwner(input)).rejects.toThrow("restricted");
  });
});
