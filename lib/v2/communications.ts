import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, withTransaction } from "@/lib/db";
import { capabilityLeases, communicationConnections, communicationMessages, communicationThreads } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { canonicalHash, capabilityLeaseClaimsSchema } from "@/lib/v2/contracts";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { requireMembership } from "@/lib/v2/identity";
import { ingestVerifiedEvent } from "@/lib/v2/orchestration";

type Provider = "SLACK" | "TELEGRAM";
type Classification = "public" | "internal" | "confidential" | "restricted";
type Attachment = z.infer<typeof attachmentSchema>;

export interface CommunicationSecretResolver { resolve(accountId: string, handle: string): Promise<string> }
export interface CommunicationEventSink { publish(input: { accountId: string; source: string; type: string; dedupeKey: string; correlationId: string; classification: Classification; data: Record<string, unknown> }): Promise<{ taskIds: string[] }> }
export interface CommunicationSender {
  send(input: { provider: Provider; credential: string; conversationId: string; threadId?: string; text: string; idempotencyKey: string }): Promise<{ providerMessageId: string; state: "SENT" | "DELIVERED"; receipt?: Record<string, unknown> }>;
  reconcile?(input: { provider: Provider; credential: string; conversationId: string; idempotencyKey: string }): Promise<{ state: "SENT" | "DELIVERED"; providerMessageId: string; receipt?: Record<string, unknown> } | { state: "UNKNOWN" }>;
}

export class CommunicationProviderError extends Error {
  constructor(message: string, public readonly kind: "RATE_LIMIT" | "REJECTED" | "TIMEOUT" | "SERVER", public readonly retryAfterMs?: number) { super(message); this.name = "CommunicationProviderError"; }
}

const attachmentSchema = z.object({ providerId: z.string().min(1).max(255), kind: z.enum(["file", "image", "video", "audio", "document"]), mimeType: z.string().min(1).max(255).optional(), sizeBytes: z.number().int().nonnegative().max(25 * 1024 * 1024).optional(), name: z.string().min(1).max(255).optional() }).strict();

export function communicationEventSource(provider: Provider, connectionId: string) { return `relay://communications/${provider.toLowerCase()}/${connectionId}`; }

export function createRelayCommunicationEventSink(signer: AuditSigner): CommunicationEventSink {
  return { async publish(input) { return await ingestVerifiedEvent({ envelope: { specversion: "1.0", id: input.dedupeKey, source: input.source, type: input.type, time: now(), accountid: input.accountId, classification: input.classification, correlationid: input.correlationId, dedupekey: input.dedupeKey, schemaversion: "relay.communication-event.v1", signaturestatus: "verified", data: input.data }, rawBody: new Uint8Array(), headers: {} }, { verify: async () => ({ valid: true, evidence: { channelAdapterVerified: true } }) }, signer); } };
}

export async function registerCommunicationConnection(input: { accountId: string; principalId: string; provider: Provider; externalAccountId: string; ownedIdentityId: string; credentialHandle: string; webhookSecretHandle: string }) {
  await requireMembership({ accountId: input.accountId, principalId: input.principalId, allowedRoles: ["OWNER", "ADMIN", "OPERATOR"] });
  if (![input.credentialHandle, input.webhookSecretHandle].every((value) => /^vlt_[A-Za-z0-9_-]{8,}$/.test(value))) throw new RelayError("INVALID_INPUT", "Communication secrets must be opaque vault handles.");
  const connectionId = id("cmc");
  await db().insert(communicationConnections).values({ id: connectionId, accountId: input.accountId, provider: input.provider, externalAccountId: input.externalAccountId, ownedIdentityId: input.ownedIdentityId, credentialHandle: input.credentialHandle, webhookSecretHandle: input.webhookSecretHandle });
  return { connectionId };
}

function constantTimeEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }

async function activeConnection(provider: Provider, externalAccountId: string) {
  const [row] = await db().select().from(communicationConnections).where(and(eq(communicationConnections.provider, provider), eq(communicationConnections.externalAccountId, externalAccountId), eq(communicationConnections.status, "CONNECTED"), isNull(communicationConnections.revokedAt))).limit(1);
  if (!row) throw new RelayError("INVALID_CREDENTIAL", "Communication connection is unavailable.", undefined, 401);
  return row;
}

