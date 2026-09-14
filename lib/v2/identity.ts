import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db, withTransaction } from "@/lib/db";
import { accountMemberships, principals, serviceClients, stepUpChallenges, users, userSessions } from "@/lib/db/schema";
import { hashSecret, verifyPassword } from "@/lib/crypto";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";

export const MEMBERSHIP_ROLES = ["OWNER", "ADMIN", "OPERATOR", "APPROVER", "MEMBER", "AUDITOR"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const ROLE_PERMISSIONS: Readonly<Record<MembershipRole, readonly string[]>> = {
  OWNER: ["account.manage", "members.manage", "agents.manage", "policies.manage", "approvals.decide", "operations.manage", "audit.read"],
  ADMIN: ["members.manage", "agents.manage", "policies.manage", "approvals.decide", "operations.manage", "audit.read"],
  OPERATOR: ["agents.manage", "approvals.decide", "operations.manage", "audit.read"],
  APPROVER: ["approvals.decide", "audit.read"],
  MEMBER: ["agents.use", "activity.read"],
  AUDITOR: ["audit.read"],
};

export async function createHumanPrincipal(input: { accountId: string; userId: string; displayName: string; role: MembershipRole }) {
  const principalId = id("prn");
  const timestamp = now();
  await withTransaction(async (transaction) => {
    await transaction.insert(principals).values({ id: principalId, type: "HUMAN", userId: input.userId, displayName: input.displayName, createdAt: timestamp, updatedAt: timestamp });
    await transaction.insert(accountMemberships).values({ accountId: input.accountId, principalId, role: input.role, createdAt: timestamp, updatedAt: timestamp });
  });
  return { principalId, accountId: input.accountId, role: input.role };
}

export async function createServicePrincipal(input: { accountId: string; displayName: string; role: Exclude<MembershipRole, "OWNER">; expiresAt?: string }) {
  const principalId = id("prn");
  const clientId = id("svc");
  const secret = `rsvc_${randomBytes(24).toString("base64url")}`;
  const timestamp = now();
  await withTransaction(async (transaction) => {
    await transaction.insert(principals).values({ id: principalId, type: "SERVICE", displayName: input.displayName, createdAt: timestamp, updatedAt: timestamp });
    await transaction.insert(accountMemberships).values({ accountId: input.accountId, principalId, role: input.role, createdAt: timestamp, updatedAt: timestamp });
    await transaction.insert(serviceClients).values({ id: clientId, principalId, name: input.displayName, secretHash: hashSecret(secret), prefix: secret.slice(0, 13), expiresAt: input.expiresAt, createdAt: timestamp });
  });
  return { principalId, clientId, secret };
}

export async function authenticateServiceClient(secret: string, accountId: string) {
  const timestamp = now();
  const [client] = await db().select({ clientId: serviceClients.id, principalId: serviceClients.principalId, revokedAt: serviceClients.revokedAt, expiresAt: serviceClients.expiresAt }).from(serviceClients).innerJoin(principals, and(eq(principals.id, serviceClients.principalId), eq(principals.status, "ACTIVE"))).innerJoin(accountMemberships, and(eq(accountMemberships.principalId, serviceClients.principalId), eq(accountMemberships.accountId, accountId), eq(accountMemberships.status, "ACTIVE"))).where(eq(serviceClients.secretHash, hashSecret(secret))).limit(1);
  if (!client || client.revokedAt || (client.expiresAt && client.expiresAt <= timestamp)) {
    throw new RelayError("INVALID_CREDENTIAL", "Service client credential is invalid or unavailable.", undefined, 401);
  }
  await db().update(serviceClients).set({ lastUsedAt: timestamp }).where(eq(serviceClients.id, client.clientId));
  return await requireMembership({ accountId, principalId: client.principalId });
}

export async function requireMembership(input: { accountId: string; principalId: string; allowedRoles?: readonly MembershipRole[] }) {
  const conditions = [eq(accountMemberships.accountId, input.accountId), eq(accountMemberships.principalId, input.principalId), eq(accountMemberships.status, "ACTIVE"), eq(principals.status, "ACTIVE")];
  if (input.allowedRoles?.length) conditions.push(inArray(accountMemberships.role, [...input.allowedRoles]));
  const [membership] = await db().select({ accountId: accountMemberships.accountId, principalId: accountMemberships.principalId, role: accountMemberships.role, type: principals.type, displayName: principals.displayName }).from(accountMemberships).innerJoin(principals, eq(principals.id, accountMemberships.principalId)).where(and(...conditions)).limit(1);
  if (!membership) throw new RelayError("CAPABILITY_DENIED", "Active account membership with the required role was not found.", undefined, 403);
  return membership;
}

export async function createStepUpChallenge(input: { accountId: string; principalId: string; actionClass: string; actionHash?: string; authenticationMethod: "password" | "webauthn" | "oidc_acr"; ttlSeconds?: number }) {
  await requireMembership({ accountId: input.accountId, principalId: input.principalId });
  const secret = randomBytes(32).toString("base64url");
  const challengeId = id("stp");
  const timestamp = now();
  const expiresAt = new Date(Date.now() + Math.min(Math.max(input.ttlSeconds ?? 300, 30), 600) * 1_000).toISOString();
  await db().insert(stepUpChallenges).values({ id: challengeId, accountId: input.accountId, principalId: input.principalId, actionClass: input.actionClass, actionHash: input.actionHash, nonceHash: hashSecret(secret), authenticationMethod: input.authenticationMethod, createdAt: timestamp, expiresAt });
  return { challengeId, secret, expiresAt };
}

export async function completePasswordStepUp(input: { accountId: string; principalId: string; secret: string; password: string; actionClass: string; actionHash?: string }) {
  const consumedAt = now();
  const [candidate] = await db().select({ passwordHash: users.passwordHash }).from(stepUpChallenges).innerJoin(principals, and(eq(principals.id, stepUpChallenges.principalId), eq(principals.status, "ACTIVE"))).innerJoin(users, eq(users.id, principals.userId)).innerJoin(accountMemberships, and(eq(accountMemberships.accountId, stepUpChallenges.accountId), eq(accountMemberships.principalId, principals.id), eq(accountMemberships.status, "ACTIVE"))).where(and(eq(stepUpChallenges.accountId, input.accountId), eq(stepUpChallenges.principalId, input.principalId), eq(stepUpChallenges.nonceHash, hashSecret(input.secret)), eq(stepUpChallenges.authenticationMethod, "password"), eq(stepUpChallenges.status, "PENDING"), gt(stepUpChallenges.expiresAt, consumedAt))).limit(1);
  if (!candidate || !verifyPassword(input.password, candidate.passwordHash)) {
    throw new RelayError("INVALID_CREDENTIAL", "Step-up authentication failed.", undefined, 401);
  }
  const rows = await db().update(stepUpChallenges).set({ status: "CONSUMED", consumedAt }).where(and(eq(stepUpChallenges.accountId, input.accountId), eq(stepUpChallenges.principalId, input.principalId), eq(stepUpChallenges.nonceHash, hashSecret(input.secret)), eq(stepUpChallenges.actionClass, input.actionClass), input.actionHash ? eq(stepUpChallenges.actionHash, input.actionHash) : isNull(stepUpChallenges.actionHash), eq(stepUpChallenges.status, "PENDING"), gt(stepUpChallenges.expiresAt, consumedAt))).returning({ id: stepUpChallenges.id, authenticationMethod: stepUpChallenges.authenticationMethod, consumedAt: stepUpChallenges.consumedAt });
  if (!rows[0]) throw new RelayError("INVALID_CREDENTIAL", "Step-up challenge is invalid, expired, mismatched, or already consumed.", undefined, 401);
  return rows[0];
}

export async function suspendPrincipal(input: { accountId: string; principalId: string }) {
  await requireMembership({ accountId: input.accountId, principalId: input.principalId, allowedRoles: MEMBERSHIP_ROLES });
  return await withTransaction(async (transaction) => {
    const [principal] = await transaction.update(principals).set({ status: "SUSPENDED", updatedAt: now() }).where(eq(principals.id, input.principalId)).returning({ id: principals.id, userId: principals.userId });
    await transaction.update(accountMemberships).set({ status: "SUSPENDED", updatedAt: now() }).where(and(eq(accountMemberships.accountId, input.accountId), eq(accountMemberships.principalId, input.principalId)));
    if (principal?.userId) await transaction.update(userSessions).set({ revokedAt: now() }).where(eq(userSessions.userId, principal.userId));
    return principal;
  });
}
