import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, withTransaction, type RelayDatabase } from "@/lib/db";
import { accountMemberships, approvalConsumptions, approvalDecisions, approvalNotifications, approvalRequests, capabilityDefinitions, policyDecisions, principals } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { actionIntentSchema, approvalScopeSchema, canonicalHash, type ActionIntent, type ApprovalScope } from "@/lib/v2/contracts";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { redactForEvidence } from "@/lib/v2/evidence/redaction";
import { requireMembership } from "@/lib/v2/identity";
import { z } from "zod";

type AuthenticationEvidence = { sessionId: string; method: "password" | "webauthn" | "oidc_acr"; authenticatedAt: string; stepUpChallengeId?: string };
const authenticationEvidenceSchema = z.object({ sessionId: z.string().min(1).max(255), method: z.enum(["password", "webauthn", "oidc_acr"]), authenticatedAt: z.string().datetime({ offset: true }), stepUpChallengeId: z.string().optional() }).strict();

function actionMaterial(action: ActionIntent) { return { capability: action.capability, resource: action.resource, parameters: action.parameters }; }

function sameResource(scope: Extract<ApprovalScope, { kind: "task" | "session" }>["resource"], action: ActionIntent) {
  if (scope.type !== action.resource.type) return false;
  if (scope.ids && action.resource.ids?.some((resourceId) => !scope.ids!.includes(resourceId))) return false;
  return Object.entries(scope.attributes ?? {}).every(([key, value]) => action.resource.attributes?.[key] !== undefined && canonicalHash(action.resource.attributes[key]) === canonicalHash(value));
}

function scopeMatches(scope: ApprovalScope, request: typeof approvalRequests.$inferSelect, action: ActionIntent, sessionId?: string) {
  if (scope.kind === "once") return scope.actionHash === action.canonicalHash && request.actionHash === action.canonicalHash;
  if (request.actionHash !== action.canonicalHash || scope.capability.name !== action.capability.name || scope.capability.version !== action.capability.version || !sameResource(scope.resource, action)) return false;
  if (scope.kind === "task") return scope.taskId === action.taskId;
  return Boolean(sessionId && request.sessionId === sessionId && scope.sessionId === sessionId);
}

function policyApprovalObligation(value: unknown) {
  const obligations = value as { approval?: { classes?: string[]; allowedScopes?: string[] } };
  if (!obligations.approval?.classes?.length || !obligations.approval.allowedScopes?.length) throw new RelayError("CAPABILITY_DENIED", "Policy decision has no approval obligation.", undefined, 403);
  return obligations.approval as { classes: string[]; allowedScopes: string[] };
}

