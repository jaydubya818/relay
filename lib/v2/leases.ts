import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { hashSecret } from "@/lib/crypto";
import { db, withTransaction } from "@/lib/db";
import { agentPassports, agentRevocationEpochs, budgetReservations, budgets, capabilityDefinitions, capabilityLeases, leaseCallReceipts, policyDecisions, runtimeClients, workloadBootstraps, workloads } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { consumeApprovalInTransaction } from "@/lib/v2/approvals";
import { actionIntentSchema, agentPassportSchema, canonicalHash, canonicalJson, capabilityLeaseClaimsSchema, type ActionIntent, type CapabilityLeaseClaims } from "@/lib/v2/contracts";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import { verifyAuditSignature, type AuditSigner } from "@/lib/v2/evidence/crypto";

type Assurance = "registered" | "attested" | "managed-equivalent";
const ASSURANCE_RANK: Record<Assurance, number> = { registered: 0, attested: 1, "managed-equivalent": 2 };

const workloadClaimsSchema = z.object({ iss: z.string().url(), sub: z.string().regex(/^wkl_/), aud: z.string().min(1), accountId: z.string().regex(/^acct_/), agentId: z.string().regex(/^agt_/), runtimeClientId: z.string().regex(/^rtc_/), taskId: z.string().regex(/^tsk_/), providerId: z.string().min(1), assurance: z.enum(["registered", "attested", "managed-equivalent"]), publicKeyThumbprint: z.string().regex(/^sha256:/), iat: z.number().int(), exp: z.number().int() }).strict();
function issuer() {
  const configured = process.env.RELAY_ISSUER_URL;
  if (configured) return new URL(configured).toString().replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") throw new Error("RELAY_ISSUER_URL is required in production.");
  return "https://relay.local";
}

function encode(value: unknown) { return Buffer.from(canonicalJson(value)).toString("base64url"); }

async function signToken<T>(type: "RLY-WORKLOAD" | "RLY-LEASE", claims: T, signer: AuditSigner) {
  const encodedHeader = encode({ alg: "EdDSA", kid: signer.keyId, typ: type });
  const encodedPayload = encode(claims);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  return `${signingInput}.${await signer.sign(signingInput)}`;
}

function decodeToken(token: string) {
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) throw new RelayError("INVALID_CREDENTIAL", "Malformed signed token.", undefined, 401);
  try {
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString()) as { alg?: string; kid?: string; typ?: string };
    if (header.alg !== "EdDSA" || !header.kid) throw new Error("unsupported header");
    return { header, payload: JSON.parse(Buffer.from(encodedPayload, "base64url").toString()) as unknown, signature, signingInput: `${encodedHeader}.${encodedPayload}` };
  } catch {
    throw new RelayError("INVALID_CREDENTIAL", "Malformed or unsupported signed token.", undefined, 401);
  }
}

export interface LeaseKeyResolver { publicKeyForKeyId(keyId: string): Promise<string | undefined>; }
export interface OfflineLeaseCounter { consume(leaseId: string, callId: string, maxCalls: number): Promise<boolean>; }

async function verifyWithResolver(token: string, expectedType: string, resolver: LeaseKeyResolver) {
  const decoded = decodeToken(token);
  if (decoded.header.typ !== expectedType) throw new RelayError("INVALID_CREDENTIAL", "Signed token type is invalid.", undefined, 401);
  const publicKey = await resolver.publicKeyForKeyId(decoded.header.kid!);
  if (!publicKey || !verifyAuditSignature(publicKey, decoded.signingInput, decoded.signature)) throw new RelayError("INVALID_CREDENTIAL", "Signed token verification failed.", undefined, 401);
  return decoded.payload;
}

