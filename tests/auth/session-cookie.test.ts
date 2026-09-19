import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupDatabase, freshDatabase } from "../helpers";

const cookieValue = vi.hoisted(() => ({ current: undefined as string | undefined }));
const cookieGet = vi.hoisted(() => vi.fn((name: string) => name === "__Host-relay_session" && cookieValue.current ? { value: cookieValue.current } : undefined));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookieGet }) }));

import { createAccountOwner, createSession, currentUser } from "@/lib/auth";

describe("production dashboard session cookie", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    cookieGet.mockClear();
    cookieValue.current = undefined;
    await cleanupDatabase();
  });

  it("reads the same __Host- cookie name that production login writes", async () => {
    await freshDatabase();
    const owner = await createAccountOwner({ accountName: "Cookie Test", name: "Owner", email: "cookie@example.com", password: "cookie-password-strong" });
    cookieValue.current = await createSession(owner);
    vi.stubEnv("NODE_ENV", "production");

    await expect(currentUser()).resolves.toMatchObject({ id: owner.id, accountId: owner.accountId });
    expect(cookieGet).toHaveBeenCalledWith("__Host-relay_session");
  });
});
