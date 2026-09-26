import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, withTransaction } from "@/lib/db";
import { accountMemberships, accounts, agentCredentials, agents, principals, userSessions, users } from "@/lib/db/schema";
import { hashPassword, hashSecret, verifyPassword } from "@/lib/crypto";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import type { AgentPrincipal, SessionUser } from "@/lib/types";

const SESSION_COOKIE = "relay_session";
const SESSION_SECONDS = 60 * 60 * 12;

export async function authenticateDashboardUser(email: string, password: string) {
  const [user] = await db().select({ id: users.id, accountId: users.accountId, email: users.email, name: users.name, role: users.role, passwordHash: users.passwordHash }).from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  return { id: user.id, accountId: user.accountId, email: user.email, name: user.name, role: user.role } satisfies SessionUser;
}

export function signupEnabled() {
  return process.env.RELAY_ALLOW_SIGNUP === "true" || process.env.NODE_ENV !== "production";
}

export function canIssueBetaInvites(user: SessionUser) {
  const adminEmail = process.env.RELAY_ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(adminEmail) && user.role === "OWNER" && user.email.toLowerCase() === adminEmail;
}

function inviteSecret() {
  const secret = process.env.RELAY_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Relay session secret is required for beta invitations.");
  return secret;
}

function inviteEmailDigest(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function readBetaInvite(token: string, email?: string) {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0].length > 512 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  const expected = createHmac("sha256", inviteSecret()).update(`relay-beta-invite-v1\0${parts[0]}`).digest();
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let value: unknown;
  try { value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return null; }
  if (!value || typeof value !== "object") return null;
  const invite = value as { emailDigest?: unknown; expiresAt?: unknown; nonce?: unknown };
  if (typeof invite.emailDigest !== "string" || !/^[0-9a-f]{64}$/.test(invite.emailDigest)
      || typeof invite.expiresAt !== "number" || !Number.isSafeInteger(invite.expiresAt) || invite.expiresAt <= Date.now()
      || typeof invite.nonce !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(invite.nonce)
      || (email && invite.emailDigest !== inviteEmailDigest(email))) return null;
  return { expiresAt: new Date(invite.expiresAt).toISOString() };
}

export async function issueBetaInvite(user: SessionUser, emailInput: string) {
  if (!canIssueBetaInvites(user)) throw new RelayError("INVALID_CREDENTIAL", "Beta invitation access required.", undefined, 403);
  const email = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new RelayError("INVALID_INPUT", "Enter a valid email address.");
  const [existing] = await db().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw new RelayError("INVALID_INPUT", "An account already exists for this email.", undefined, 409);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const payload = Buffer.from(JSON.stringify({ emailDigest: inviteEmailDigest(email), expiresAt: Date.parse(expiresAt), nonce: randomBytes(16).toString("base64url") })).toString("base64url");
  const signature = createHmac("sha256", inviteSecret()).update(`relay-beta-invite-v1\0${payload}`).digest("base64url");
  const token = `${payload}.${signature}`;
  return { token, email, expiresAt };
}

export async function lookupBetaInvite(token: string) {
  return readBetaInvite(token);
}