export async function createWorkloadBootstrap(input: { accountId: string; agentId: string; runtimeClientId: string; taskId: string; runnerId?: string; providerId: string; assurance: Assurance; audience: string; publicKeyPem: string; ttlSeconds?: number }, signer: AuditSigner) {
  createPublicKey(input.publicKeyPem);
  const timestamp = now();
  const [runtime] = await db().select({ id: runtimeClients.id }).from(runtimeClients).where(and(eq(runtimeClients.accountId, input.accountId), eq(runtimeClients.id, input.runtimeClientId), isNull(runtimeClients.revokedAt))).limit(1);
  const [passport] = await db().select({ id: agentPassports.id }).from(agentPassports).where(and(eq(agentPassports.accountId, input.accountId), eq(agentPassports.agentId, input.agentId), eq(agentPassports.status, "ACTIVE"), gt(agentPassports.expiresAt, timestamp))).limit(1);
  if (!runtime || !passport) throw new RelayError("CAPABILITY_DENIED", "Runtime client or Agent Passport is unavailable.", undefined, 403);
  const workloadId = id("wkl");
  const bootstrapId = id("wbs");
  const secret = `wbs_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + Math.min(Math.max(input.ttlSeconds ?? 120, 30), 300) * 1_000).toISOString();
  const workloadExpiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const publicKeyThumbprint = `sha256:${createHash("sha256").update(createPublicKey(input.publicKeyPem).export({ type: "spki", format: "der" })).digest("hex")}`;
  await withTransaction(async (transaction) => {
    await transaction.insert(workloads).values({ id: workloadId, accountId: input.accountId, agentId: input.agentId, runtimeClientId: input.runtimeClientId, taskId: input.taskId, runnerId: input.runnerId, providerId: input.providerId, assurance: input.assurance, audience: input.audience, publicKeyPem: input.publicKeyPem, publicKeyThumbprint, expiresAt: workloadExpiresAt });
    await transaction.insert(workloadBootstraps).values({ id: bootstrapId, accountId: input.accountId, workloadId, secretHash: hashSecret(secret), expiresAt });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, agentId: input.agentId, runtimeClientId: input.runtimeClientId, taskId: input.taskId, eventType: "workload.bootstrap_created", outcome: "SUCCESS", details: { workloadId, bootstrapId, providerId: input.providerId, assurance: input.assurance, publicKeyThumbprint } }, signer);
  });
  return { workloadId, bootstrapId, secret, challenge: `relay-workload-bootstrap:${bootstrapId}:${workloadId}`, expiresAt };
}

export async function exchangeWorkloadBootstrap(input: { accountId: string; secret: string; proofSignature: string }, signer: AuditSigner) {
  const timestamp = now();
  return await withTransaction(async (transaction) => {
    const [bootstrap] = await transaction.select({ id: workloadBootstraps.id, workloadId: workloadBootstraps.workloadId, expiresAt: workloadBootstraps.expiresAt, publicKeyPem: workloads.publicKeyPem, agentId: workloads.agentId, runtimeClientId: workloads.runtimeClientId, taskId: workloads.taskId, providerId: workloads.providerId, assurance: workloads.assurance, audience: workloads.audience, publicKeyThumbprint: workloads.publicKeyThumbprint, workloadExpiresAt: workloads.expiresAt }).from(workloadBootstraps).innerJoin(workloads, and(eq(workloads.id, workloadBootstraps.workloadId), eq(workloads.accountId, input.accountId))).where(and(eq(workloadBootstraps.accountId, input.accountId), eq(workloadBootstraps.secretHash, hashSecret(input.secret)), isNull(workloadBootstraps.consumedAt), gt(workloadBootstraps.expiresAt, timestamp), eq(workloads.status, "BOOTSTRAPPING"))).limit(1);
    if (!bootstrap) throw new RelayError("INVALID_CREDENTIAL", "Workload bootstrap is invalid, expired, or consumed.", undefined, 401);
    const challenge = `relay-workload-bootstrap:${bootstrap.id}:${bootstrap.workloadId}`;
    if (!verifySignature(null, Buffer.from(challenge), bootstrap.publicKeyPem, Buffer.from(input.proofSignature, "base64url"))) throw new RelayError("INVALID_CREDENTIAL", "Workload proof-of-possession failed.", undefined, 401);
    const consumed = await transaction.update(workloadBootstraps).set({ consumedAt: timestamp }).where(and(eq(workloadBootstraps.accountId, input.accountId), eq(workloadBootstraps.id, bootstrap.id), isNull(workloadBootstraps.consumedAt))).returning({ id: workloadBootstraps.id });
    if (!consumed.length) throw new RelayError("INVALID_CREDENTIAL", "Workload bootstrap was already consumed.", undefined, 409);
    await transaction.update(workloads).set({ status: "ACTIVE", activatedAt: timestamp }).where(and(eq(workloads.accountId, input.accountId), eq(workloads.id, bootstrap.workloadId), eq(workloads.status, "BOOTSTRAPPING")));
    const claims = workloadClaimsSchema.parse({ iss: issuer(), sub: bootstrap.workloadId, aud: bootstrap.audience, accountId: input.accountId, agentId: bootstrap.agentId, runtimeClientId: bootstrap.runtimeClientId, taskId: bootstrap.taskId, providerId: bootstrap.providerId, assurance: bootstrap.assurance, publicKeyThumbprint: bootstrap.publicKeyThumbprint, iat: Math.floor(Date.parse(timestamp) / 1_000), exp: Math.floor(Date.parse(bootstrap.workloadExpiresAt) / 1_000) });
    const token = await signToken("RLY-WORKLOAD", claims, signer);
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, agentId: bootstrap.agentId, runtimeClientId: bootstrap.runtimeClientId, taskId: bootstrap.taskId, eventType: "workload.activated", outcome: "SUCCESS", details: { workloadId: bootstrap.workloadId, publicKeyThumbprint: bootstrap.publicKeyThumbprint } }, signer);
    return { workloadId: bootstrap.workloadId, token, expiresAt: bootstrap.workloadExpiresAt };
  });
}

function resourceWithin(child: CapabilityLeaseClaims["resource"], parent: CapabilityLeaseClaims["resource"]) {
  if (child.type !== parent.type) return false;
  if (parent.ids && child.ids?.some((resourceId) => !parent.ids!.includes(resourceId))) return false;
  return Object.entries(parent.attributes ?? {}).every(([key, value]) => child.attributes?.[key] !== undefined && canonicalHash(child.attributes[key]) === canonicalHash(value));
}

async function authenticateWorkloadToken(token: string, resolver: LeaseKeyResolver, expected: { accountId: string; workloadId: string; audience: string }) {
  const claims = workloadClaimsSchema.parse(await verifyWithResolver(token, "RLY-WORKLOAD", resolver));
  const current = Math.floor(Date.now() / 1_000);
  if (claims.exp <= current || claims.accountId !== expected.accountId || claims.sub !== expected.workloadId || claims.aud !== expected.audience) throw new RelayError("INVALID_CREDENTIAL", "Workload identity binding is invalid or expired.", undefined, 401);
  return claims;
}

export async function issueCapabilityLease(input: { accountId: string; action: ActionIntent; workloadId: string; workloadIdentityToken: string; audience: string; ttlSeconds?: number; maxCalls: number; approvalRequestId?: string; parentLeaseId?: string; budgetReservationId?: string; allowOffline?: boolean; delegationChain?: string[] }, signer: AuditSigner, keyResolver: LeaseKeyResolver) {
  const action = actionIntentSchema.parse(input.action);
  if (action.accountId !== input.accountId || canonicalHash({ capability: action.capability, resource: action.resource, parameters: action.parameters }) !== action.canonicalHash) throw new RelayError("INVALID_INPUT", "Action intent binding is invalid.");
  const workloadIdentity = await authenticateWorkloadToken(input.workloadIdentityToken, keyResolver, { accountId: input.accountId, workloadId: input.workloadId, audience: input.audience });
  if (workloadIdentity.agentId !== action.agentId || workloadIdentity.runtimeClientId !== action.runtimeClientId || workloadIdentity.taskId !== action.taskId) throw new RelayError("CAPABILITY_DENIED", "Workload identity does not match the action.", undefined, 403);
  const issuedAt = now();
  return await withTransaction(async (transaction) => {
    const [workload] = await transaction.select().from(workloads).where(and(eq(workloads.accountId, input.accountId), eq(workloads.id, input.workloadId), eq(workloads.agentId, action.agentId), eq(workloads.runtimeClientId, action.runtimeClientId), eq(workloads.taskId, action.taskId), eq(workloads.audience, input.audience), eq(workloads.status, "ACTIVE"), gt(workloads.expiresAt, issuedAt))).limit(1);
    if (!workload) throw new RelayError("CAPABILITY_DENIED", "Active workload is unavailable.", undefined, 403);
    const [decision] = await transaction.select().from(policyDecisions).where(and(eq(policyDecisions.accountId, input.accountId), eq(policyDecisions.actionIntentId, action.id), eq(policyDecisions.agentId, action.agentId), gt(policyDecisions.expiresAt, issuedAt))).orderBy(desc(policyDecisions.createdAt)).limit(1);
    if (!decision || ["DENY", "ESCALATE"].includes(decision.outcome)) throw new RelayError("CAPABILITY_DENIED", "Policy decision does not permit lease issuance.", undefined, 403);
    const [capability] = await transaction.select().from(capabilityDefinitions).where(and(eq(capabilityDefinitions.definitionHash, decision.capabilityDefinitionHash), eq(capabilityDefinitions.name, action.capability.name), eq(capabilityDefinitions.version, action.capability.version), eq(capabilityDefinitions.enabled, true))).limit(1);
    const [passportRow] = await transaction.select().from(agentPassports).where(and(eq(agentPassports.accountId, input.accountId), eq(agentPassports.agentId, action.agentId), eq(agentPassports.status, "ACTIVE"), gt(agentPassports.expiresAt, issuedAt))).orderBy(desc(agentPassports.version)).limit(1);
    if (!capability || !passportRow) throw new RelayError("CAPABILITY_DENIED", "Capability or Passport is unavailable.", undefined, 403);
    const meteringDimensions = capability.meteringDimensions;
    if (meteringDimensions.length && !input.budgetReservationId) throw new RelayError("CAPABILITY_DENIED", "A live budget reservation is required for this metered capability.", undefined, 403);
    let budgetReservation: typeof budgetReservations.$inferSelect | undefined;
    if (input.budgetReservationId) {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`budget:${input.accountId}`}, 0))`);
      const [reservation] = await transaction.select().from(budgetReservations).where(and(eq(budgetReservations.accountId, input.accountId), eq(budgetReservations.id, input.budgetReservationId), eq(budgetReservations.agentId, action.agentId), eq(budgetReservations.taskId, action.taskId), eq(budgetReservations.actionIntentId, action.id), eq(budgetReservations.status, "RESERVED"), gt(budgetReservations.expiresAt, issuedAt), isNull(budgetReservations.leaseId))).limit(1);
      if (!reservation || !meteringDimensions.includes(reservation.dimension)) throw new RelayError("CAPABILITY_DENIED", "Budget reservation is unavailable or does not meter this capability.", undefined, 403);
      const appliedBudgets = await transaction.select().from(budgets).where(and(eq(budgets.accountId, input.accountId), inArray(budgets.id, reservation.appliedBudgetIds), eq(budgets.status, "ACTIVE")));
      if (appliedBudgets.length !== reservation.appliedBudgetIds.length || (reservation.dimension === "PURCHASE_AMOUNT" && appliedBudgets.some((budget) => budget.balanceStatus !== "CURRENT" || Date.parse(budget.balanceAsOf) < Date.now() - 5 * 60_000))) throw new RelayError("CAPABILITY_DENIED", "Budget state is inactive, stale, or unknown.", undefined, 403);
      budgetReservation = reservation;
    }
    const decisionFacts = decision.materialFacts as Array<{ name: string; value: unknown }>;
    const recipientRelationship = decisionFacts.find((fact) => fact.name === "recipient.relationship")?.value;
    const hardApprovalFloor = capability.effectClass === "financial" || capability.effectClass === "destructive" || (capability.effectClass === "communication" && recipientRelationship !== "known");
    if (hardApprovalFloor && decision.outcome !== "REQUIRE_APPROVAL") throw new RelayError("CAPABILITY_DENIED", "A non-overridable approval floor applies to this capability.", undefined, 403);
    const passport = agentPassportSchema.parse(passportRow.payload);
    if (!passport.allowedEnvironments.providerIds.includes(workload.providerId) || ASSURANCE_RANK[workload.assurance as Assurance] < ASSURANCE_RANK[passport.allowedEnvironments.minimumAssurance]) throw new RelayError("CAPABILITY_DENIED", "Workload environment is outside Passport restrictions.", undefined, 403);
    await transaction.insert(agentRevocationEpochs).values({ accountId: input.accountId, agentId: action.agentId, epoch: passport.revocationEpoch }).onConflictDoNothing();
    const [epoch] = await transaction.select().from(agentRevocationEpochs).where(and(eq(agentRevocationEpochs.accountId, input.accountId), eq(agentRevocationEpochs.agentId, action.agentId))).limit(1);
    if (!epoch) throw new RelayError("INTERNAL_ERROR", "Revocation epoch is unavailable.", undefined, 500);
    let approvalDecisionId: string | undefined;
    if (decision.outcome === "REQUIRE_APPROVAL") {
      if (!input.approvalRequestId) throw new RelayError("CAPABILITY_DENIED", "Approval is required.", undefined, 403);
      const consumed = await consumeApprovalInTransaction(transaction, { accountId: input.accountId, requestId: input.approvalRequestId, action, currentPolicyDecisionId: decision.id }, signer);
      approvalDecisionId = consumed.approvalDecisionId;
    }
    const policyLimits = (decision.obligations as { limits?: Record<string, number> }).limits ?? {};
    let maxCalls = Math.min(input.maxCalls, policyLimits.calls ?? input.maxCalls);
    let latestExpiry = Math.min(Date.now() + Math.min(Math.max(input.ttlSeconds ?? 900, 1), 900) * 1_000, Date.parse(decision.expiresAt), Date.parse(passport.expiresAt), Date.parse(workload.expiresAt));
    let parentLease: typeof capabilityLeases.$inferSelect | undefined;
    if (input.parentLeaseId) {
      const [parent] = await transaction.select().from(capabilityLeases).where(and(eq(capabilityLeases.accountId, input.accountId), eq(capabilityLeases.id, input.parentLeaseId), eq(capabilityLeases.status, "ACTIVE"), gt(capabilityLeases.expiresAt, issuedAt))).limit(1);
      if (!parent) throw new RelayError("CAPABILITY_DENIED", "Parent lease is unavailable.", undefined, 403);
      const parentClaims = capabilityLeaseClaimsSchema.parse(parent.claims);
      if (parentClaims.capability.name !== action.capability.name || parentClaims.capability.version !== action.capability.version || !resourceWithin(action.resource, parentClaims.resource)) throw new RelayError("CAPABILITY_DENIED", "Child lease exceeds parent authority.", undefined, 403);
      maxCalls = Math.min(maxCalls, parent.maxCalls - parent.callCount - parent.delegatedCallCount);
      latestExpiry = Math.min(latestExpiry, Date.parse(parent.expiresAt));
      parentLease = parent;
    }
    if (maxCalls < 1 || latestExpiry <= Date.now()) throw new RelayError("CAPABILITY_DENIED", "Lease limits are exhausted or expired.", undefined, 403);
    const onlineRequired = !(input.allowOffline && capability.effectClass === "read" && capability.riskClass !== "critical" && !input.parentLeaseId && latestExpiry <= Date.now() + 60_000);
    const leaseId = id("lse");
    const claims = capabilityLeaseClaimsSchema.parse({ iss: issuer(), sub: action.agentId, aud: input.audience, jti: leaseId, iat: Math.floor(Date.parse(issuedAt) / 1_000), nbf: Math.floor(Date.parse(issuedAt) / 1_000), exp: Math.floor(latestExpiry / 1_000), accountId: input.accountId, taskId: action.taskId, runtimeClientId: action.runtimeClientId, workloadId: input.workloadId, capability: action.capability, resource: action.resource, actionHash: action.canonicalHash, maxCalls, ...(input.budgetReservationId ? { budgetReservationId: input.budgetReservationId } : {}), policyDecisionId: decision.id, policyRevision: canonicalHash(decision.policyBundleHashes), ...(approvalDecisionId ? { approvalDecisionId } : {}), effectClass: capability.effectClass, riskClass: capability.riskClass, onlineRequired, environment: { providerIds: [workload.providerId], minimumAssurance: workload.assurance }, ...(input.parentLeaseId ? { parentLeaseId: input.parentLeaseId } : {}), delegationChain: input.delegationChain ?? [], revocationEpoch: epoch.epoch });
    const token = await signToken("RLY-LEASE", claims, signer);
    const claimsHash = canonicalHash(claims);
    const signature = decodeToken(token).signature;
    if (parentLease) {
      const reserved = await transaction.update(capabilityLeases).set({ delegatedCallCount: sql`${capabilityLeases.delegatedCallCount} + ${maxCalls}` }).where(and(eq(capabilityLeases.accountId, input.accountId), eq(capabilityLeases.id, parentLease.id), eq(capabilityLeases.status, "ACTIVE"), sql`${capabilityLeases.callCount} + ${capabilityLeases.delegatedCallCount} + ${maxCalls} <= ${capabilityLeases.maxCalls}`)).returning({ id: capabilityLeases.id });
      if (!reserved.length) throw new RelayError("CAPABILITY_DENIED", "Parent lease authority was concurrently exhausted.", undefined, 409);
    }
    await transaction.insert(capabilityLeases).values({ id: leaseId, accountId: input.accountId, agentId: action.agentId, runtimeClientId: action.runtimeClientId, workloadId: input.workloadId, taskId: action.taskId, parentLeaseId: input.parentLeaseId, policyDecisionId: decision.id, approvalDecisionId, budgetReservationId: input.budgetReservationId, claims, claimsHash, signature, signingKeyId: signer.keyId, tokenHash: canonicalHash(token), maxCalls, revocationEpoch: epoch.epoch, issuedAt, notBefore: issuedAt, expiresAt: new Date(latestExpiry).toISOString() });
    if (budgetReservation) {
      const bound = await transaction.update(budgetReservations).set({ leaseId }).where(and(eq(budgetReservations.accountId, input.accountId), eq(budgetReservations.id, budgetReservation.id), eq(budgetReservations.status, "RESERVED"), isNull(budgetReservations.leaseId))).returning({ id: budgetReservations.id });
      if (!bound.length) throw new RelayError("CAPABILITY_DENIED", "Budget reservation was concurrently bound.", undefined, 409);
    }
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, agentId: action.agentId, runtimeClientId: action.runtimeClientId, taskId: action.taskId, actionIntentId: action.id, policyDecisionId: decision.id, approvalDecisionId, leaseId, eventType: "lease.issued", outcome: "SUCCESS", details: { claimsHash, audience: input.audience, workloadId: input.workloadId, maxCalls, onlineRequired, parentLeaseId: input.parentLeaseId } }, signer);
    return { leaseId, token, expiresAt: new Date(latestExpiry).toISOString(), maxCalls, onlineRequired };
  });
}

