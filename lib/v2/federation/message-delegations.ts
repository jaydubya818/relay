import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, withTransaction } from "@/lib/db";
import { agents, federationAgents, federationGrants, federationMessageDelegations } from "@/lib/db/schema";
import { hashSecret } from "@/lib/crypto";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import type { SessionUser } from "@/lib/types";
import { operatorContext } from "@/lib/v2/dashboard";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { grantSchema, type Grant } from "./contracts";
import { denied, lockOwners, requireOwner, type OwnerActor } from "./registry";

const DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const issueSchema = z.object({ agentId: z.string().min(1).max(255), granteeOwnerId: z.string().min(1).max(255), granteeAgentId: z.string().min(1).max(255) }).strict();
export type MessageDelegation = { id: string; actor: OwnerActor; agentId: string; granteeOwnerId: string; granteeAgentId: string; expiresAt: string };

export async function issueMessageDelegation(user: SessionUser, value: unknown, signer: AuditSigner) {
  const input = issueSchema.parse(value);
  if (user.role !== "OWNER" || input.granteeOwnerId === user.accountId) denied();
  const operator = await operatorContext(user.accountId, user.id);
  const actor = { accountId: user.accountId, principalId: operator.principalId };
  await requireOwner(actor);
  const [grantor, grantee] = await Promise.all([
    db().select({ id: agents.id }).from(agents).innerJoin(federationAgents, eq(federationAgents.agentId, agents.id)).where(and(eq(agents.id, input.agentId), eq(agents.accountId, user.accountId), eq(agents.status, "ACTIVE"), eq(federationAgents.ownerId, user.accountId), eq(federationAgents.availability, "ONLINE"))).limit(1),
    db().select({ id: agents.id }).from(agents).where(and(eq(agents.id, input.granteeAgentId), eq(agents.accountId, input.granteeOwnerId), eq(agents.status, "ACTIVE"))).limit(1),
  ]);
  if (!grantor[0] || !grantee[0]) denied();
  const token = randomBytes(32).toString("base64url");
  const delegationId = id("fmd");
  const expiresAt = new Date(Date.now() + DURATION_MS).toISOString();
  await withTransaction(async (transaction) => {
    await lockOwners(transaction, [user.accountId, input.granteeOwnerId]);
    await transaction.update(federationMessageDelegations).set({ revokedAt: now() }).where(and(
      eq(federationMessageDelegations.ownerId, user.accountId),
      eq(federationMessageDelegations.agentId, input.agentId),
      eq(federationMessageDelegations.granteeOwnerId, input.granteeOwnerId),
      eq(federationMessageDelegations.granteeAgentId, input.granteeAgentId),
      isNull(federationMessageDelegations.revokedAt),
    ));
    await transaction.insert(federationMessageDelegations).values({ id: delegationId, ownerId: user.accountId, userId: user.id, agentId: input.agentId, granteeOwnerId: input.granteeOwnerId, granteeAgentId: input.granteeAgentId, tokenHash: hashSecret(token), expiresAt });
    await appendAuditRecordInTransaction(transaction, { accountId: user.accountId, actorPrincipalId: actor.principalId, agentId: input.agentId, eventType: "federation.message-delegation.issued", outcome: "SUCCESS", details: { delegationId, granteeOwnerId: input.granteeOwnerId, granteeAgentId: input.granteeAgentId, expiresAt } }, signer);
  });
  return { delegationId, credential: token, expiresAt };
}

export async function authenticateMessageDelegation(token: string): Promise<MessageDelegation | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await db().select().from(federationMessageDelegations).where(and(eq(federationMessageDelegations.tokenHash, hashSecret(token)), isNull(federationMessageDelegations.revokedAt), gt(federationMessageDelegations.expiresAt, now()))).limit(1);
  if (!row) return null;
  const [agent] = await db().select({ id: agents.id }).from(agents).where(and(eq(agents.id, row.agentId), eq(agents.accountId, row.ownerId), eq(agents.status, "ACTIVE"))).limit(1);
  if (!agent) return null;
  try {
    const operator = await operatorContext(row.ownerId, row.userId);
    const actor = { accountId: row.ownerId, principalId: operator.principalId };
    await requireOwner(actor);
    return { id: row.id, actor, agentId: row.agentId, granteeOwnerId: row.granteeOwnerId, granteeAgentId: row.granteeAgentId, expiresAt: row.expiresAt };
  } catch { return null; }
}

function matchesScope(delegation: MessageDelegation, grant: Grant) {
  return grant.grantorAgentId === delegation.agentId &&
    grant.granteeOwnerId === delegation.granteeOwnerId &&
    grant.granteeAgentId === delegation.granteeAgentId &&
    grant.capability === "message.send" &&
    grant.resource === `relay://${delegation.actor.accountId}/${delegation.agentId}` &&
    grant.conditions.expiresAt !== null &&
    Date.parse(grant.conditions.expiresAt) <= Date.parse(delegation.expiresAt) &&
    grant.conditions.rateLimit.calls <= 20 &&
    grant.conditions.rateLimit.windowSeconds >= 3600 &&
    !grant.conditions.maxCost && !grant.conditions.budgetId;
}

export async function authorizeDelegatedGrant(delegation: MessageDelegation, value: unknown) {
  const grant = grantSchema.parse(value);
  if (!matchesScope(delegation, grant)) denied();
  return grant;
}

export async function authorizeDelegatedRevoke(delegation: MessageDelegation, grantId: string) {
  const [row] = await db().select({ document: federationGrants.document }).from(federationGrants).where(and(eq(federationGrants.id, grantId), eq(federationGrants.ownerId, delegation.actor.accountId))).limit(1);
  if (!row || !matchesScope(delegation, grantSchema.parse(row.document))) denied();
}

export async function revokeMessageDelegation(delegation: MessageDelegation, signer: AuditSigner) {
  await withTransaction(async (transaction) => {
    await transaction.update(federationMessageDelegations).set({ revokedAt: now() }).where(and(eq(federationMessageDelegations.id, delegation.id), isNull(federationMessageDelegations.revokedAt)));
    await appendAuditRecordInTransaction(transaction, { accountId: delegation.actor.accountId, actorPrincipalId: delegation.actor.principalId, agentId: delegation.agentId, eventType: "federation.message-delegation.revoked", outcome: "SUCCESS", details: { delegationId: delegation.id } }, signer);
  });
}

export function delegationToken(request: Request) {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
  if (!match) throw new RelayError("INVALID_CREDENTIAL", "Invalid delegation credential.", undefined, 401);
  return match[1];
}
