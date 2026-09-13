import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hashSecret, signSession, verifyPassword, verifySessionSignature } from "@/lib/crypto";
import { now } from "@/lib/ids";
import type { AgentPrincipal, SessionUser } from "@/lib/types";

const SESSION_COOKIE = "relay_session";
const SESSION_SECONDS = 60 * 60 * 12;

export function authenticateDashboardUser(email: string, password: string) {
  const user = db().prepare("SELECT id, account_id, email, name, password_hash FROM users WHERE lower(email) = lower(?)").get(email) as (SessionUser & { account_id: string; password_hash: string }) | undefined;
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return { id: user.id, accountId: user.account_id, email: user.email, name: user.name } satisfies SessionUser;
}

export function createSession(user: SessionUser) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = Buffer.from(JSON.stringify({ ...user, expiresAt })).toString("base64url");
  return `${payload}.${signSession(payload)}`;
}

export function parseSession(value?: string): SessionUser | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !verifySessionSignature(payload, signature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed.expiresAt !== "number" || parsed.expiresAt < Date.now() / 1000) return null;
    return { id: parsed.id, accountId: parsed.accountId, email: parsed.email, name: parsed.name };
  } catch {
    return null;
  }
}

export async function currentUser() {
  const store = await cookies();
  return parseSession(store.get(SESSION_COOKIE)?.value);
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export function sessionCookieName() {
  return SESSION_COOKIE;
}

export function sessionMaxAge() {
  return SESSION_SECONDS;
}

export type AgentAuthResult =
  | { ok: true; principal: AgentPrincipal }
  | { ok: false; code: "INVALID_CREDENTIAL" | "REVOKED_CREDENTIAL"; principal?: AgentPrincipal };

export function authenticateAgent(secret: string): AgentAuthResult {
  const row = db().prepare(`
    SELECT c.id credential_id, c.account_id, c.agent_id, c.revoked_at, c.expires_at, a.name agent_name, a.status
    FROM agent_credentials c JOIN agents a ON a.id = c.agent_id
    WHERE c.secret_hash = ?
  `).get(hashSecret(secret)) as any;
  if (!row) return { ok: false, code: "INVALID_CREDENTIAL" };
  const principal = { credentialId: row.credential_id, agentId: row.agent_id, accountId: row.account_id, agentName: row.agent_name };
  if (row.revoked_at || row.status !== "ACTIVE" || (row.expires_at && row.expires_at <= now())) {
    return { ok: false, code: "REVOKED_CREDENTIAL", principal };
  }
  db().prepare("UPDATE agent_credentials SET last_used_at = ? WHERE id = ?").run(now(), row.credential_id);
  return { ok: true, principal };
}

export function verifySameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  return new URL(origin).host === new URL(request.url).host;
}
