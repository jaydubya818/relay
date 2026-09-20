import { enqueueChannelCancellation } from "./channels/cancellation";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, withTransaction, type RelayDatabase } from "@/lib/db";
import { agents, communicationConnections, telegramBindings, telegramPairingChallenges } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import type { CommunicationSecretResolver } from "@/lib/v2/communications";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { requireMembership } from "@/lib/v2/identity";
import { parsePrivateTelegramUpdate, verifyTelegramSecret } from "@/lib/v2/telegram-input";

const PAIRING_TTL_MS = 5 * 60 * 1000;
const secretHash = (secret: string) => createHash("sha256").update(secret).digest("hex");
const unavailable = () => new RelayError("CAPABILITY_DENIED", "Telegram pairing is unavailable or expired.", undefined, 403);

async function lockConnection(transaction: RelayDatabase, connectionId: string) {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram-binding:${connectionId}`}, 0))`);
}

async function activeConnection(transaction: RelayDatabase, accountId: string, connectionId: string) {
  const [connection] = await transaction.select().from(communicationConnections).where(and(
    eq(communicationConnections.id, connectionId), eq(communicationConnections.accountId, accountId),
    eq(communicationConnections.provider, "TELEGRAM"), eq(communicationConnections.status, "CONNECTED"), isNull(communicationConnections.revokedAt),
  )).limit(1);
  if (!connection) throw unavailable();
  return connection;
}

async function activeOwnerAgent(transaction: RelayDatabase, accountId: string, principalId: string, agentId: string) {
  const owner = await requireMembership({ accountId, principalId, allowedRoles: ["OWNER"] });
  if (owner.type !== "HUMAN") throw unavailable();
  const [agent] = await transaction.select({ id: agents.id }).from(agents).where(and(eq(agents.id, agentId), eq(agents.accountId, accountId), eq(agents.status, "ACTIVE"))).limit(1);
  if (!agent) throw unavailable();
}

export async function createTelegramPairingChallenge(input: { accountId: string; ownerPrincipalId: string; connectionId: string; agentId: string }, signer: AuditSigner) {
  return await withTransaction(async (transaction) => {
    await lockConnection(transaction, input.connectionId);
    await activeConnection(transaction, input.accountId, input.connectionId);
    await activeOwnerAgent(transaction, input.accountId, input.ownerPrincipalId, input.agentId);
    const [bound] = await transaction.select({ id: telegramBindings.id }).from(telegramBindings).where(and(eq(telegramBindings.connectionId, input.connectionId), isNull(telegramBindings.revokedAt))).limit(1);
    if (bound) throw unavailable();
    const timestamp = now();
    // Reissuing retires earlier challenges. Tokens never enter audit/message content.
    await transaction.update(telegramPairingChallenges).set({ consumedAt: timestamp, updatedAt: timestamp }).where(and(eq(telegramPairingChallenges.connectionId, input.connectionId), isNull(telegramPairingChallenges.consumedAt)));
    const secret = randomBytes(32).toString("base64url");
    const challengeId = id("tpc");
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
    await transaction.insert(telegramPairingChallenges).values({ id: challengeId, ...input, secretHash: secretHash(secret), expiresAt });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.ownerPrincipalId, agentId: input.agentId, eventType: "telegram.pairing_created", outcome: "SUCCESS", details: { challengeId, connectionId: input.connectionId, expiresAt } }, signer);
    return { challengeId, secret, expiresAt };
  });
}

/** Endpoint configuration supplies connectionId. The caller cannot choose an account or Agent. */
export async function consumeTelegramPairingUpdate(input: { connectionId: string; rawBody: Uint8Array; secretToken: string }, secrets: CommunicationSecretResolver, signer: AuditSigner) {
  const [configured] = await db().select().from(communicationConnections).where(and(eq(communicationConnections.id, input.connectionId), eq(communicationConnections.provider, "TELEGRAM"), eq(communicationConnections.status, "CONNECTED"), isNull(communicationConnections.revokedAt))).limit(1);
  if (!configured) throw unavailable();
  verifyTelegramSecret(await secrets.resolve(configured.accountId, configured.webhookSecretHandle), input.secretToken);
  const update = parsePrivateTelegramUpdate(input.rawBody);
  const token = /^\/start ([A-Za-z0-9_-]{43})$/.exec(update.text)?.[1];
  if (!token) throw unavailable();
  return await withTransaction(async (transaction) => {
    await lockConnection(transaction, configured.id);
    await activeConnection(transaction, configured.accountId, configured.id);
    const [challenge] = await transaction.select().from(telegramPairingChallenges).where(and(
      eq(telegramPairingChallenges.connectionId, configured.id), eq(telegramPairingChallenges.accountId, configured.accountId),
      eq(telegramPairingChallenges.secretHash, secretHash(token)), isNull(telegramPairingChallenges.consumedAt), gt(telegramPairingChallenges.expiresAt, now()),
    )).limit(1);
    if (!challenge) throw unavailable();
    await activeOwnerAgent(transaction, challenge.accountId, challenge.ownerPrincipalId, challenge.agentId);
    const [bound] = await transaction.select({ id: telegramBindings.id }).from(telegramBindings).where(and(eq(telegramBindings.connectionId, configured.id), isNull(telegramBindings.revokedAt))).limit(1);
    if (bound) throw unavailable();
    const bindingId = id("tgb");
    const timestamp = now();
    await transaction.insert(telegramBindings).values({ id: bindingId, accountId: challenge.accountId, connectionId: challenge.connectionId, ownerPrincipalId: challenge.ownerPrincipalId, agentId: challenge.agentId, telegramUserId: update.userId, telegramChatId: update.chatId, pairingChallengeId: challenge.id });
    await transaction.update(telegramPairingChallenges).set({ consumedAt: timestamp, updatedAt: timestamp }).where(eq(telegramPairingChallenges.id, challenge.id));
    await appendAuditRecordInTransaction(transaction, { accountId: challenge.accountId, actorPrincipalId: challenge.ownerPrincipalId, agentId: challenge.agentId, eventType: "telegram.identity_bound", outcome: "SUCCESS", details: { bindingId, connectionId: configured.id, challengeId: challenge.id, telegramUpdateId: update.updateId, telegramMessageId: update.messageId } }, signer);
    return { bindingId };
  });
}