async function routeInbound(message: typeof communicationMessages.$inferSelect, provider: Provider, sink: CommunicationEventSink) {
  if (["ROUTED", "SUPPRESSED"].includes(message.status)) return { messageId: message.id, duplicate: true, taskIds: [] as string[] };
  const event = await sink.publish({ accountId: message.accountId, source: communicationEventSource(provider, message.connectionId), type: "communication.message.received", dedupeKey: `${provider}:${message.providerEventId}`, correlationId: message.threadId, classification: message.classification as Classification, data: { messageId: message.id, threadId: message.threadId, provider, senderId: message.senderId } });
  await db().update(communicationMessages).set({ status: "ROUTED", taskId: event.taskIds[0], updatedAt: now() }).where(and(eq(communicationMessages.accountId, message.accountId), eq(communicationMessages.id, message.id), eq(communicationMessages.status, "RECEIVED")));
  return { messageId: message.id, duplicate: false, taskIds: event.taskIds };
}

async function persistInbound(input: { connection: typeof communicationConnections.$inferSelect; providerEventId: string; providerMessageId: string; conversationId: string; externalThreadId?: string; senderId: string; text: string; attachments: Attachment[]; classification: Classification }, sink: CommunicationEventSink) {
  const stored = await withTransaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`communication:${input.connection.id}:${input.providerEventId}`}, 0))`);
    const [existing] = await transaction.select().from(communicationMessages).where(and(eq(communicationMessages.connectionId, input.connection.id), eq(communicationMessages.providerEventId, input.providerEventId))).limit(1);
    if (existing) return existing;
    const externalThreadId = input.externalThreadId ?? "";
    let [thread] = await transaction.select().from(communicationThreads).where(and(eq(communicationThreads.connectionId, input.connection.id), eq(communicationThreads.externalConversationId, input.conversationId), eq(communicationThreads.externalThreadId, externalThreadId))).limit(1);
    if (!thread) [thread] = await transaction.insert(communicationThreads).values({ id: id("cmt"), accountId: input.connection.accountId, connectionId: input.connection.id, externalConversationId: input.conversationId, externalThreadId, recipientId: input.senderId, knownRecipient: true }).returning();
    const content = { text: input.text, attachments: input.attachments };
    const [message] = await transaction.insert(communicationMessages).values({ id: id("cmm"), accountId: input.connection.accountId, connectionId: input.connection.id, threadId: thread!.id, direction: "INBOUND", providerMessageId: input.providerMessageId, providerEventId: input.providerEventId, senderId: input.senderId, content, contentHash: canonicalHash(content), classification: input.classification, status: input.senderId === input.connection.ownedIdentityId ? "SUPPRESSED" : "RECEIVED", idempotencyKey: `inbound:${input.connection.provider}:${input.providerEventId}` }).returning();
    return message!;
  });
  if (stored.status === "SUPPRESSED") return { messageId: stored.id, duplicate: true, taskIds: [] as string[] };
  return await routeInbound(stored, input.connection.provider, sink);
}

const slackFile = z.object({ id: z.string(), mimetype: z.string().optional(), size: z.number().int().optional(), name: z.string().optional() }).passthrough();
const slackEnvelope = z.object({ event_id: z.string(), team_id: z.string(), event: z.object({ type: z.literal("message"), user: z.string().optional(), bot_id: z.string().optional(), channel: z.string(), ts: z.string(), thread_ts: z.string().optional(), text: z.string().default(""), files: z.array(slackFile).max(20).default([]) }).passthrough() }).passthrough();

export async function ingestSlackWebhook(input: { rawBody: Uint8Array; timestamp: string; signature: string; receivedAtMs?: number }, secrets: CommunicationSecretResolver, sink: CommunicationEventSink) {
  const body = Buffer.from(input.rawBody).toString("utf8"); const parsedUnknown = JSON.parse(body) as { team_id?: string };
  if (!parsedUnknown.team_id) throw new RelayError("INVALID_INPUT", "Slack team is missing.");
  const row = await activeConnection("SLACK", parsedUnknown.team_id); const secret = await secrets.resolve(row.accountId, row.webhookSecretHandle); const timestamp = Number(input.timestamp);
  if (!Number.isInteger(timestamp) || Math.abs(Math.floor((input.receivedAtMs ?? Date.now()) / 1_000) - timestamp) > 300) throw new RelayError("INVALID_CREDENTIAL", "Slack request timestamp is stale.", undefined, 401);
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${input.timestamp}:${body}`).digest("hex")}`;
  if (!constantTimeEqual(expected, input.signature)) throw new RelayError("INVALID_CREDENTIAL", "Slack request signature is invalid.", undefined, 401);
  const payload = slackEnvelope.parse(parsedUnknown); const attachments = payload.event.files.map((file) => attachmentSchema.parse({ providerId: file.id, kind: "file", mimeType: file.mimetype, sizeBytes: file.size, name: file.name }));
  return await persistInbound({ connection: row, providerEventId: payload.event_id, providerMessageId: payload.event.ts, conversationId: payload.event.channel, externalThreadId: payload.event.thread_ts, senderId: payload.event.user ?? payload.event.bot_id ?? "unknown", text: payload.event.text, attachments, classification: attachments.length ? "confidential" : "internal" }, sink);
}

const telegramUpdate = z.object({ update_id: z.number().int(), message: z.object({ message_id: z.number().int(), from: z.object({ id: z.number().int() }), chat: z.object({ id: z.number().int() }), message_thread_id: z.number().int().optional(), text: z.string().default(""), caption: z.string().optional(), document: z.object({ file_id: z.string(), file_name: z.string().optional(), mime_type: z.string().optional(), file_size: z.number().int().optional() }).optional(), photo: z.array(z.object({ file_id: z.string(), file_size: z.number().int().optional() })).max(20).optional() }).passthrough() }).strict();

export async function ingestTelegramWebhook(input: { externalAccountId: string; rawBody: Uint8Array; secretToken: string }, secrets: CommunicationSecretResolver, sink: CommunicationEventSink) {
  const row = await activeConnection("TELEGRAM", input.externalAccountId); const expected = await secrets.resolve(row.accountId, row.webhookSecretHandle);
  if (!constantTimeEqual(expected, input.secretToken)) throw new RelayError("INVALID_CREDENTIAL", "Telegram webhook secret is invalid.", undefined, 401);
  const payload = telegramUpdate.parse(JSON.parse(Buffer.from(input.rawBody).toString("utf8"))); const attachments: Attachment[] = [];
  if (payload.message.document) attachments.push(attachmentSchema.parse({ providerId: payload.message.document.file_id, kind: "document", name: payload.message.document.file_name, mimeType: payload.message.document.mime_type, sizeBytes: payload.message.document.file_size }));
  if (payload.message.photo?.length) { const photo = payload.message.photo.at(-1)!; attachments.push(attachmentSchema.parse({ providerId: photo.file_id, kind: "image", sizeBytes: photo.file_size })); }
  return await persistInbound({ connection: row, providerEventId: String(payload.update_id), providerMessageId: String(payload.message.message_id), conversationId: String(payload.message.chat.id), externalThreadId: payload.message.message_thread_id ? String(payload.message.message_thread_id) : undefined, senderId: String(payload.message.from.id), text: payload.message.text || payload.message.caption || "", attachments, classification: attachments.length ? "confidential" : "internal" }, sink);
}

async function outboundAuthority(input: { accountId: string; connectionId: string; threadId: string; leaseId: string; taskId: string; text: string }) {
  const [[connection], [thread], [lease]] = await Promise.all([
    db().select().from(communicationConnections).where(and(eq(communicationConnections.accountId, input.accountId), eq(communicationConnections.id, input.connectionId), eq(communicationConnections.status, "CONNECTED"), isNull(communicationConnections.revokedAt))).limit(1),
    db().select().from(communicationThreads).where(and(eq(communicationThreads.accountId, input.accountId), eq(communicationThreads.id, input.threadId), eq(communicationThreads.connectionId, input.connectionId))).limit(1),
    db().select().from(capabilityLeases).where(and(eq(capabilityLeases.accountId, input.accountId), eq(capabilityLeases.id, input.leaseId), eq(capabilityLeases.taskId, input.taskId), eq(capabilityLeases.status, "ACTIVE"), gt(capabilityLeases.expiresAt, now()), isNull(capabilityLeases.revokedAt))).limit(1),
  ]);
  if (!connection || !thread || !lease) throw new RelayError("CAPABILITY_DENIED", "Communication authority is incomplete.", undefined, 403);
  const claims = capabilityLeaseClaimsSchema.parse(lease.claims);
  const actionHash = canonicalHash({ capability: claims.capability, resource: claims.resource, parameters: { threadId: input.threadId, text: input.text } });
  if (claims.accountId !== input.accountId || claims.taskId !== input.taskId || claims.jti !== input.leaseId || claims.actionHash !== actionHash) throw new RelayError("CAPABILITY_DENIED", "Message differs from the authorized action.", undefined, 403);
  if (!thread.knownRecipient && !claims.approvalDecisionId) throw new RelayError("CAPABILITY_DENIED", "A new recipient requires approval.", undefined, 403);
  return { connection, thread, claims };
}

async function authorizedOutbound(accountId: string, message: typeof communicationMessages.$inferSelect) {
  const content = z.object({ text: z.string(), attachments: z.array(attachmentSchema).default([]) }).parse(message.content);
  return { ...await outboundAuthority({ accountId, connectionId: message.connectionId, threadId: message.threadId, leaseId: message.leaseId!, taskId: message.taskId!, text: content.text }), content };
}

async function deliverClaimed(accountId: string, messageId: string, secrets: CommunicationSecretResolver, sender: CommunicationSender) {
  const [message] = await db().select().from(communicationMessages).where(and(eq(communicationMessages.accountId, accountId), eq(communicationMessages.id, messageId), eq(communicationMessages.direction, "OUTBOUND"))).limit(1);
  if (!message) throw new RelayError("INVALID_INPUT", "Communication message is unavailable.", undefined, 404);
  const authority = await authorizedOutbound(accountId, message);
  try {
    const credential = await secrets.resolve(accountId, authority.connection.credentialHandle);
    const receipt = await sender.send({ provider: authority.connection.provider, credential, conversationId: authority.thread.externalConversationId, threadId: authority.thread.externalThreadId || undefined, text: authority.content.text, idempotencyKey: message.idempotencyKey });
    await db().update(communicationMessages).set({ providerMessageId: receipt.providerMessageId, providerReceipt: { providerMessageId: receipt.providerMessageId, finalState: receipt.state, ...receipt.receipt }, status: receipt.state, updatedAt: now() }).where(and(eq(communicationMessages.accountId, accountId), eq(communicationMessages.id, messageId)));
    return { messageId, providerMessageId: receipt.providerMessageId, status: receipt.state };
  } catch (error) {
    const providerError = error instanceof CommunicationProviderError ? error : undefined; const explicitlyPreEffect = providerError?.kind === "RATE_LIMIT" || providerError?.kind === "REJECTED";
    const retryAfter = providerError?.kind === "RATE_LIMIT" ? new Date(Date.now() + Math.max(1_000, providerError.retryAfterMs ?? 1_000)).toISOString() : null;
    await db().update(communicationMessages).set({ status: explicitlyPreEffect ? "FAILED" : "EFFECT_UNKNOWN", retryAfter, providerReceipt: { errorClass: providerError?.kind ?? "UNKNOWN", explicitlyPreEffect }, updatedAt: now() }).where(and(eq(communicationMessages.accountId, accountId), eq(communicationMessages.id, messageId)));
    throw new RelayError("PROVIDER_ERROR", explicitlyPreEffect ? "Communication provider rejected the send before effect." : "Communication send outcome is unknown; reconcile before retry.", undefined, 502);
  }
}

export async function sendCommunication(input: { accountId: string; connectionId: string; threadId: string; taskId: string; actionIntentId: string; leaseId: string; text: string; idempotencyKey: string }, secrets: CommunicationSecretResolver, sender: CommunicationSender) {
  if (!input.text || input.text.length > 4_096) throw new RelayError("INVALID_INPUT", "Message text must contain 1 to 4096 characters.");
  const [replay] = await db().select().from(communicationMessages).where(and(eq(communicationMessages.accountId, input.accountId), eq(communicationMessages.idempotencyKey, input.idempotencyKey))).limit(1);
  if (replay) return { messageId: replay.id, status: replay.status, idempotentReplay: true };
  const authority = await outboundAuthority(input);
  const message = await withTransaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`communication-send:${input.accountId}:${input.idempotencyKey}`}, 0))`);
    const [existing] = await transaction.select().from(communicationMessages).where(and(eq(communicationMessages.accountId, input.accountId), eq(communicationMessages.idempotencyKey, input.idempotencyKey))).limit(1);
    if (existing) return { row: existing, replay: true };
    const content = { text: input.text, attachments: [] as Attachment[] }; const messageId = id("cmm");
    const [row] = await transaction.insert(communicationMessages).values({ id: messageId, accountId: input.accountId, connectionId: input.connectionId, threadId: input.threadId, direction: "OUTBOUND", providerMessageId: `pending:${messageId}`, senderId: authority.connection.ownedIdentityId, content, contentHash: canonicalHash(content), classification: "internal", status: "SENDING", taskId: input.taskId, actionIntentId: input.actionIntentId, leaseId: input.leaseId, approvalDecisionId: authority.claims.approvalDecisionId, idempotencyKey: input.idempotencyKey, attemptCount: 1 }).returning();
    return { row: row!, replay: false };
  });
  if (message.replay) return { messageId: message.row.id, status: message.row.status, idempotentReplay: true };
  return { ...await deliverClaimed(input.accountId, message.row.id, secrets, sender), idempotentReplay: false };
}