async function validateLeaseToken(input: { token: string; expectedAccountId: string; expectedAudience: string; expectedWorkloadId: string; action: ActionIntent }, resolver: LeaseKeyResolver) {
  const claims = capabilityLeaseClaimsSchema.parse(await verifyWithResolver(input.token, "RLY-LEASE", resolver));
  const current = Math.floor(Date.now() / 1_000);
  if (claims.accountId !== input.expectedAccountId) throw new RelayError("CAPABILITY_DENIED", "Lease tenant mismatch.", undefined, 403);
  if (claims.aud !== input.expectedAudience) throw new RelayError("CAPABILITY_DENIED", "Lease audience mismatch.", undefined, 403);
  if (claims.workloadId !== input.expectedWorkloadId) throw new RelayError("CAPABILITY_DENIED", "Lease workload mismatch.", undefined, 403);
  if (claims.nbf > current || claims.exp <= current) throw new RelayError("CAPABILITY_DENIED", "Lease is not currently valid.", undefined, 403);
  if (claims.actionHash !== input.action.canonicalHash || claims.capability.name !== input.action.capability.name || claims.capability.version !== input.action.capability.version || !resourceWithin(input.action.resource, claims.resource)) throw new RelayError("CAPABILITY_DENIED", "Lease action or resource mismatch.", undefined, 403);
  return claims;
}