export async function createApprovalRequest(input: { accountId: string; action: ActionIntent; policyDecisionId: string; approvalClass: string; summary: string; consequence: string; displayEvidence: Record<string, unknown>; assignedPrincipalIds: string[]; sessionId?: string; expiresAt: string }, signer: AuditSigner) {
  const action = actionIntentSchema.parse(input.action);
  if (action.accountId !== input.accountId || canonicalHash(actionMaterial(action)) !== action.canonicalHash) throw new RelayError("INVALID_INPUT", "Action intent account or hash is invalid.");
  if (!input.assignedPrincipalIds.length) throw new RelayError("INVALID_INPUT", "At least one approver must be assigned.");
  const timestamp = now();
  const [decision] = await db().select().from(policyDecisions).where(and(eq(policyDecisions.id, input.policyDecisionId), eq(policyDecisions.accountId, input.accountId), eq(policyDecisions.actionIntentId, action.id), eq(policyDecisions.agentId, action.agentId), eq(policyDecisions.outcome, "REQUIRE_APPROVAL"), gt(policyDecisions.expiresAt, timestamp))).limit(1);
  if (!decision) throw new RelayError("CAPABILITY_DENIED", "A current matching approval policy decision is required.", undefined, 403);
  const obligation = policyApprovalObligation(decision.obligations);
  if (!obligation.classes.includes(input.approvalClass)) throw new RelayError("CAPABILITY_DENIED", "Approval class is not allowed by policy.", undefined, 403);
  const [capability] = await db().select({ effectClass: capabilityDefinitions.effectClass, riskClass: capabilityDefinitions.riskClass }).from(capabilityDefinitions).where(eq(capabilityDefinitions.definitionHash, decision.capabilityDefinitionHash)).limit(1);
  if (!capability) throw new RelayError("CAPABILITY_DENIED", "Capability definition is unavailable.", undefined, 403);
  const assigned = await db().select({ principalId: accountMemberships.principalId }).from(accountMemberships).innerJoin(principals, eq(principals.id, accountMemberships.principalId)).where(and(eq(accountMemberships.accountId, input.accountId), inArray(accountMemberships.principalId, input.assignedPrincipalIds), inArray(accountMemberships.role, ["OWNER", "ADMIN", "APPROVER"]), eq(accountMemberships.status, "ACTIVE"), eq(principals.status, "ACTIVE")));
  if (new Set(assigned.map((entry) => entry.principalId)).size !== new Set(input.assignedPrincipalIds).size) throw new RelayError("CAPABILITY_DENIED", "Every assigned approver must be active in the account.", undefined, 403);
  const facts = decision.materialFacts as Array<{ name: string; value: unknown }>;
  const recipientRelationship = facts.find((fact) => fact.name === "recipient.relationship")?.value;
  const hardOnce = capability.effectClass === "financial" || capability.effectClass === "destructive" || (capability.effectClass === "communication" && recipientRelationship !== "known");
  const policyScopes = new Set(obligation.allowedScopes);
  policyScopes.add("once");
  const allowedScopes = hardOnce ? ["once"] : ["once", "task", "session"].filter((scope) => policyScopes.has(scope));
  const requestId = id("apr");
  const expiresAt = new Date(Math.min(Date.parse(input.expiresAt), Date.parse(decision.expiresAt))).toISOString();
  if (Date.parse(expiresAt) <= Date.parse(timestamp)) throw new RelayError("INVALID_INPUT", "Approval expiry must be in the future.");
  const displayEvidence = redactForEvidence(input.displayEvidence);
  await withTransaction(async (transaction) => {
    await transaction.insert(approvalRequests).values({ id: requestId, accountId: input.accountId, actionIntentId: action.id, actionHash: action.canonicalHash, actionSnapshot: redactForEvidence(action), agentId: action.agentId, runtimeClientId: action.runtimeClientId, taskId: action.taskId, sessionId: input.sessionId, policyDecisionId: decision.id, approvalClass: input.approvalClass, riskClass: capability.riskClass, effectClass: capability.effectClass, summary: input.summary, consequence: input.consequence, displayEvidence, allowedScopes, assignedPrincipalIds: [...new Set(input.assignedPrincipalIds)], expiresAt });
    for (const principalId of new Set(input.assignedPrincipalIds)) await transaction.insert(approvalNotifications).values({ id: id("ntf"), accountId: input.accountId, approvalRequestId: requestId, principalId, eventType: "approval.requested", payload: redactForEvidence({ requestId, summary: input.summary, consequence: input.consequence, expiresAt }) });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, agentId: action.agentId, runtimeClientId: action.runtimeClientId, taskId: action.taskId, actionIntentId: action.id, policyDecisionId: decision.id, eventType: "approval.requested", outcome: "PENDING", details: { requestId, approvalClass: input.approvalClass, allowedScopes, assignedPrincipalIds: input.assignedPrincipalIds } }, signer);
  });
  return { requestId, allowedScopes, expiresAt };
}

