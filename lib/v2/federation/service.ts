import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, withTransaction, type RelayDatabase } from "@/lib/db";
import { accountMemberships, agentCredentials, agents, approvalRequests, budgetReservations, budgets, controlOutbox, federationAgents, federationAttempts, federationGrants, federationRateWindows, federationRelationships, federationRequests, policyDecisions, publishedViews } from "@/lib/db/schema";
import { hashSecret } from "@/lib/crypto";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { canonicalHash, type ActionIntent } from "@/lib/v2/contracts";
import { appendAuditRecord, appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import { evaluatePolicy, inspectPolicy } from "@/lib/v2/policy";
import { consumeApprovalInTransaction, createApprovalRequest } from "@/lib/v2/approvals";
import { expireBudgetReservations, reconcileBudgetReservation, reserveBudgetInTransaction } from "@/lib/v2/budgets";
import { grantSchema, knowledgeResponseSchema, registrationSchema, submissionSchema, viewSchema, type Submission } from "./contracts";
import { assertNotBlocked, denied, lockOwners } from "./registry";
import { seal, signDelivery, unseal, type FederationBindings } from "./transport";

export type AuthenticatedAgent = { ownerId: string; agentId: string; credentialId: string; address: string };
type RequestRow = typeof federationRequests.$inferSelect;
type Metadata = { action: ActionIntent; deliveryHash?: string; reservationId?: string; approvalConsumed?: boolean; approvalAuthorityRevision?: string; resultHash?: string; conversationId?: string };
function amountUnits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, "0"));
}
const activeStates = ["AUTHORIZED", "DELIVERED", "WAITING", "ACCEPTED", "RUNNING"];
export async function authenticateFederationAgent(secret: string): Promise<AuthenticatedAgent> {
  const [row] = await db().select({ ownerId: agents.accountId, agentId: agents.id, credentialId: agentCredentials.id, expiresAt: agentCredentials.expiresAt, address: federationAgents.address, availability: federationAgents.availability })
    .from(agentCredentials).innerJoin(agents, and(eq(agents.id, agentCredentials.agentId), eq(agents.accountId, agentCredentials.accountId), eq(agents.status, "ACTIVE")))
    .innerJoin(federationAgents, and(eq(federationAgents.agentId, agents.id), eq(federationAgents.ownerId, agents.accountId)))
    .where(and(eq(agentCredentials.secretHash, hashSecret(secret)), isNull(agentCredentials.revokedAt))).limit(1);
  if (!row || (row.expiresAt && Date.parse(row.expiresAt) <= Date.now()) || ["REVOKED", "PAUSED"].includes(row.availability)) throw new RelayError("INVALID_CREDENTIAL", "Federation credential is unavailable.", undefined, 401);
  return { ownerId: row.ownerId, agentId: row.agentId, credentialId: row.credentialId, address: row.address };
}
async function identityStillActive(transaction: RelayDatabase, row: RequestRow) {
  const [credential] = await transaction.select().from(agentCredentials).where(and(eq(agentCredentials.id, row.callerCredentialId), eq(agentCredentials.agentId, row.callerAgentId), eq(agentCredentials.accountId, row.callerOwnerId), isNull(agentCredentials.revokedAt)));
  if (!credential || (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now())) denied();
  const identities = await transaction.select({ id: agents.id, status: agents.status, availability: federationAgents.availability }).from(agents).innerJoin(federationAgents, eq(federationAgents.agentId, agents.id)).where(inArray(agents.id, [row.callerAgentId, row.targetAgentId]));
  if (identities.length !== 2 || identities.some((entry) => entry.status !== "ACTIVE" || ["REVOKED", "PAUSED"].includes(entry.availability))) denied();
}
export async function chargeRates(keys: Array<{ accountId: string; key: string; limit: number; seconds: number }>) {
  // Separate committed transaction: denied attempts also consume admission capacity.
  return withTransaction(async (transaction) => {
    for (const { accountId, key, limit, seconds } of keys.sort((a, b) => `${a.accountId}:${a.key}`.localeCompare(`${b.accountId}:${b.key}`))) {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`federation-rate:${accountId}:${key}`}, 0))`);
      const [row] = await transaction.select().from(federationRateWindows).where(and(eq(federationRateWindows.accountId, accountId), eq(federationRateWindows.key, key)));
      const fresh = !row || Date.parse(row.resetAt) <= Date.now();
      const count = fresh ? 1 : row.count + 1;
      if (count > limit) throw new RelayError("RATE_LIMITED", "Federation request limit exceeded.", undefined, 429);
      const resetAt = fresh ? new Date(Date.now() + seconds * 1000).toISOString() : row.resetAt;
      await transaction.insert(federationRateWindows).values({ accountId, key, count, resetAt }).onConflictDoUpdate({ target: [federationRateWindows.accountId, federationRateWindows.key], set: { count, resetAt } });
    }
  });
}
async function authority(transaction: RelayDatabase, row: RequestRow, submission: Submission) {
  if (Date.parse(row.expiresAt) <= Date.now()) denied();
  await identityStillActive(transaction, row);
  await assertNotBlocked(transaction, { ownerId: row.callerOwnerId, agentId: row.callerAgentId }, { ownerId: row.targetOwnerId, agentId: row.targetAgentId });
  const [target] = await transaction.select().from(federationAgents).where(eq(federationAgents.agentId, row.targetAgentId));
  const [caller] = await transaction.select().from(federationAgents).where(eq(federationAgents.agentId, row.callerAgentId));
  const targetCapabilities = registrationSchema.parse(target.registration).capabilities.map((cap) => cap.name);
  const callerCapabilities = registrationSchema.parse(caller.registration).capabilities.map((cap) => cap.name);
  const receiveCapability = submission.capability === "message.send" ? "message.receive" : submission.capability === "artifact.share" ? "artifact.receive" : submission.capability;
  if (!callerCapabilities.includes(submission.capability) || !targetCapabilities.includes(receiveCapability)) denied();
  let publication: { version: number; document: z.infer<typeof viewSchema> } | undefined;
  if (submission.capability === "knowledge.query") {
    const [view] = await transaction.select().from(publishedViews).where(and(eq(publishedViews.id, submission.resource), eq(publishedViews.ownerId, row.targetOwnerId), eq(publishedViews.publisherAgentId, row.targetAgentId), eq(publishedViews.status, "ACTIVE")));
    if (!view) denied();
    const document = viewSchema.parse(view.document);
    if (Date.parse(document.expiresAt) <= Date.now() || document.visibility === "PRIVATE" || (row.publicationVersion !== null && row.publicationVersion !== view.version)) denied();
    if (document.visibility === "SHARED" && !document.allowedAudience.some((audience) => audience.ownerId === row.callerOwnerId && (!audience.agentId || audience.agentId === row.callerAgentId))) denied();
    if (submission.payload.requestedTypes.some((type) => !document.recordTypes.includes(type)) || submission.payload.topics.some((topic) => !document.topics.includes(topic))) denied();
    publication = { version: view.version, document };
  }
  const grants = await transaction.select().from(federationGrants).where(and(eq(federationGrants.ownerId, row.targetOwnerId), eq(federationGrants.granteeOwnerId, row.callerOwnerId), eq(federationGrants.capability, submission.capability), eq(federationGrants.resource, submission.resource), eq(federationGrants.status, "ACTIVE")));
  const matching = grants.map((grant) => ({ id: grant.id, document: grantSchema.parse(grant.document) })).filter(({ id: grantId, document }) => {
    const conditions = document.conditions;
    return (!row.grantId || grantId === row.grantId) && (!document.granteeAgentId || document.granteeAgentId === row.callerAgentId)
      && (!document.grantorAgentId || document.grantorAgentId === row.targetAgentId)
      && (conditions.expiresAt === null || Date.parse(conditions.expiresAt) > Date.now()) && (!conditions.notBefore || Date.parse(conditions.notBefore) <= Date.now())
      && (submission.capability !== "knowledge.query" || !conditions.allowedTopics.length || (submission.payload.topics.length > 0 && submission.payload.topics.every((topic) => conditions.allowedTopics.includes(topic))));
  });
  let grant = matching.sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!grant && publication?.document.visibility === "PUBLIC" && publication.document.publicQueryPolicy) {
    // Revoking an identity-specific grant also removes that identity's public fallback.
    const revoked = await transaction.select().from(federationGrants).where(and(eq(federationGrants.ownerId, row.targetOwnerId), eq(federationGrants.granteeOwnerId, row.callerOwnerId), eq(federationGrants.capability, submission.capability), eq(federationGrants.resource, submission.resource), eq(federationGrants.status, "REVOKED")));
    if (revoked.some((entry) => { const document = grantSchema.parse(entry.document); return (!document.granteeAgentId || document.granteeAgentId === row.callerAgentId) && (!document.grantorAgentId || document.grantorAgentId === row.targetAgentId); })) denied();
    const publicId = `public:${submission.resource}:${publication.version}`;
    const publicPolicy = publication.document.publicQueryPolicy;
    if (row.grantId && row.grantId !== publicId) denied();
    if (submission.capability !== "knowledge.query" || submission.payload.maxRecords > publicPolicy.maxRecords) denied();
    grant = { id: publicId, document: { granteeOwnerId: row.callerOwnerId, capability: "knowledge.query", resource: submission.resource, conditions: { expiresAt: publication.document.expiresAt, rateLimit: { calls: publicPolicy.callsPerMinute, windowSeconds: 60 }, allowedTopics: [], approvalRequired: false } } };
  }
  if (!grant) denied();
  if (submission.capability === "work.request") {
    if (Date.parse(submission.payload.deadline) <= Date.now()) denied();
    for (const sharedRequestId of submission.payload.context) {
      const [shared] = await transaction.select().from(federationRequests).where(and(eq(federationRequests.id, sharedRequestId), eq(federationRequests.callerAgentId, row.callerAgentId), eq(federationRequests.targetAgentId, row.targetAgentId), eq(federationRequests.capability, "artifact.share"), eq(federationRequests.status, "COMPLETED"), gt(federationRequests.expiresAt, now())));
      if (!shared) denied();
    }
  }
  if (submission.capability === "artifact.share" && Date.parse(submission.payload.retrieval.expiresAt) <= Date.now()) denied();
  if (submission.capability === "message.send" && submission.payload.replyTo) {
    const [parent] = await transaction.select().from(federationRequests).where(eq(federationRequests.id, submission.payload.replyTo));
    if (!parent || parent.capability !== "message.send" || !["COMPLETED", "ACCEPTED"].includes(parent.status) || ![parent.callerAgentId, parent.targetAgentId].includes(row.callerAgentId) || ![parent.callerAgentId, parent.targetAgentId].includes(row.targetAgentId) || (parent.metadata as Metadata).conversationId !== submission.conversationId) denied();
  }
  return { grant, publication };
}
async function readSubmission(row: RequestRow, bindings: FederationBindings) {
  const submission = submissionSchema.parse(await unseal(row.targetOwnerId, row.encryptedPayload, bindings.keyWrapper));
  if (canonicalHash(submission) !== row.submissionHash || submission.capability !== row.capability || submission.resource !== row.resource) denied();
  return submission;
}
function policyAction(row: Pick<RequestRow, "id" | "targetOwnerId" | "targetAgentId" | "callerOwnerId" | "callerAgentId" | "capability" | "resource" | "submissionHash">): ActionIntent {
  const suffix = row.id.slice(4);
  const receivingCapability = row.capability === "message.send" ? "message.receive" : row.capability === "artifact.share" ? "artifact.receive" : row.capability;
  const material = { capability: { name: receivingCapability, version: "1.0" }, resource: { type: "federation_resource", ids: [row.resource] }, parameters: { requestId: row.id, callerOwnerId: row.callerOwnerId, callerAgentId: row.callerAgentId, submissionHash: row.submissionHash } };
  // Correlation IDs only, not a local platform Run or an execution workload/lease.
  return { schemaVersion: "relay.action-intent.v2", id: `act_${suffix}`, accountId: row.targetOwnerId, agentId: row.targetAgentId, runtimeClientId: `rtc_${suffix}`, taskId: `tsk_${suffix}`, ...material, idempotencyKey: row.id, createdAt: now(), canonicalHash: canonicalHash(material) };
}
async function policyInput(row: RequestRow, action: ActionIntent, approvalRequired: boolean) {
  const relationships = await db().select().from(federationRelationships).where(and(eq(federationRelationships.ownerId, row.targetOwnerId), inArray(federationRelationships.subject, [row.callerOwnerId, row.callerAgentId])));
  const known = relationships.some((relationship) => ["CONTACT", "TRUSTED"].includes(relationship.trust));
  const facts = { "recipient.relationship": known ? "known" : "new", "federation.caller_owner": row.callerOwnerId, "federation.caller_agent": row.callerAgentId, "federation.capability": row.capability };
  return { accountId: row.targetOwnerId, action, requiredApprovalClass: approvalRequired ? "federation.disclosure" : undefined,
    factResolvers: Object.entries(facts).map(([name, value]) => ({ name, resolve: async () => ({ name, value, authoritative: true, observedAt: now(), expiresAt: new Date(Date.now() + 60000).toISOString(), sourceRevision: canonicalHash({ name, value }) }) })),
    resourceResolver: { resolveOwnership: async () => ({ name: "resource.account_id", value: row.targetOwnerId, authoritative: true, observedAt: now(), expiresAt: new Date(Date.now() + 60000).toISOString(), sourceRevision: row.publicationVersion?.toString() ?? row.id }) },
  };
}
async function policy(row: RequestRow, action: ActionIntent, approvalRequired: boolean, bindings: FederationBindings) {
  const decision = await evaluatePolicy(await policyInput(row, action, approvalRequired), bindings.signer);
  const [record] = await db().select().from(policyDecisions).where(eq(policyDecisions.id, decision.decisionId));
  const authorityRevision = canonicalHash({ capability: record.capabilityDefinitionHash, bundles: record.policyBundleHashes, facts: (record.materialFacts as Array<{ name: string; value: unknown; sourceRevision: string }>).map(({ name, value, sourceRevision }) => ({ name, value, sourceRevision })) });
  return { ...decision, authorityRevision };
}
async function continuedApproval(transaction: RelayDatabase, row: RequestRow, metadata: Metadata, decision: Awaited<ReturnType<typeof policy>>) {
  if (decision.outcome !== "REQUIRE_APPROVAL") return;
  if (!metadata.approvalConsumed || metadata.approvalAuthorityRevision !== decision.authorityRevision || !row.approvalId) denied();
  const [approval] = await transaction.select().from(approvalRequests).where(and(eq(approvalRequests.id, row.approvalId), eq(approvalRequests.accountId, row.targetOwnerId), eq(approvalRequests.status, "APPROVED")));
  if (!approval) denied();
}
function validateSubmissionLifetime(submission: Submission) {
  if (Date.parse(submission.expiresAt) <= Date.now() || Date.parse(submission.expiresAt) > Date.now() + 86400000) throw new RelayError("INVALID_INPUT", "Request expiry must be within 24 hours.");
  if (submission.capability === "work.request" && (Date.parse(submission.payload.deadline) > Date.parse(submission.expiresAt) || Date.parse(submission.payload.deadline) <= Date.now())) throw new RelayError("INVALID_INPUT", "Work deadline must be within request lifetime.");
  if (submission.capability === "artifact.share") {
    const access = submission.payload.retrieval;
    const url = new URL(access.url);
    if (access.audience !== submission.target || url.protocol !== "https:" || url.username || url.password || Date.parse(access.expiresAt) <= Date.now() || Date.parse(access.expiresAt) > Math.min(Date.now() + 300000, Date.parse(submission.payload.expiresAt), Date.parse(submission.expiresAt))) denied();
  }
}
export async function submitFederationRequest(secret: string, value: unknown, bindings: FederationBindings) {
  const caller = await authenticateFederationAgent(secret);
  const submission = submissionSchema.parse(value);
  validateSubmissionLifetime(submission);
  await chargeRates([{ accountId: caller.ownerId, key: `owner:${caller.ownerId}`, limit: 120, seconds: 60 }, { accountId: caller.ownerId, key: `agent:${caller.agentId}`, limit: 60, seconds: 60 }]);
  const [target] = await db().select().from(federationAgents).where(eq(federationAgents.address, submission.target));
  if (!target || target.ownerId === caller.ownerId) denied();
  await chargeRates([{ accountId: target.ownerId, key: `target:${target.agentId}`, limit: 120, seconds: 60 }, { accountId: caller.ownerId, key: `capability:${caller.ownerId}:${submission.capability}`, limit: 60, seconds: 60 }, { accountId: target.ownerId, key: `resource:${target.ownerId}:${submission.resource}`, limit: 120, seconds: 60 }]);
  return withTransaction(async (transaction) => {
    await lockOwners(transaction, [caller.ownerId, target.ownerId]);
    const submissionHash = canonicalHash(submission);
    const [existing] = await transaction.select().from(federationRequests).where(and(eq(federationRequests.callerAgentId, caller.agentId), eq(federationRequests.idempotencyKey, submission.idempotencyKey)));
    if (existing) {
      if (existing.submissionHash !== submissionHash) throw new RelayError("INVALID_INPUT", "Idempotency key was reused with changed input.", undefined, 409);
      return { requestId: existing.id, status: existing.status, idempotentReplay: true };
    }
    const requestId = id("frq");
    const row: RequestRow = { id: requestId, callerOwnerId: caller.ownerId, callerAgentId: caller.agentId, callerCredentialId: caller.credentialId, targetOwnerId: target.ownerId, targetAgentId: target.agentId, capability: submission.capability, resource: submission.resource, idempotencyKey: submission.idempotencyKey, submissionHash, status: "CREATED", inboxStatus: "UNREAD", grantId: null, publicationVersion: null, policyDecisionId: null, approvalId: null, encryptedPayload: null, encryptedResult: null, metadata: {}, attempts: 0, nextAttemptAt: now(), expiresAt: submission.expiresAt, createdAt: now(), updatedAt: now() };
    const authorization = await authority(transaction, row, submission);
    row.grantId = authorization.grant.id;
    row.publicationVersion = authorization.publication?.version ?? null;
    const action = policyAction(row);
    const decision = await policy(row, action, authorization.grant.document.conditions.approvalRequired, bindings);
    if (["DENY", "ESCALATE"].includes(decision.outcome) || Object.keys(decision.obligations.limits).length) denied();
    row.policyDecisionId = decision.decisionId;
    row.status = decision.outcome === "REQUIRE_APPROVAL" ? "WAITING" : "AUTHORIZED";
    const metadata: Metadata = { action, ...(submission.conversationId ? { conversationId: submission.conversationId } : {}) };
    if (decision.outcome === "REQUIRE_APPROVAL") {
      const owners = await transaction.select().from(accountMemberships).where(and(eq(accountMemberships.accountId, row.targetOwnerId), eq(accountMemberships.role, "OWNER"), eq(accountMemberships.status, "ACTIVE")));
      const approval = await createApprovalRequest({ accountId: row.targetOwnerId, action, policyDecisionId: decision.decisionId, approvalClass: decision.obligations.approval!.classes[0], summary: `Federation ${submission.capability}`, consequence: "Permit delivery across owner trust domains. Receiving platform authorization is still required.", displayEvidence: { requestId, callerOwnerId: caller.ownerId, callerAgentId: caller.agentId, resource: submission.resource, publicationVersion: row.publicationVersion }, assignedPrincipalIds: owners.map((owner) => owner.principalId), expiresAt: row.expiresAt }, bindings.signer);
      row.approvalId = approval.requestId;
    }
    await chargeRates([{ accountId: row.targetOwnerId, key: `grant:${row.grantId}`, limit: authorization.grant.document.conditions.rateLimit.calls, seconds: authorization.grant.document.conditions.rateLimit.windowSeconds }]);
    if (submission.capability === "work.request") {
      const conditions = authorization.grant.document.conditions;
      if (!conditions.budgetId || !conditions.maxCost || amountUnits(submission.payload.budget.cost) <= 0n || amountUnits(submission.payload.budget.cost) > amountUnits(conditions.maxCost)) denied();
      const [budget] = await transaction.select().from(budgets).where(and(eq(budgets.id, conditions.budgetId), eq(budgets.accountId, row.targetOwnerId), eq(budgets.dimension, "MODEL_SPEND")));
      if (!budget || budget.balanceStatus !== "CURRENT") denied();
      const reservation = await reserveBudgetInTransaction(transaction, { accountId: row.targetOwnerId, leafBudgetId: budget.id, agentId: row.targetAgentId, taskId: action.taskId, actionIntentId: action.id, amount: submission.payload.budget.cost, idempotencyKey: requestId, expiresAt: row.expiresAt }, bindings.signer);
      metadata.reservationId = reservation.reservationId;
    }
    row.encryptedPayload = await seal(row.targetOwnerId, submission, bindings.keyWrapper);
    row.metadata = metadata;
    await transaction.insert(federationRequests).values(row);
    await transaction.insert(controlOutbox).values({ id: id("out"), accountId: row.targetOwnerId, aggregateType: "federation_request", aggregateId: requestId, type: "federation.request.accepted", payload: { requestId, status: row.status }, idempotencyKey: `federation:${requestId}` });
    await appendAuditRecordInTransaction(transaction, { accountId: caller.ownerId, agentId: caller.agentId, eventType: "federation.request.accepted", outcome: row.status, details: { requestId, targetAgentId: row.targetAgentId, capability: row.capability, resource: row.resource } }, bindings.signer);
    return { requestId, status: row.status, idempotentReplay: false };
  }).catch(async (error: unknown) => {
    // Authorization failures roll back admission, including any audit written in
    // that transaction. Persist the caller's denial separately after rollback.
    // Admission rate limits have already succeeded, bounding these signed writes.
    if (error instanceof RelayError && error.code === "CAPABILITY_DENIED") {
      await appendAuditRecord({ accountId: caller.ownerId, agentId: caller.agentId,
        eventType: "federation.request.denied", outcome: "DENIED",
        details: { targetAgentId: target.agentId, capability: submission.capability, resource: submission.resource, reasonCode: error.code },
      }, bindings.signer);
    }
    throw error;
  });
}

function projection(submission: Submission, publication: Awaited<ReturnType<typeof authority>>["publication"]) {
  if (submission.capability !== "knowledge.query" || !publication) return null;
  const entries = publication.document.entries.filter((entry) => submission.payload.requestedTypes.includes(entry.recordType)
    && (!submission.payload.topics.length || submission.payload.topics.some((topic) => entry.topics.includes(topic))))
    .slice(0, submission.payload.maxRecords);
  return { viewId: submission.resource, version: publication.version, visibility: publication.document.visibility, provenancePolicy: publication.document.provenancePolicy, entries };
}
async function terminal(transaction: RelayDatabase, row: RequestRow, status: "DENIED" | "EXPIRED" | "FAILED" | "CANCELLED" | "REJECTED") {
  await transaction.update(federationRequests).set({ status, inboxStatus: status === "EXPIRED" ? "EXPIRED" : "REJECTED", encryptedPayload: null, encryptedResult: null, updatedAt: now() }).where(eq(federationRequests.id, row.id));
}
export async function pollFederationInbox(secret: string, bindings: FederationBindings) {
  const recipient = await authenticateFederationAgent(secret);
  await chargeRates([{ accountId: recipient.ownerId, key: `poll:${recipient.agentId}`, limit: 120, seconds: 60 }]);
  const candidates = await db().select().from(federationRequests).where(and(eq(federationRequests.targetAgentId, recipient.agentId), inArray(federationRequests.status, ["AUTHORIZED", "DELIVERED", "WAITING"]), lte(federationRequests.nextAttemptAt, now()))).orderBy(asc(federationRequests.createdAt)).limit(10);
  const deliveries: Array<{ requestId: string; token: string; attempt: number }> = [];
  for (const candidate of candidates) {
    const delivery = await withTransaction(async (transaction) => {
      await lockOwners(transaction, [candidate.callerOwnerId, candidate.targetOwnerId]);
      const [row] = await transaction.select().from(federationRequests).where(eq(federationRequests.id, candidate.id));
      if (!row || !["AUTHORIZED", "DELIVERED", "WAITING"].includes(row.status) || Date.parse(row.nextAttemptAt) > Date.now()) return;
      if (Date.parse(row.expiresAt) <= Date.now()) { await terminal(transaction, row, "EXPIRED"); return; }
      if (row.attempts >= 3) { await terminal(transaction, row, "FAILED"); return; }
      const submission = await readSubmission(row, bindings);
      let authorization: Awaited<ReturnType<typeof authority>>;
      try { authorization = await authority(transaction, row, submission); } catch (error) {
        if (!(error instanceof RelayError) || error.code !== "CAPABILITY_DENIED") throw error;
        await terminal(transaction, row, "DENIED"); return;
      }
      const [target] = await transaction.select().from(federationAgents).where(eq(federationAgents.agentId, row.targetAgentId));
      if (target.availability === "OFFLINE") return;
      const metadata = row.metadata as Metadata;
      const decision = await policy(row, metadata.action, authorization.grant.document.conditions.approvalRequired, bindings);
      if (["DENY", "ESCALATE"].includes(decision.outcome) || Object.keys(decision.obligations.limits).length) { await terminal(transaction, row, "DENIED"); return; }
      if (decision.outcome === "REQUIRE_APPROVAL" && !metadata.approvalConsumed) {
        const [approval] = row.approvalId ? await transaction.select().from(approvalRequests).where(eq(approvalRequests.id, row.approvalId)) : [];
        if (!approval || !["PENDING", "APPROVED"].includes(approval.status) || Date.parse(approval.expiresAt) <= Date.now()) { await terminal(transaction, row, "DENIED"); return; }
        if (approval.status !== "APPROVED") return;
        // Exact existing policy decision remains required by the shared approval service.
        const [original] = await transaction.select().from(policyDecisions).where(eq(policyDecisions.id, approval.policyDecisionId));
        const [current] = await transaction.select().from(policyDecisions).where(eq(policyDecisions.id, decision.decisionId));
        if (!original || !current || canonicalHash(original.policyBundleHashes) !== canonicalHash(current.policyBundleHashes)) { await terminal(transaction, row, "DENIED"); return; }
        await consumeApprovalInTransaction(transaction, { accountId: row.targetOwnerId, requestId: approval.id, action: metadata.action, currentPolicyDecisionId: approval.policyDecisionId }, bindings.signer);
        metadata.approvalConsumed = true;
        metadata.approvalAuthorityRevision = decision.authorityRevision;
      }
      try { await continuedApproval(transaction, row, metadata, decision); }
      catch (error) { if (!(error instanceof RelayError)) throw error; await terminal(transaction, row, "DENIED"); return; }
      if (metadata.reservationId) {
        const [reservation] = await transaction.select().from(budgetReservations).where(and(eq(budgetReservations.id, metadata.reservationId), eq(budgetReservations.accountId, row.targetOwnerId), eq(budgetReservations.status, "RESERVED"), gt(budgetReservations.expiresAt, now())));
        if (!reservation) { await terminal(transaction, row, "DENIED"); return; }
        const balances = await transaction.select().from(budgets).where(inArray(budgets.id, reservation.appliedBudgetIds));
        if (balances.some((balance) => balance.balanceStatus !== "CURRENT" || balance.status !== "ACTIVE")) { await terminal(transaction, row, "DENIED"); return; }
      }
      const envelope = { id: row.id, protocol: "relay.federation", version: "1.0", caller: { ownerId: row.callerOwnerId, agentId: row.callerAgentId }, target: { ownerId: row.targetOwnerId, agentId: row.targetAgentId, address: recipient.address }, capability: submission.capability, resource: submission.resource, createdAt: new Date(row.createdAt).toISOString(), expiresAt: new Date(row.expiresAt).toISOString(), idempotencyKey: row.idempotencyKey, payload: submission.payload, publication: projection(submission, authorization.publication), authorizationContext: { grantId: row.grantId, policyDecisionId: decision.decisionId, localAuthorizationRequired: true }, ...(submission.conversationId ? { conversationId: submission.conversationId } : {}) };
      const token = await signDelivery(envelope, recipient.address, row.id, row.expiresAt, bindings);
      const attempt = row.attempts + 1;
      await transaction.insert(federationAttempts).values({ accountId: row.targetOwnerId, requestId: row.id, attempt });
      await transaction.update(federationRequests).set({ status: "DELIVERED", inboxStatus: "READ", attempts: attempt, nextAttemptAt: new Date(Date.now() + 30000 * 2 ** (attempt - 1)).toISOString(), metadata, updatedAt: now() }).where(eq(federationRequests.id, row.id));
      return { requestId: row.id, token, attempt };
    });
    if (delivery) deliveries.push(delivery);
  }
  return { deliveries };
}
const responseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("REJECTED") }).strict(),
  z.object({ status: z.literal("REQUIRE_APPROVAL") }).strict(),
  z.object({ status: z.literal("ACCEPTED") }).strict(),
  z.object({ status: z.literal("RUNNING") }).strict(),
  z.object({ status: z.literal("COMPLETED"), result: z.unknown() }).strict(),
]);
const workResultSchema = z.object({ summary: z.string().max(16000), artifacts: z.array(z.string().max(255)).max(10), evidence: z.array(z.string().max(255)).min(1).max(30), cost: z.string().regex(/^\d{1,6}(\.\d{1,9})?$/), runtimeSeconds: z.number().nonnegative(), modelSteps: z.number().int().nonnegative(), providerReceipts: z.array(z.string().max(255)).max(20) }).strict();
export async function respondToFederationRequest(secret: string, requestId: string, value: unknown, bindings: FederationBindings) {
  const recipient = await authenticateFederationAgent(secret);
  await chargeRates([{ accountId: recipient.ownerId, key: `respond:${recipient.agentId}`, limit: 120, seconds: 60 }]);
  const response = responseSchema.parse(value);
  const [candidate] = await db().select().from(federationRequests).where(and(eq(federationRequests.id, requestId), eq(federationRequests.targetAgentId, recipient.agentId), eq(federationRequests.targetOwnerId, recipient.ownerId)));
  if (!candidate) denied();
  return withTransaction(async (transaction) => {
    await lockOwners(transaction, [candidate.callerOwnerId, candidate.targetOwnerId]);
    const [row] = await transaction.select().from(federationRequests).where(eq(federationRequests.id, requestId));
    const metadata = row.metadata as Metadata;
    if (row.status === "COMPLETED" && response.status === "COMPLETED" && metadata.resultHash === canonicalHash(response.result)) return { requestId, status: "COMPLETED" };
    if (!activeStates.includes(row.status) || !row.attempts) denied();
    const submission = await readSubmission(row, bindings);
    const authorization = await authority(transaction, row, submission);
    if (response.status === "REJECTED") { await terminal(transaction, row, "REJECTED"); return { requestId, status: "REJECTED" }; }
    if (response.status === "REQUIRE_APPROVAL") {
      if (!["DELIVERED", "WAITING"].includes(row.status)) denied();
      // Local approval belongs to the receiving platform. Stop delivery retries.
      await transaction.update(federationRequests).set({ status: "WAITING", inboxStatus: "READ", nextAttemptAt: row.expiresAt, updatedAt: now() }).where(eq(federationRequests.id, row.id));
      return { requestId, status: "WAITING" };
    }
    if (response.status !== "COMPLETED") {
      if (response.status === "RUNNING" && !["ACCEPTED", "RUNNING"].includes(row.status)) denied();
      if (response.status === "ACCEPTED" && row.status === "RUNNING") denied();
      await transaction.update(federationRequests).set({ status: response.status, inboxStatus: "ACCEPTED", updatedAt: now() }).where(eq(federationRequests.id, row.id));
      await transaction.update(federationAttempts).set({ acknowledgedAt: now() }).where(and(eq(federationAttempts.accountId, row.targetOwnerId), eq(federationAttempts.requestId, row.id), eq(federationAttempts.attempt, row.attempts)));
      return { requestId, status: response.status };
    }
    if (!["ACCEPTED", "RUNNING"].includes(row.status)) denied();
    const currentPolicy = await policy(row, metadata.action, authorization.grant.document.conditions.approvalRequired, bindings);
    if (["DENY", "ESCALATE"].includes(currentPolicy.outcome) || Object.keys(currentPolicy.obligations.limits).length || (currentPolicy.outcome === "REQUIRE_APPROVAL" && !metadata.approvalConsumed)) denied();
    await continuedApproval(transaction, row, metadata, currentPolicy);
    let result: unknown;
    let records: Array<{ reference: string; recordType: string }> = [];
    if (submission.capability === "knowledge.query") {
      const knowledge = knowledgeResponseSchema.parse(response.result);
      const allowed = projection(submission, authorization.publication)!;
      if (knowledge.publicationVersion !== row.publicationVersion || knowledge.records.length > submission.payload.maxRecords || new Set(knowledge.records.map((record) => record.reference)).size !== knowledge.records.length) denied();
      for (const record of knowledge.records) if (!allowed.entries.some((entry) => entry.reference === record.reference && entry.revision === record.revision && entry.recordType === record.recordType)) denied();
      if (submission.payload.mode === "RECORD_RETRIEVAL" && (knowledge.kind !== "OWNER_PUBLISHED_KNOWLEDGE" || knowledge.answer !== undefined)) denied();
      if (knowledge.answer !== undefined && knowledge.kind !== "PUBLISHER_AGENT_SYNTHESIS") denied();
      records = knowledge.records.map(({ reference, recordType }) => ({ reference, recordType }));
      result = { ...knowledge, ownerId: row.targetOwnerId, publisherAgentId: row.targetAgentId, visibility: allowed.visibility, usage: "Published projection; no authority to access other local data." };
    } else if (submission.capability === "work.request") {
      result = workResultSchema.parse(response.result);
      const work = result as z.infer<typeof workResultSchema>;
      if (work.runtimeSeconds > submission.payload.budget.runtimeSeconds || work.modelSteps > submission.payload.budget.modelSteps || amountUnits(work.cost) > amountUnits(submission.payload.budget.cost)) denied();
    } else result = z.object({ acknowledged: z.literal(true) }).strict().parse(response.result);
    const encryptedResult = await seal(row.callerOwnerId, result, bindings.keyWrapper);
    if (submission.capability === "work.request") {
      if (!metadata.reservationId) denied();
      await reconcileBudgetReservation({ accountId: row.targetOwnerId, reservationId: metadata.reservationId, actualAmount: (result as z.infer<typeof workResultSchema>).cost, usageIdempotencyKey: `federation-result:${row.id}`, source: `federation-platform:${row.targetAgentId}`, occurredAt: now() }, bindings.signer);
    }
    metadata.deliveryHash = canonicalHash(result);
    metadata.resultHash = canonicalHash(response.result);
    await transaction.update(federationRequests).set({ status: "COMPLETED", inboxStatus: "ACCEPTED", encryptedResult, metadata, updatedAt: now() }).where(eq(federationRequests.id, row.id));
    const details = { requestId, callerAgentId: row.callerAgentId, targetAgentId: row.targetAgentId, capability: row.capability, viewId: submission.capability === "knowledge.query" ? row.resource : null, publicationVersion: row.publicationVersion, records, count: records.length, grantId: row.grantId, policyDecisionId: row.policyDecisionId };
    for (const ownerId of [row.callerOwnerId, row.targetOwnerId].sort()) await appendAuditRecordInTransaction(transaction, { accountId: ownerId, eventType: "federation.disclosure", outcome: "COMPLETED", details }, bindings.signer);
    return { requestId, status: "COMPLETED" };
  });
}
export async function getFederationRequest(secret: string, requestId: string, bindings: FederationBindings) {
  const caller = await authenticateFederationAgent(secret);
  await chargeRates([{ accountId: caller.ownerId, key: `get:${caller.agentId}`, limit: 120, seconds: 60 }]);
  const [row] = await db().select().from(federationRequests).where(and(eq(federationRequests.id, requestId), eq(federationRequests.callerAgentId, caller.agentId), eq(federationRequests.callerOwnerId, caller.ownerId)));
  if (!row) denied();
  return withTransaction(async (transaction) => {
    await lockOwners(transaction, [row.callerOwnerId, row.targetOwnerId]);
    const [current] = await transaction.select().from(federationRequests).where(eq(federationRequests.id, row.id));
    if (Date.parse(current.expiresAt) <= Date.now()) { await terminal(transaction, current, "EXPIRED"); return { requestId, status: "EXPIRED" }; }
    let result: unknown;
    if (current.status === "COMPLETED" && current.encryptedResult) {
      const submission = await readSubmission(current, bindings);
      const authorization = await authority(transaction, current, submission);
      const metadata = current.metadata as Metadata;
      const decision = await policy(current, metadata.action, authorization.grant.document.conditions.approvalRequired, bindings);
      if (["DENY", "ESCALATE"].includes(decision.outcome) || Object.keys(decision.obligations.limits).length || (decision.outcome === "REQUIRE_APPROVAL" && !metadata.approvalConsumed)) denied();
      await continuedApproval(transaction, current, metadata, decision);
      result = await unseal(current.callerOwnerId, current.encryptedResult, bindings.keyWrapper);
      if (metadata.deliveryHash !== canonicalHash(result)) denied();
    }
    return { requestId, status: current.status, attempts: current.attempts, ...(result === undefined ? {} : { result }) };
  });
}
export async function acknowledgeFederationResult(secret: string, requestId: string) {
  const caller = await authenticateFederationAgent(secret);
  await db().update(federationRequests).set({ encryptedPayload: null, encryptedResult: null, updatedAt: now() }).where(and(eq(federationRequests.id, requestId), eq(federationRequests.callerAgentId, caller.agentId), eq(federationRequests.status, "COMPLETED")));
  return { requestId, acknowledged: true };
}

type InspectionStatus = "ACTIVE" | "MISSING" | "EXPIRED" | "REVOKED" | "NOT_YET_ACTIVE" | "PEER_UNAVAILABLE" | "RESOURCE_NOT_AUTHORIZED" | "CAPABILITY_NOT_AUTHORIZED" | "DENIED";

/** Observes the exact proposed request. Never admits it or returns reusable authority. */
export async function inspectFederationAuthority(secret: string, value: unknown) {
  const caller = await authenticateFederationAgent(secret);
  const submission = submissionSchema.parse(value);
  validateSubmissionLifetime(submission);
  await chargeRates([
    { accountId: caller.ownerId, key: `inspect-owner:${caller.ownerId}`, limit: 120, seconds: 60 },
    { accountId: caller.ownerId, key: `inspect-agent:${caller.agentId}`, limit: 60, seconds: 60 },
  ]);
  const result = (status: InspectionStatus, expiresAt: string | null = null, approvalRequired = false) => ({
    authorized: status === "ACTIVE", status, expiresAt, approvalRequired,
    observedAt: now(), executionRecheckRequired: true as const,
  });
  const [target] = await db().select().from(federationAgents).where(eq(federationAgents.address, submission.target));
  if (!target || target.ownerId === caller.ownerId) return result("MISSING");
  return withTransaction(async (transaction) => {
    await lockOwners(transaction, [caller.ownerId, target.ownerId]);
    // Only grants relevant to this credential's own account and Agent may inform diagnostics.
    const rows = await transaction.select().from(federationGrants).where(and(
      eq(federationGrants.ownerId, target.ownerId), eq(federationGrants.granteeOwnerId, caller.ownerId),
    ));
    const scoped = rows.map(row => ({ ...row, document: grantSchema.parse(row.document) })).filter(({ document }) =>
      (!document.granteeAgentId || document.granteeAgentId === caller.agentId) &&
      (!document.grantorAgentId || document.grantorAgentId === target.agentId));
    const exact = scoped.filter(row => row.capability === submission.capability && row.resource === submission.resource);
    // Private, unpublished, and inaccessible views are indistinguishable from nonexistent resources.
    if (submission.capability === "knowledge.query") {
      const [view] = await transaction.select().from(publishedViews).where(and(
        eq(publishedViews.id, submission.resource), eq(publishedViews.ownerId, target.ownerId),
        eq(publishedViews.publisherAgentId, target.agentId), eq(publishedViews.status, "ACTIVE"),
      ));
      if (!view) return result("MISSING");
      const document = viewSchema.parse(view.document);
      if (document.visibility === "PRIVATE" || Date.parse(document.expiresAt) <= Date.now() ||
        (document.visibility === "SHARED" && !document.allowedAudience.some(a => a.ownerId === caller.ownerId && (!a.agentId || a.agentId === caller.agentId))) ||
        (!exact.length && !(document.visibility === "PUBLIC" && document.publicQueryPolicy))) return result("MISSING");
    }
    try { await assertNotBlocked(transaction, caller, target); }
    catch (error) { if (error instanceof RelayError && error.code === "CAPABILITY_DENIED") return result("MISSING"); throw error; }
    const [peer] = await transaction.select().from(agents).where(and(eq(agents.id, target.agentId), eq(agents.accountId, target.ownerId)));
    const [profile] = await transaction.select().from(federationAgents).where(eq(federationAgents.agentId, target.agentId));
    if (!peer || peer.status !== "ACTIVE" || !profile || ["REVOKED", "PAUSED"].includes(profile.availability))
      return result(exact.length ? "PEER_UNAVAILABLE" : "MISSING");
    const requestId = id("frq");
    const row: RequestRow = {
      id: requestId, callerOwnerId: caller.ownerId, callerAgentId: caller.agentId, callerCredentialId: caller.credentialId,
      targetOwnerId: target.ownerId, targetAgentId: target.agentId, capability: submission.capability, resource: submission.resource,
      idempotencyKey: submission.idempotencyKey, submissionHash: canonicalHash(submission), status: "CREATED", inboxStatus: "UNREAD",
      grantId: null, publicationVersion: null, policyDecisionId: null, approvalId: null, encryptedPayload: null, encryptedResult: null,
      metadata: {}, attempts: 0, nextAttemptAt: now(), expiresAt: submission.expiresAt, createdAt: now(), updatedAt: now(),
    };
    try {
      const access = await authority(transaction, row, submission);
      row.publicationVersion = access.publication?.version ?? null;
      const decision = await inspectPolicy(await policyInput(row, policyAction(row), access.grant.document.conditions.approvalRequired));
      if (["DENY", "ESCALATE"].includes(decision.outcome) || Object.keys(decision.obligations.limits).length) return result("DENIED");
      return result("ACTIVE", access.grant.document.conditions.expiresAt, decision.outcome === "REQUIRE_APPROVAL");
    } catch (error) {
      if (!(error instanceof RelayError) || error.code !== "CAPABILITY_DENIED") throw error;
      // Diagnostics never replace execution's canonical grant selection or public fallback.
      const active = exact.filter(row => row.status === "ACTIVE");
      if (active.some(row => (row.document.conditions.expiresAt === null || Date.parse(row.document.conditions.expiresAt) > Date.now()) &&
        (!row.document.conditions.notBefore || Date.parse(row.document.conditions.notBefore) <= Date.now()))) return result("DENIED");
      if (active.some(row => (row.document.conditions.expiresAt === null || Date.parse(row.document.conditions.expiresAt) > Date.now()))) return result("NOT_YET_ACTIVE");
      if (active.length) return result("EXPIRED", active.map(row => row.document.conditions.expiresAt).sort().at(-1)!);
      // Historical revocations must not mask a replacement grant's current
      // timing state. Execution still uses the canonical authority check above.
      if (exact.some(row => row.status === "REVOKED")) return result("REVOKED");
      if (submission.capability !== "knowledge.query") {
        if (scoped.some(row => row.resource === submission.resource)) return result("CAPABILITY_NOT_AUTHORIZED");
        if (scoped.some(row => row.capability === submission.capability)) return result("RESOURCE_NOT_AUTHORIZED");
      }
      return result("MISSING");
    }
  });
}
export async function expireFederationContent(bindings?: FederationBindings) {
  if (bindings) {
    const owners = await db().selectDistinct({ ownerId: federationRequests.targetOwnerId }).from(federationRequests).where(lte(federationRequests.expiresAt, now()));
    for (const owner of owners) await expireBudgetReservations(owner.ownerId, bindings.signer);
  }
  await db().update(federationRequests).set({ encryptedPayload: null, encryptedResult: null, status: sql`CASE WHEN ${federationRequests.status} IN ('COMPLETED', 'DENIED', 'REJECTED', 'FAILED', 'CANCELLED') THEN ${federationRequests.status} ELSE 'EXPIRED' END`, updatedAt: now() }).where(lte(federationRequests.expiresAt, now()));
  await db().delete(federationRateWindows).where(lte(federationRateWindows.resetAt, now()));
}