export async function retryRateLimitedCommunication(input: { accountId: string; messageId: string }, secrets: CommunicationSecretResolver, sender: CommunicationSender) {
  const claimed = await withTransaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`communication-retry:${input.accountId}:${input.messageId}`}, 0))`);
    const [message] = await transaction.select().from(communicationMessages).where(and(eq(communicationMessages.accountId, input.accountId), eq(communicationMessages.id, input.messageId), eq(communicationMessages.status, "FAILED"), lte(communicationMessages.retryAfter, now()))).limit(1);
    const receipt = message?.providerReceipt as { errorClass?: string; explicitlyPreEffect?: boolean } | null;
    if (!message || receipt?.errorClass !== "RATE_LIMIT" || receipt.explicitlyPreEffect !== true) throw new RelayError("CAPABILITY_DENIED", "Only elapsed, explicitly pre-effect rate limits may retry.", undefined, 409);
    const [updated] = await transaction.update(communicationMessages).set({ status: "SENDING", retryAfter: null, attemptCount: sql`${communicationMessages.attemptCount} + 1`, updatedAt: now() }).where(and(eq(communicationMessages.accountId, input.accountId), eq(communicationMessages.id, input.messageId), eq(communicationMessages.status, "FAILED"))).returning({ id: communicationMessages.id });
    return updated;
  });
  if (!claimed) throw new RelayError("CAPABILITY_DENIED", "Communication retry was already claimed.", undefined, 409);
  return await deliverClaimed(input.accountId, input.messageId, secrets, sender);
}

export async function reconcileCommunication(input: { accountId: string; messageId: string }, secrets: CommunicationSecretResolver, sender: CommunicationSender) {
  const [message] = await db().select().from(communicationMessages).where(and(eq(communicationMessages.accountId, input.accountId), eq(communicationMessages.id, input.messageId), eq(communicationMessages.status, "EFFECT_UNKNOWN"))).limit(1);
  if (!message || !sender.reconcile) throw new RelayError("CAPABILITY_DENIED", "Communication reconciliation is unavailable.", undefined, 409);
  const authority = await authorizedOutbound(input.accountId, message); const credential = await secrets.resolve(input.accountId, authority.connection.credentialHandle);
  const result = await sender.reconcile({ provider: authority.connection.provider, credential, conversationId: authority.thread.externalConversationId, idempotencyKey: message.idempotencyKey });
  if (result.state === "UNKNOWN") return { messageId: message.id, status: "EFFECT_UNKNOWN" as const };
  await db().update(communicationMessages).set({ providerMessageId: result.providerMessageId, providerReceipt: { providerMessageId: result.providerMessageId, finalState: result.state, reconciled: true, ...result.receipt }, status: result.state, updatedAt: now() }).where(and(eq(communicationMessages.accountId, input.accountId), eq(communicationMessages.id, message.id)));
  return { messageId: message.id, providerMessageId: result.providerMessageId, status: result.state };
}

export async function listCommunicationMessages(accountId: string, threadId: string) { return await db().select().from(communicationMessages).where(and(eq(communicationMessages.accountId, accountId), eq(communicationMessages.threadId, threadId))); }
