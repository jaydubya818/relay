import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { connectGitHub } from "@/lib/connections";
import { encryptSecret, decryptSecret, hashSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { oauthStates } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import type { SessionUser } from "@/lib/types";

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const STATE_TTL_MS = 10 * 60 * 1000;

function config() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new RelayError("CONNECTION_REQUIRED", "GitHub OAuth is not configured for this Relay deployment.", undefined, 503);
  return { clientId, clientSecret };
}

function challenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function beginGitHubOAuth(user: SessionUser, requestOrigin: string) {
  const { clientId } = config();
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const baseUrl = process.env.NEXT_PUBLIC_RELAY_URL ?? requestOrigin;
  const redirectUri = new URL("/api/connections/github/oauth/callback", baseUrl).toString();
  const scopes = (process.env.GITHUB_OAUTH_SCOPES ?? "repo read:user").split(/[ ,]+/).filter(Boolean);
  await db().insert(oauthStates).values({
    id: id("oauth"), stateHash: hashSecret(state), accountId: user.accountId, userId: user.id,
    provider: "GITHUB", encryptedCodeVerifier: encryptSecret(verifier), redirectUri,
    createdAt: now(), expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

export async function completeGitHubOAuth(user: SessionUser, input: { code: string; state: string }) {
  const { clientId, clientSecret } = config();
  const consumedAt = now();
  const [record] = await db().update(oauthStates).set({ consumedAt }).where(and(
    eq(oauthStates.stateHash, hashSecret(input.state)), eq(oauthStates.accountId, user.accountId),
    eq(oauthStates.userId, user.id), eq(oauthStates.provider, "GITHUB"),
    isNull(oauthStates.consumedAt), gt(oauthStates.expiresAt, consumedAt),
  )).returning({ verifier: oauthStates.encryptedCodeVerifier, redirectUri: oauthStates.redirectUri });
  if (!record) throw new RelayError("INVALID_INPUT", "GitHub OAuth state is invalid or expired.", undefined, 400);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: input.code, redirect_uri: record.redirectUri, code_verifier: decryptSecret(record.verifier) }),
    cache: "no-store",
  });
  const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (!response.ok || !result.access_token) throw new RelayError("PROVIDER_ERROR", result.error_description ?? result.error ?? "GitHub OAuth token exchange failed.", undefined, 502);
  const expiresAt = result.expires_in ? new Date(Date.now() + result.expires_in * 1000).toISOString() : undefined;
  return connectGitHub(user.accountId, result.access_token, { refreshToken: result.refresh_token, expiresAt, scopes: result.scope?.split(",").filter(Boolean) ?? [] });
}