export async function decideApproval(input: { accountId: string; requestId: string; principalId: string; decision: "APPROVE" | "DENY"; scope?: ApprovalScope; reason?: string; authenticationEvidence: AuthenticationEvidence }, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.principalId, allowedRoles: ["OWNER", "ADMIN", "APPROVER"] });
  const authenticationEvidence = authenticationEvidenceSchema.parse(input.authenticationEvidence);
  const timestamp = now();
  return await withTransaction(async (transaction) => {
    const [request] = await transaction.select().from(approvalRequests).where(and(eq(approvalRequests.accountId, input.accountId), eq(approvalRequests.id, input.requestId), eq(approvalRequests.status, "PENDING"), gt(approvalRequests.expiresAt, timestamp))).limit(1);
    if (!request) throw new RelayError("CAPABILITY_DENIED", "Pending approval request is unavailable or expired.", undefined, 403);
    if (!request.assignedPrincipalIds.includes(input.principalId)) throw new RelayError("CAPABILITY_DENIED", "Principal is not assigned to this approval.", undefined, 403);
    let scope: ApprovalScope | undefined;
    if (input.decision === "APPROVE") {
      scope = approvalScopeSchema.parse(input.scope);
      if (!request.allowedScopes.includes(scope.kind)) throw new RelayError("CAPABILITY_DENIED", "Requested approval scope is not allowed.", undefined, 403);
      const originalAction = actionIntentSchema.parse(request.actionSnapshot);
      if (!scopeMatches(scope, request, originalAction, request.sessionId ?? undefined)) throw new RelayError("CAPABILITY_DENIED", "Approval scope does not match the immutable action.", undefined, 403);
    }
    const decisionId = id("apd");
    const material = { decisionId, requestId: request.id, accountId: input.accountId, principalId: input.principalId, decision: input.decision, scope: scope ?? null, actionHash: request.actionHash, policyDecisionId: request.policyDecisionId, decidedAt: timestamp };
    const decisionHash = canonicalHash(material);
    const signature = await signer.sign(decisionHash);
    const updated = await transaction.update(approvalRequests).set({ status: input.decision === "APPROVE" ? "APPROVED" : "DENIED", approvedScope: scope, maxUses: scope && scope.kind !== "once" ? scope.maxUses : 1, decidedAt: timestamp }).where(and(eq(approvalRequests.accountId, input.accountId), eq(approvalRequests.id, request.id), eq(approvalRequests.status, "PENDING"))).returning({ id: approvalRequests.id });
    if (!updated.length) throw new RelayError("CAPABILITY_DENIED", "Approval was already decided.", undefined, 409);
    await transaction.insert(approvalDecisions).values({ id: decisionId, accountId: input.accountId, approvalRequestId: request.id, principalId: input.principalId, decision: input.decision, scope, reason: input.reason, decisionHash, signature, signingKeyId: signer.keyId, authenticationEvidence: redactForEvidence(authenticationEvidence), createdAt: timestamp });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.principalId, agentId: request.agentId, runtimeClientId: request.runtimeClientId, taskId: request.taskId, actionIntentId: request.actionIntentId, policyDecisionId: request.policyDecisionId, approvalDecisionId: decisionId, eventType: `approval.${input.decision.toLowerCase()}`, outcome: input.decision, details: { requestId: request.id, scope: scope ?? null, decisionHash } }, signer);
    return { decisionId, decisionHash, signature, signingKeyId: signer.keyId };
  });
}

export async function consumeApprovalInTransaction(transaction: RelayDatabase, input: { accountId: string; requestId: string; action: ActionIntent; currentPolicyDecisionId: string; sessionId?: string }, signer: AuditSigner) {
  const action = actionIntentSchema.parse(input.action);
  if (action.accountId !== input.accountId || canonicalHash(actionMaterial(action)) !== action.canonicalHash) throw new RelayError("INVALID_INPUT", "Action intent account or hash is invalid.");
  const timestamp = now();
  const [request] = await transaction.select().from(approvalRequests).where(and(eq(approvalRequests.accountId, input.accountId), eq(approvalRequests.id, input.requestId), eq(approvalRequests.status, "APPROVED"), gt(approvalRequests.expiresAt, timestamp))).limit(1);
  if (!request || request.policyDecisionId !== input.currentPolicyDecisionId) throw new RelayError("CAPABILITY_DENIED", "Approval is unavailable, expired, or stale.", undefined, 403);
  const [policy] = await transaction.select({ id: policyDecisions.id }).from(policyDecisions).where(and(eq(policyDecisions.accountId, input.accountId), eq(policyDecisions.id, input.currentPolicyDecisionId), gt(policyDecisions.expiresAt, timestamp))).limit(1);
  if (!policy) throw new RelayError("CAPABILITY_DENIED", "Policy decision is stale.", undefined, 403);
  const scope = approvalScopeSchema.parse(request.approvedScope);
  if (!scopeMatches(scope, request, action, input.sessionId)) throw new RelayError("CAPABILITY_DENIED", "Action was modified or is outside approval scope.", undefined, 403);
  const [consumed] = await transaction.update(approvalRequests).set({ useCount: sql`${approvalRequests.useCount} + 1` }).where(and(eq(approvalRequests.accountId, input.accountId), eq(approvalRequests.id, request.id), sql`${approvalRequests.useCount} < ${approvalRequests.maxUses}`)).returning({ useCount: approvalRequests.useCount });
  if (!consumed) throw new RelayError("CAPABILITY_DENIED", "Approval scope is exhausted.", undefined, 409);
  const consumptionId = id("apc");
  await transaction.insert(approvalConsumptions).values({ id: consumptionId, accountId: input.accountId, approvalRequestId: request.id, actionIntentId: action.id, actionHash: action.canonicalHash, consumedAt: timestamp });
  await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, agentId: action.agentId, runtimeClientId: action.runtimeClientId, taskId: action.taskId, actionIntentId: action.id, policyDecisionId: policy.id, eventType: "approval.consumed", outcome: "SUCCESS", details: { requestId: request.id, consumptionId, useCount: consumed.useCount, maxUses: request.maxUses } }, signer);
  return { consumptionId, remainingUses: request.maxUses - consumed.useCount };
}

