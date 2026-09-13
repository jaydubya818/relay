import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { connectGoogle } from "@/lib/connections";
import { decryptSecret, encryptSecret, hashSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { oauthStates } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import type { SessionUser } from "@/lib/types";

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.readonly"];

function config() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new RelayError("CONNECTION_REQUIRED", "Google OAuth is not configured for this Relay deployment.", undefined, 503);
  return { clientId, clientSecret };
}

export async function beginGoogleOAuth(user: SessionUser, requestOrigin: string) {
  const { clientId } = config();
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const redirectUri = new URL("/api/connections/google/oauth/callback", process.env.NEXT_PUBLIC_RELAY_URL ?? requestOrigin).toString();
  await db().insert(oauthStates).values({ id: id("oauth"), stateHash: hashSecret(state), accountId: user.accountId, userId: user.id, provider: "GOOGLE", encryptedCodeVerifier: encryptSecret(verifier), redirectUri, createdAt: now(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  for (const [key, value] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(" "), state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", access_type: "offline", include_granted_scopes: "true", prompt: "consent" })) url.searchParams.set(key, value);
  return url;
}

export async function completeGoogleOAuth(user: SessionUser, input: { code: string; state: string }) {
  const { clientId, clientSecret } = config();
  const consumedAt = now();
  const [record] = await db().update(oauthStates).set({ consumedAt }).where(and(eq(oauthStates.stateHash, hashSecret(input.state)), eq(oauthStates.accountId, user.accountId), eq(oauthStates.userId, user.id), eq(oauthStates.provider, "GOOGLE"), isNull(oauthStates.consumedAt), gt(oauthStates.expiresAt, consumedAt))).returning({ verifier: oauthStates.encryptedCodeVerifier, redirectUri: oauthStates.redirectUri });
  if (!record) throw new RelayError("INVALID_INPUT", "Google OAuth state is invalid or expired.", undefined, 400);
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: input.code, redirect_uri: record.redirectUri, code_verifier: decryptSecret(record.verifier), grant_type: "authorization_code" }), cache: "no-store" });
  const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string };
  if (!response.ok || !result.access_token) throw new RelayError("PROVIDER_ERROR", result.error_description ?? "Google OAuth token exchange failed.", undefined, 502);
  return connectGoogle(user.accountId, result.access_token, { refreshToken: result.refresh_token, expiresAt: new Date(Date.now() + Number(result.expires_in ?? 3600) * 1000).toISOString(), scopes: result.scope?.split(" ").filter(Boolean) ?? SCOPES });
}