export async function authorizeLeaseCall(input: { token: string; expectedAccountId: string; expectedAudience: string; expectedWorkloadId: string; action: ActionIntent; callId: string; online: boolean }, resolver: LeaseKeyResolver, signer: AuditSigner, offlineCounter?: OfflineLeaseCounter) {
  const claims = await validateLeaseToken(input, resolver);
  if (!input.online) {
    if (claims.onlineRequired || claims.effectClass === "financial" || claims.effectClass === "destructive" || !offlineCounter) throw new RelayError("CAPABILITY_DENIED", "This lease requires online introspection.", undefined, 403);
    if (!(await offlineCounter.consume(claims.jti, input.callId, claims.maxCalls))) throw new RelayError("CAPABILITY_DENIED", "Offline lease is exhausted or replayed.", undefined, 409);
    return { leaseId: claims.jti, claims, enforcement: "OFFLINE" as const };
  }
  return await withTransaction(async (transaction) => {
    const timestamp = now();
    const [lease] = await transaction.select().from(capabilityLeases).where(and(eq(capabilityLeases.accountId, input.expectedAccountId), eq(capabilityLeases.id, claims.jti), eq(capabilityLeases.tokenHash, canonicalHash(input.token)), eq(capabilityLeases.workloadId, input.expectedWorkloadId), eq(capabilityLeases.status, "ACTIVE"), gt(capabilityLeases.expiresAt, timestamp), isNull(capabilityLeases.revokedAt))).limit(1);
    if (!lease) throw new RelayError("CAPABILITY_DENIED", "Lease is inactive, expired, or revoked.", undefined, 403);
    const [epoch] = await transaction.select().from(agentRevocationEpochs).where(and(eq(agentRevocationEpochs.accountId, input.expectedAccountId), eq(agentRevocationEpochs.agentId, claims.sub))).limit(1);
    if (!epoch || epoch.epoch !== claims.revocationEpoch) throw new RelayError("CAPABILITY_DENIED", "Lease revocation epoch is stale.", undefined, 403);
    const [workload] = await transaction.select({ id: workloads.id }).from(workloads).where(and(eq(workloads.accountId, input.expectedAccountId), eq(workloads.id, input.expectedWorkloadId), eq(workloads.status, "ACTIVE"), gt(workloads.expiresAt, timestamp))).limit(1);
    if (!workload) throw new RelayError("CAPABILITY_DENIED", "Workload identity is inactive.", undefined, 403);
    if (lease.budgetReservationId) {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`budget:${input.expectedAccountId}`}, 0))`);
      const [reservation] = await transaction.select().from(budgetReservations).where(and(eq(budgetReservations.accountId, input.expectedAccountId), eq(budgetReservations.id, lease.budgetReservationId), eq(budgetReservations.leaseId, lease.id), eq(budgetReservations.status, "RESERVED"), gt(budgetReservations.expiresAt, timestamp))).limit(1);
      if (!reservation) throw new RelayError("CAPABILITY_DENIED", "Budget reservation is inactive or expired.", undefined, 403);
      const appliedBudgets = await transaction.select().from(budgets).where(and(eq(budgets.accountId, input.expectedAccountId), inArray(budgets.id, reservation.appliedBudgetIds), eq(budgets.status, "ACTIVE")));
      if (appliedBudgets.length !== reservation.appliedBudgetIds.length || (reservation.dimension === "PURCHASE_AMOUNT" && appliedBudgets.some((budget) => budget.balanceStatus !== "CURRENT" || Date.parse(budget.balanceAsOf) < Date.now() - 5 * 60_000))) throw new RelayError("CAPABILITY_DENIED", "Budget state is inactive, stale, or unknown.", undefined, 403);
    }
    if (claims.parentLeaseId) {
      const [parent] = await transaction.select({ id: capabilityLeases.id }).from(capabilityLeases).where(and(eq(capabilityLeases.accountId, input.expectedAccountId), eq(capabilityLeases.id, claims.parentLeaseId), eq(capabilityLeases.status, "ACTIVE"), gt(capabilityLeases.expiresAt, timestamp), isNull(capabilityLeases.revokedAt))).limit(1);
      if (!parent) throw new RelayError("CAPABILITY_DENIED", "Parent lease is revoked or expired.", undefined, 403);
    }
    const inserted = await transaction.insert(leaseCallReceipts).values({ id: id("lcr"), accountId: input.expectedAccountId, leaseId: lease.id, callId: input.callId, actionHash: input.action.canonicalHash, workloadId: input.expectedWorkloadId }).onConflictDoNothing().returning({ id: leaseCallReceipts.id });
    if (!inserted.length) throw new RelayError("CAPABILITY_DENIED", "Lease call was replayed.", undefined, 409);
    const [used] = await transaction.update(capabilityLeases).set({ callCount: sql`${capabilityLeases.callCount} + 1` }).where(and(eq(capabilityLeases.accountId, input.expectedAccountId), eq(capabilityLeases.id, lease.id), sql`${capabilityLeases.callCount} + ${capabilityLeases.delegatedCallCount} < ${capabilityLeases.maxCalls}`)).returning({ callCount: capabilityLeases.callCount, maxCalls: capabilityLeases.maxCalls, delegatedCallCount: capabilityLeases.delegatedCallCount });
    if (!used) throw new RelayError("CAPABILITY_DENIED", "Lease call limit is exhausted.", undefined, 409);
    if (used.callCount + used.delegatedCallCount >= used.maxCalls) await transaction.update(capabilityLeases).set({ status: "EXHAUSTED" }).where(and(eq(capabilityLeases.accountId, input.expectedAccountId), eq(capabilityLeases.id, lease.id)));
    await appendAuditRecordInTransaction(transaction, { accountId: input.expectedAccountId, agentId: claims.sub, runtimeClientId: claims.runtimeClientId, taskId: claims.taskId, actionIntentId: input.action.id, policyDecisionId: claims.policyDecisionId, approvalDecisionId: claims.approvalDecisionId, leaseId: claims.jti, eventType: "lease.call_authorized", outcome: "SUCCESS", details: { callId: input.callId, callCount: used.callCount, maxCalls: used.maxCalls } }, signer);
    return { leaseId: claims.jti, claims, enforcement: "ONLINE" as const, remainingCalls: used.maxCalls - used.callCount - used.delegatedCallCount };
  });
}

export async function introspectLease(accountId: string, leaseId: string) {
  const [lease] = await db().select().from(capabilityLeases).where(and(eq(capabilityLeases.accountId, accountId), eq(capabilityLeases.id, leaseId))).limit(1);
  if (!lease) return { active: false, reason: "NOT_FOUND" as const };
  if (lease.status !== "ACTIVE" || lease.revokedAt) return { active: false, reason: lease.status };
  if (Date.parse(lease.expiresAt) <= Date.now()) return { active: false, reason: "EXPIRED" as const };
  const [epoch] = await db().select().from(agentRevocationEpochs).where(and(eq(agentRevocationEpochs.accountId, accountId), eq(agentRevocationEpochs.agentId, lease.agentId))).limit(1);
  if (!epoch || epoch.epoch !== lease.revocationEpoch) return { active: false, reason: "STALE_EPOCH" as const };
  const [workload] = await db().select({ id: workloads.id }).from(workloads).where(and(eq(workloads.accountId, accountId), eq(workloads.id, lease.workloadId), eq(workloads.status, "ACTIVE"), gt(workloads.expiresAt, now()))).limit(1);
  if (!workload) return { active: false, reason: "WORKLOAD_INACTIVE" as const };
  if (lease.budgetReservationId) {
    const [reservation] = await db().select().from(budgetReservations).where(and(eq(budgetReservations.accountId, accountId), eq(budgetReservations.id, lease.budgetReservationId), eq(budgetReservations.leaseId, lease.id), eq(budgetReservations.status, "RESERVED"), gt(budgetReservations.expiresAt, now()))).limit(1);
    if (!reservation) return { active: false, reason: "BUDGET_INACTIVE" as const };
    const appliedBudgets = await db().select().from(budgets).where(and(eq(budgets.accountId, accountId), inArray(budgets.id, reservation.appliedBudgetIds), eq(budgets.status, "ACTIVE")));
    if (appliedBudgets.length !== reservation.appliedBudgetIds.length || (reservation.dimension === "PURCHASE_AMOUNT" && appliedBudgets.some((budget) => budget.balanceStatus !== "CURRENT" || Date.parse(budget.balanceAsOf) < Date.now() - 5 * 60_000))) return { active: false, reason: "BUDGET_UNAVAILABLE" as const };
  }
  if (lease.parentLeaseId) {
    const [parent] = await db().select({ id: capabilityLeases.id }).from(capabilityLeases).where(and(eq(capabilityLeases.accountId, accountId), eq(capabilityLeases.id, lease.parentLeaseId), eq(capabilityLeases.status, "ACTIVE"), gt(capabilityLeases.expiresAt, now()), isNull(capabilityLeases.revokedAt))).limit(1);
    if (!parent) return { active: false, reason: "PARENT_INACTIVE" as const };
  }
  return { active: true, remainingCalls: lease.maxCalls - lease.callCount, claimsHash: lease.claimsHash };
}

export async function revokeLease(input: { accountId: string; leaseId: string; reason: string }, signer: AuditSigner) {
  return await withTransaction(async (transaction) => {
    const active = await transaction.select().from(capabilityLeases).where(and(eq(capabilityLeases.accountId, input.accountId), eq(capabilityLeases.status, "ACTIVE")));
    const lease = active.find((entry) => entry.id === input.leaseId); if (!lease) return false;
    const revokedIds = new Set([lease.id]); let changed = true;
    while (changed) { changed = false; for (const candidate of active) if (candidate.parentLeaseId && revokedIds.has(candidate.parentLeaseId) && !revokedIds.has(candidate.id)) { revokedIds.add(candidate.id); changed = true; } }
    await transaction.update(capabilityLeases).set({ status: "REVOKED", revokedAt: now() }).where(and(eq(capabilityLeases.accountId, input.accountId), inArray(capabilityLeases.id, [...revokedIds]), eq(capabilityLeases.status, "ACTIVE")));
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, agentId: lease.agentId, runtimeClientId: lease.runtimeClientId, taskId: lease.taskId, policyDecisionId: lease.policyDecisionId, approvalDecisionId: lease.approvalDecisionId ?? undefined, leaseId: lease.id, eventType: "lease.revoked", outcome: "REVOKED", details: { reason: input.reason, cascadeLeaseIds: [...revokedIds].sort() } }, signer);
    return true;
  });
}

export async function emergencyRevokeAgent(accountId: string, agentId: string, signer: AuditSigner) {
  return await withTransaction(async (transaction) => {
    await transaction.insert(agentRevocationEpochs).values({ accountId, agentId, epoch: 1 }).onConflictDoUpdate({ target: [agentRevocationEpochs.accountId, agentRevocationEpochs.agentId], set: { epoch: sql`${agentRevocationEpochs.epoch} + 1`, updatedAt: now() } });
    const [epoch] = await transaction.select().from(agentRevocationEpochs).where(and(eq(agentRevocationEpochs.accountId, accountId), eq(agentRevocationEpochs.agentId, agentId))).limit(1);
    const revoked = await transaction.update(capabilityLeases).set({ status: "REVOKED", revokedAt: now() }).where(and(eq(capabilityLeases.accountId, accountId), eq(capabilityLeases.agentId, agentId), eq(capabilityLeases.status, "ACTIVE"))).returning({ id: capabilityLeases.id });
    await appendAuditRecordInTransaction(transaction, { accountId, agentId, eventType: "agent.emergency_revoked", outcome: "REVOKED", details: { revocationEpoch: epoch!.epoch, revokedLeaseCount: revoked.length } }, signer);
    return { revocationEpoch: epoch!.epoch, revokedLeaseCount: revoked.length };
  });
}

export async function revokeWorkload(input: { accountId: string; workloadId: string; reason: string }, signer: AuditSigner) {
  return await withTransaction(async (transaction) => {
    const [workload] = await transaction.update(workloads).set({ status: "REVOKED", revokedAt: now() }).where(and(eq(workloads.accountId, input.accountId), eq(workloads.id, input.workloadId), eq(workloads.status, "ACTIVE"))).returning();
    if (!workload) return false;
    await transaction.update(capabilityLeases).set({ status: "REVOKED", revokedAt: now() }).where(and(eq(capabilityLeases.accountId, input.accountId), eq(capabilityLeases.workloadId, input.workloadId), eq(capabilityLeases.status, "ACTIVE")));
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, agentId: workload.agentId, runtimeClientId: workload.runtimeClientId, taskId: workload.taskId, eventType: "workload.revoked", outcome: "REVOKED", details: { workloadId: workload.id, reason: input.reason } }, signer);
    return true;
  });
}
