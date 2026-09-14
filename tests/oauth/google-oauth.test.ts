import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createAccountOwner } from "@/lib/auth";
import { beginGoogleOAuth, completeGoogleOAuth } from "@/lib/connectors/google-oauth";
import { db } from "@/lib/db";
import { connectionCredentials, connections } from "@/lib/db/schema";
import { cleanupDatabase, freshDatabase } from "../helpers";

describe("Google OAuth", () => {
  beforeEach(async () => {
    await freshDatabase();
    process.env.GOOGLE_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "google-access-token", refresh_token: "google-refresh-token", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly" });
      if (url.endsWith("/profile")) return Response.json({ emailAddress: "owner@example.com" });
      throw new Error(`Unexpected Google URL: ${url}`);
    }));
  });
  afterEach(async () => { vi.unstubAllGlobals(); delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; await cleanupDatabase(); });

  it("binds state to the account/user, uses PKCE, and encrypts both tokens", async () => {
    const user = await createAccountOwner({ accountName: "Google Account", name: "Owner", email: "google@example.com", password: "google-password-long-enough" });
    const url = await beginGoogleOAuth(user, "http://relay.test");
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
    const state = url.searchParams.get("state")!;
    await completeGoogleOAuth(user, { code: "one-time-code", state });
    const [connection] = await db().select().from(connections).where(eq(connections.accountId, user.accountId));
    expect(connection).toMatchObject({ provider: "GOOGLE", status: "CONNECTED", externalAccountId: "owner@example.com" });
    const [credential] = await db().select().from(connectionCredentials);
    expect(credential.encryptedAccessToken).not.toContain("google-access-token");
    expect(credential.encryptedRefreshToken).not.toContain("google-refresh-token");
    await expect(completeGoogleOAuth(user, { code: "replay", state })).rejects.toThrow("invalid or expired");
  });

  it("rejects state tampering and cross-account completion", async () => {
    const first = await createAccountOwner({ accountName: "First", name: "First", email: "google-first@example.com", password: "first-password-long-enough" });
    const second = await createAccountOwner({ accountName: "Second", name: "Second", email: "google-second@example.com", password: "second-password-long-enough" });
    const url = await beginGoogleOAuth(first, "http://relay.test");
    await expect(completeGoogleOAuth(first, { code: "code", state: `${url.searchParams.get("state")}tampered` })).rejects.toThrow("invalid or expired");
    await expect(completeGoogleOAuth(second, { code: "code", state: url.searchParams.get("state")! })).rejects.toThrow("invalid or expired");
  });
});