export async function listTelegramBindings(input: { accountId: string; ownerPrincipalId: string }) {
  await requireMembership({ accountId: input.accountId, principalId: input.ownerPrincipalId, allowedRoles: ["OWNER"] });
  return await db().select().from(telegramBindings).where(eq(telegramBindings.accountId, input.accountId));
}

export async function authenticateTelegramWorkUpdate(input: { connectionId: string; rawBody: Uint8Array; secretToken: string }, secrets: CommunicationSecretResolver) {
  const [configured] = await db().select().from(communicationConnections).where(and(eq(communicationConnections.id, input.connectionId), eq(communicationConnections.provider, "TELEGRAM"), eq(communicationConnections.status, "CONNECTED"), isNull(communicationConnections.revokedAt))).limit(1);
  if (!configured) throw unavailable();
  verifyTelegramSecret(await secrets.resolve(configured.accountId, configured.webhookSecretHandle), input.secretToken);
  const update = parsePrivateTelegramUpdate(input.rawBody);
  return await withTransaction(async (transaction) => {
    await lockConnection(transaction, configured.id);
    await activeConnection(transaction, configured.accountId, configured.id);
    const [binding] = await transaction.select().from(telegramBindings).where(and(
      eq(telegramBindings.connectionId, configured.id), eq(telegramBindings.accountId, configured.accountId),
      eq(telegramBindings.telegramUserId, update.userId), eq(telegramBindings.telegramChatId, update.chatId), isNull(telegramBindings.revokedAt),
    )).limit(1);
    if (!binding) throw unavailable();
    await activeOwnerAgent(transaction, binding.accountId, binding.ownerPrincipalId, binding.agentId);
    return { update, bindingId: binding.id, accountId: binding.accountId, ownerPrincipalId: binding.ownerPrincipalId, agentId: binding.agentId, connectionId: configured.id };
  });
}

export async function revokeTelegramBinding(input: { accountId: string; ownerPrincipalId: string; bindingId: string }, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.ownerPrincipalId, allowedRoles: ["OWNER"] });
  return await withTransaction(async (transaction) => {
    const [binding] = await transaction.select().from(telegramBindings).where(and(eq(telegramBindings.id, input.bindingId), eq(telegramBindings.accountId, input.accountId))).limit(1);
    if (!binding) throw unavailable();
    await lockConnection(transaction, binding.connectionId);
    const timestamp = now();
    const [revoked] = await transaction.update(telegramBindings).set({ revokedAt: timestamp, updatedAt: timestamp }).where(and(eq(telegramBindings.id, binding.id), isNull(telegramBindings.revokedAt))).returning({ id: telegramBindings.id });
    if (!revoked) return { revoked: true };
    await transaction.update(telegramPairingChallenges).set({ consumedAt: timestamp, updatedAt: timestamp }).where(and(eq(telegramPairingChallenges.connectionId, binding.connectionId), isNull(telegramPairingChallenges.consumedAt)));
    const pending=(await transaction.execute(sql`SELECT w.task_id FROM channel_work_links w JOIN v2_tasks t ON t.id=w.task_id WHERE w.account_id=${input.accountId} AND w.binding_id=${binding.id} AND t.status NOT IN ('SUCCEEDED','FAILED','CANCELLED','DEAD_LETTERED')`)).rows as Array<{task_id:string}>;
    for(const work of pending)await enqueueChannelCancellation(transaction,input.accountId,work.task_id);
    // Disconnect the canonical channel too: existing outbound authority rejects it.
    await transaction.update(communicationConnections).set({ status: "DISCONNECTED", revokedAt: timestamp, updatedAt: timestamp }).where(and(eq(communicationConnections.id, binding.connectionId), eq(communicationConnections.accountId, input.accountId)));
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.ownerPrincipalId, agentId: binding.agentId, eventType: "telegram.binding_revoked", outcome: "REVOKED", details: { bindingId: binding.id, connectionId: binding.connectionId } }, signer);
    return { revoked: true };
  });
}