export async function consumeApproval(input: Parameters<typeof consumeApprovalInTransaction>[1], signer: AuditSigner) {
  return await withTransaction((transaction) => consumeApprovalInTransaction(transaction, input, signer));
}

export async function revokeApproval(input: { accountId: string; requestId: string; principalId: string }, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.principalId, allowedRoles: ["OWNER", "ADMIN", "APPROVER"] });
  await withTransaction(async (transaction) => {
    const [request] = await transaction.update(approvalRequests).set({ status: "REVOKED", revokedAt: now() }).where(and(eq(approvalRequests.accountId, input.accountId), eq(approvalRequests.id, input.requestId), eq(approvalRequests.status, "APPROVED"))).returning();
    if (!request) throw new RelayError("INVALID_INPUT", "Approved request not found.", undefined, 404);
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.principalId, agentId: request.agentId, taskId: request.taskId, actionIntentId: request.actionIntentId, policyDecisionId: request.policyDecisionId, eventType: "approval.revoked", outcome: "REVOKED", details: { requestId: request.id } }, signer);
  });
}

export async function supersedeApproval(input: { accountId: string; requestId: string; supersededById: string }, signer: AuditSigner) {
  await withTransaction(async (transaction) => {
    const [request] = await transaction.update(approvalRequests).set({ status: "SUPERSEDED", supersededById: input.supersededById }).where(and(eq(approvalRequests.accountId, input.accountId), eq(approvalRequests.id, input.requestId), eq(approvalRequests.status, "PENDING"))).returning();
    if (!request) throw new RelayError("INVALID_INPUT", "Pending approval request not found.", undefined, 404);
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, agentId: request.agentId, taskId: request.taskId, actionIntentId: request.actionIntentId, policyDecisionId: request.policyDecisionId, eventType: "approval.superseded", outcome: "SUPERSEDED", details: { requestId: request.id, supersededById: input.supersededById } }, signer);
  });
}

export async function expireApprovalRequests(accountId: string, signer: AuditSigner, timestamp = now()) {
  return await withTransaction(async (transaction) => {
    const expired = await transaction.update(approvalRequests).set({ status: "EXPIRED" }).where(and(eq(approvalRequests.accountId, accountId), eq(approvalRequests.status, "PENDING"), sql`${approvalRequests.expiresAt} <= ${timestamp}`)).returning();
    for (const request of expired) await appendAuditRecordInTransaction(transaction, { accountId, agentId: request.agentId, taskId: request.taskId, actionIntentId: request.actionIntentId, policyDecisionId: request.policyDecisionId, eventType: "approval.expired", outcome: "EXPIRED", details: { requestId: request.id } }, signer);
    return expired.length;
  });
}

export async function listApprovalRequests(accountId: string) {
  return await db().select().from(approvalRequests).where(eq(approvalRequests.accountId, accountId)).orderBy(asc(approvalRequests.createdAt));
}
