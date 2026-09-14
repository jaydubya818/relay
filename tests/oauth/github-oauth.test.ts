import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountOwner } from "@/lib/auth";
import { beginGitHubOAuth, completeGitHubOAuth } from "@/lib/connectors/github-oauth";
import { listConnections } from "@/lib/connections";
import { db } from "@/lib/db";
import { connectionCredentials } from "@/lib/db/schema";
import { cleanupDatabase, freshDatabase } from "../helpers";

describe("GitHub OAuth", () => {
  beforeEach(async () => {
    await freshDatabase();
    process.env.GITHUB_CLIENT_ID = "github-client-id";
    process.env.GITHUB_CLIENT_SECRET = "github-client-secret";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/login/oauth/access_token")) {
        return Response.json({ access_token: "gho_test_access_token", scope: "repo,read:user", token_type: "bearer" });
      }
      if (url.endsWith("/user")) return Response.json({ id: 818, login: "relay-test", name: "Relay Test" });
      throw new Error(`Unexpected GitHub URL: ${url}`);
    }));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    await cleanupDatabase();
  });

  it("uses account-bound state and PKCE, then stores only encrypted tokens", async () => {
    const user = await createAccountOwner({ accountName: "OAuth Account", name: "Owner", email: "oauth@example.com", password: "oauth-password-long-enough" });
    const authorizationUrl = await beginGitHubOAuth(user, "http://relay.test");
    expect(authorizationUrl.origin).toBe("https://github.com");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();
    const state = authorizationUrl.searchParams.get("state")!;
    await completeGitHubOAuth(user, { code: "temporary-code", state });

    const [connection] = await listConnections(user.accountId);
    expect(connection).toMatchObject({ provider: "GITHUB", status: "CONNECTED", externalAccountId: "818", scopes: ["repo", "read:user"] });
    const [credential] = await db().select().from(connectionCredentials);
    expect(credential.encryptedAccessToken).not.toContain("gho_test_access_token");
    await expect(completeGitHubOAuth(user, { code: "replay", state })).rejects.toThrow("invalid or expired");
  });

  it("rejects an OAuth callback completed under another account", async () => {
    const first = await createAccountOwner({ accountName: "First", name: "First", email: "first-oauth@example.com", password: "first-password-long-enough" });
    const second = await createAccountOwner({ accountName: "Second", name: "Second", email: "second-oauth@example.com", password: "second-password-long-enough" });
    const authorizationUrl = await beginGitHubOAuth(first, "http://relay.test");
    await expect(completeGitHubOAuth(second, { code: "temporary-code", state: authorizationUrl.searchParams.get("state")! })).rejects.toThrow("invalid or expired");
  });
});