export async function createAccountOwner(input: { accountName: string; name: string; email: string; password: string; inviteToken?: string }): Promise<SessionUser> {
  if (!signupEnabled() && !input.inviteToken) throw new RelayError("INVALID_INPUT", "A beta invitation is required.", undefined, 403);
  const email = input.email.trim().toLowerCase();
  const accountName = input.accountName.trim();
  const name = input.name.trim();
  if (!accountName || !name || !email || input.password.length < 12) throw new RelayError("INVALID_INPUT", "Valid account, name, email, and a 12-character password are required.");
  if (!signupEnabled() && !readBetaInvite(input.inviteToken ?? "", email))
    throw new RelayError("INVALID_INPUT", "This invitation is invalid, expired, or already used.", undefined, 403);
  const existing = await db().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) throw new RelayError("INVALID_INPUT", "An account already exists for this email.", undefined, 409);
  const accountId = id("acct");
  const userId = id("usr");
  const timestamp = now();
  try {
    await withTransaction(async (transaction) => {
      if (!signupEnabled() && !readBetaInvite(input.inviteToken ?? "", email))
        throw new RelayError("INVALID_INPUT", "This invitation has expired.", undefined, 403);
      await transaction.insert(accounts).values({ id: accountId, name: accountName, createdAt: timestamp, updatedAt: timestamp });
      await transaction.insert(users).values({ id: userId, accountId, email, name, role: "OWNER", passwordHash: hashPassword(input.password), createdAt: timestamp });
      const principalId = id("prn");
      await transaction.insert(principals).values({ id: principalId, type: "HUMAN", userId, displayName: name, createdAt: timestamp, updatedAt: timestamp });
      await transaction.insert(accountMemberships).values({ accountId, principalId, role: "OWNER", createdAt: timestamp, updatedAt: timestamp });
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new RelayError("INVALID_INPUT", "An account already exists for this email.", undefined, 409);
    throw error;
  }
  return { id: userId, accountId, email, name, role: "OWNER" };
}

export async function createSession(user: SessionUser) {
  const token = randomBytes(32).toString("base64url");
  const timestamp = now();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await db().insert(userSessions).values({ id: id("ses"), accountId: user.accountId, userId: user.id, tokenHash: hashSecret(token), createdAt: timestamp, lastSeenAt: timestamp, expiresAt });
  return token;
}

export async function parseSession(value?: string): Promise<SessionUser | null> {
  if (!value) return null;
  const [session] = await db().select({ sessionId: userSessions.id, id: users.id, accountId: users.accountId, email: users.email, name: users.name, role: users.role }).from(userSessions).innerJoin(users, and(eq(users.id, userSessions.userId), eq(users.accountId, userSessions.accountId))).where(and(eq(userSessions.tokenHash, hashSecret(value)), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, now()))).limit(1);
  if (!session) return null;
  await db().update(userSessions).set({ lastSeenAt: now() }).where(eq(userSessions.id, session.sessionId));
  return { id: session.id, accountId: session.accountId, email: session.email, name: session.name, role: session.role };
}

export async function revokeSession(value?: string) {
  if (!value) return false;
  const revoked = await db().update(userSessions).set({ revokedAt: now() }).where(and(eq(userSessions.tokenHash, hashSecret(value)), isNull(userSessions.revokedAt))).returning({ id: userSessions.id });
  return revoked.length > 0;
}

export async function currentUser() {
  const store = await cookies();
  return await parseSession(store.get(sessionCookieName())?.value);
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export function sessionCookieName() {
  return process.env.NODE_ENV === "production" ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}

export function sessionMaxAge() {
  return SESSION_SECONDS;
}

export type AgentAuthResult =
  | { ok: true; principal: AgentPrincipal }
  | { ok: false; code: "INVALID_CREDENTIAL" | "REVOKED_CREDENTIAL"; principal?: AgentPrincipal };

export async function authenticateAgent(secret: string): Promise<AgentAuthResult> {
  const [row] = await db().select({ credentialId: agentCredentials.id, accountId: agentCredentials.accountId, agentId: agentCredentials.agentId, revokedAt: agentCredentials.revokedAt, expiresAt: agentCredentials.expiresAt, agentName: agents.name, status: agents.status }).from(agentCredentials).innerJoin(agents, and(eq(agents.id, agentCredentials.agentId), eq(agents.accountId, agentCredentials.accountId))).where(eq(agentCredentials.secretHash, hashSecret(secret))).limit(1);
  if (!row) return { ok: false, code: "INVALID_CREDENTIAL" };
  const principal = { credentialId: row.credentialId, agentId: row.agentId, accountId: row.accountId, agentName: row.agentName };
  if (row.revokedAt || row.status !== "ACTIVE" || (row.expiresAt && row.expiresAt <= now())) {
    return { ok: false, code: "REVOKED_CREDENTIAL", principal };
  }
  await db().update(agentCredentials).set({ lastUsedAt: now() }).where(eq(agentCredentials.id, row.credentialId));
  return { ok: true, principal };
}

export function verifySameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  return new URL(origin).host === new URL(request.url).host;
}
