import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { hashSecret } from "@/lib/crypto";
import { db, withTransaction } from "@/lib/db";
import { capabilityLeases, privateGatewayReceipts, privateGatewayResources, runnerAssignments, runnerEnrollments, runnerEvidenceReceipts, runners, v2Tasks, workloads } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { canonicalHash, canonicalJson } from "@/lib/v2/contracts";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import { verifyAuditSignature, type AuditSigner } from "@/lib/v2/evidence/crypto";
import { requireMembership } from "@/lib/v2/identity";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const assignmentPayloadSchema = z.object({ command: z.array(z.string().max(10_000)).min(1).max(100), environment: z.record(z.string().max(10_000)).default({}), credentialHandles: z.array(z.string().regex(/^vlt_[A-Za-z0-9_-]{8,}$/)).max(100).default([]), gatewayResourceIds: z.array(z.string().regex(/^pgr_/)).max(100).default([]) }).strict();
const attestationSchema = z.object({ format: z.string().max(64), document: z.string().max(100_000), nonce: z.string().max(512) }).strict();
type Assurance = "registered" | "attested";

export interface RunnerAttestationVerifier { verify(input: { accountId: string; publicKeyThumbprint: string; softwareDigest: string; configDigest: string; attestation: z.infer<typeof attestationSchema> }): Promise<{ verified: boolean; claims?: Record<string, unknown> }> }
export interface RunnerCertificateKeyResolver { publicKeyForKeyId(keyId: string): Promise<string | undefined> }
export interface RunnerSecretBroker { bind(input: { accountId: string; taskId: string; assignmentId: string; audience: string; handles: string[]; expiresAt: string }): Promise<{ socketBindingId: string }> }

function encode(value: unknown) { return Buffer.from(canonicalJson(value)).toString("base64url"); }
async function signCertificate(claims: unknown, signer: AuditSigner) { const header = encode({ alg: "EdDSA", kid: signer.keyId, typ: "RLY-RUNNER" }); const payload = encode(claims); const input = `${header}.${payload}`; return `${input}.${await signer.sign(input)}`; }
async function verifyCertificate(token: string, resolver: RunnerCertificateKeyResolver) {
  const [headerPart, payloadPart, signature] = token.split(".");
  if (!headerPart || !payloadPart || !signature) throw new RelayError("INVALID_CREDENTIAL", "Malformed runner certificate.", undefined, 401);
  try {
    const header = JSON.parse(Buffer.from(headerPart, "base64url").toString()) as { alg?: string; kid?: string; typ?: string };
    const payload = z.object({ sub: z.string().regex(/^run_/), accountId: z.string().regex(/^acct_/), thumbprint: z.string(), trustEpoch: z.number().int(), assurance: z.enum(["registered", "attested"]), iat: z.number().int(), exp: z.number().int() }).strict().parse(JSON.parse(Buffer.from(payloadPart, "base64url").toString()));
    const key = header.kid ? await resolver.publicKeyForKeyId(header.kid) : undefined;
    if (header.alg !== "EdDSA" || header.typ !== "RLY-RUNNER" || !key || !verifyAuditSignature(key, `${headerPart}.${payloadPart}`, signature) || payload.exp <= Math.floor(Date.now() / 1_000)) throw new Error("invalid");
    return payload;
  } catch { throw new RelayError("INVALID_CREDENTIAL", "Runner certificate is invalid or expired.", undefined, 401); }
}
function thumbprint(publicKeyPem: string) { return `sha256:${createHash("sha256").update(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" })).digest("hex")}`; }

export async function createRunnerEnrollment(input: { accountId: string; principalId: string; runnerName: string; ttlSeconds?: number }, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.principalId, allowedRoles: ["OWNER", "ADMIN", "OPERATOR"] });
  const enrollmentId = id("ren"); const secret = `ren_${randomBytes(32).toString("base64url")}`; const expiresAt = new Date(Date.now() + Math.min(Math.max(input.ttlSeconds ?? 300, 30), 600) * 1_000).toISOString();
  await withTransaction(async (tx) => { await tx.insert(runnerEnrollments).values({ id: enrollmentId, accountId: input.accountId, createdByPrincipalId: input.principalId, secretHash: hashSecret(secret), runnerName: input.runnerName, expiresAt }); await appendAuditRecordInTransaction(tx, { accountId: input.accountId, actorPrincipalId: input.principalId, eventType: "runner.enrollment_created", outcome: "SUCCESS", details: { enrollmentId, expiresAt } }, signer); });
  return { enrollmentId, secret, challenge: `relay-runner-enroll:${enrollmentId}:${input.accountId}`, expiresAt };
}

export async function exchangeRunnerEnrollment(input: { accountId: string; secret: string; publicKeyPem: string; proofSignature: string; softwareDigest: string; configDigest: string; attestation?: unknown }, signer: AuditSigner, verifier?: RunnerAttestationVerifier) {
  createPublicKey(input.publicKeyPem); digestSchema.parse(input.softwareDigest); digestSchema.parse(input.configDigest); const timestamp = now(); const keyThumbprint = thumbprint(input.publicKeyPem);
  return await withTransaction(async (tx) => {
    const [enrollment] = await tx.select().from(runnerEnrollments).where(and(eq(runnerEnrollments.accountId, input.accountId), eq(runnerEnrollments.secretHash, hashSecret(input.secret)), isNull(runnerEnrollments.consumedAt), gt(runnerEnrollments.expiresAt, timestamp))).limit(1);
    if (!enrollment) throw new RelayError("INVALID_CREDENTIAL", "Runner enrollment is invalid, expired, or consumed.", undefined, 401);
    const challenge = `relay-runner-enroll:${enrollment.id}:${input.accountId}`;
    if (!verifySignature(null, Buffer.from(challenge), input.publicKeyPem, Buffer.from(input.proofSignature, "base64url"))) throw new RelayError("INVALID_CREDENTIAL", "Runner enrollment proof failed.", undefined, 401);
    const parsedAttestation = input.attestation ? attestationSchema.parse(input.attestation) : undefined;
    const verification = parsedAttestation && verifier ? await verifier.verify({ accountId: input.accountId, publicKeyThumbprint: keyThumbprint, softwareDigest: input.softwareDigest, configDigest: input.configDigest, attestation: parsedAttestation }) : { verified: false };
    const assurance: Assurance = verification.verified ? "attested" : "registered"; const runnerId = id("run"); const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const consumed = await tx.update(runnerEnrollments).set({ consumedAt: timestamp }).where(and(eq(runnerEnrollments.id, enrollment.id), eq(runnerEnrollments.accountId, input.accountId), isNull(runnerEnrollments.consumedAt))).returning({ id: runnerEnrollments.id });
    if (!consumed.length) throw new RelayError("INVALID_CREDENTIAL", "Runner enrollment was already consumed.", undefined, 409);
    await tx.insert(runners).values({ id: runnerId, accountId: input.accountId, name: enrollment.runnerName, publicKeyPem: input.publicKeyPem, publicKeyThumbprint: keyThumbprint, softwareDigest: input.softwareDigest, configDigest: input.configDigest, assurance, attestation: verification.claims ?? {}, status: "ACTIVE", certificateExpiresAt: expiresAt, lastSeenAt: timestamp });
    const claims = { sub: runnerId, accountId: input.accountId, thumbprint: keyThumbprint, trustEpoch: 1, assurance, iat: Math.floor(Date.parse(timestamp) / 1_000), exp: Math.floor(Date.parse(expiresAt) / 1_000) };
    await appendAuditRecordInTransaction(tx, { accountId: input.accountId, eventType: "runner.enrolled", outcome: "SUCCESS", details: { runnerId, keyThumbprint, softwareDigest: input.softwareDigest, configDigest: input.configDigest, assurance } }, signer);
    return { runnerId, certificate: await signCertificate(claims, signer), expiresAt, assurance };
  });
}

async function authenticateRunner(input: { accountId: string; runnerId: string; certificate: string }, resolver: RunnerCertificateKeyResolver) {
  const claims = await verifyCertificate(input.certificate, resolver); if (claims.accountId !== input.accountId || claims.sub !== input.runnerId) throw new RelayError("INVALID_CREDENTIAL", "Runner certificate binding is invalid.", undefined, 401);
  const [runner] = await db().select().from(runners).where(and(eq(runners.accountId, input.accountId), eq(runners.id, input.runnerId), eq(runners.status, "ACTIVE"), eq(runners.trustEpoch, claims.trustEpoch), eq(runners.publicKeyThumbprint, claims.thumbprint), gt(runners.certificateExpiresAt, now()))).limit(1);
  if (!runner) throw new RelayError("INVALID_CREDENTIAL", "Runner is stale, revoked, or unavailable.", undefined, 401); return runner;
}

export async function createRunnerAssignment(input: { accountId: string; runnerId: string; taskId: string; workloadId: string; leaseId: string; payload: unknown; ttlSeconds?: number }, signer: AuditSigner) {
  const payload = assignmentPayloadSchema.parse(input.payload); const timestamp = now();
  const [[runner], [workload], [lease], [task]] = await Promise.all([
    db().select().from(runners).where(and(eq(runners.accountId, input.accountId), eq(runners.id, input.runnerId), eq(runners.status, "ACTIVE"), gt(runners.certificateExpiresAt, timestamp))).limit(1),
    db().select().from(workloads).where(and(eq(workloads.accountId, input.accountId), eq(workloads.id, input.workloadId), eq(workloads.runnerId, input.runnerId), eq(workloads.taskId, input.taskId), eq(workloads.status, "ACTIVE"), gt(workloads.expiresAt, timestamp))).limit(1),
    db().select().from(capabilityLeases).where(and(eq(capabilityLeases.accountId, input.accountId), eq(capabilityLeases.id, input.leaseId), eq(capabilityLeases.workloadId, input.workloadId), eq(capabilityLeases.taskId, input.taskId), eq(capabilityLeases.status, "ACTIVE"), gt(capabilityLeases.expiresAt, timestamp))).limit(1),
    db().select().from(v2Tasks).where(and(eq(v2Tasks.accountId, input.accountId), eq(v2Tasks.id, input.taskId), inArray(v2Tasks.status, ["RUNNING", "PAUSED", "WAITING_APPROVAL"]))).limit(1),
  ]);
  if (!runner || !workload || !lease || !task) throw new RelayError("CAPABILITY_DENIED", "Runner assignment authority is incomplete or inactive.", undefined, 403);
  if (payload.gatewayResourceIds.length) { const resources = await db().select({ id: privateGatewayResources.id }).from(privateGatewayResources).where(and(eq(privateGatewayResources.accountId, input.accountId), eq(privateGatewayResources.runnerId, input.runnerId), eq(privateGatewayResources.enabled, true), inArray(privateGatewayResources.id, payload.gatewayResourceIds))); if (resources.length !== new Set(payload.gatewayResourceIds).size) throw new RelayError("CAPABILITY_DENIED", "Assignment references an unavailable private resource.", undefined, 403); }
  const assignmentId = id("ras"); const expiresAt = new Date(Math.min(Date.now() + Math.min(Math.max(input.ttlSeconds ?? 900, 30), 900) * 1_000, Date.parse(workload.expiresAt), Date.parse(lease.expiresAt))).toISOString(); const payloadHash = canonicalHash(payload);
  await withTransaction(async (tx) => { await tx.insert(runnerAssignments).values({ id: assignmentId, accountId: input.accountId, runnerId: input.runnerId, taskId: input.taskId, workloadId: input.workloadId, leaseId: input.leaseId, payload, payloadHash, expiresAt }); await appendAuditRecordInTransaction(tx, { accountId: input.accountId, agentId: workload.agentId, taskId: input.taskId, leaseId: input.leaseId, eventType: "runner.assignment_offered", outcome: "SUCCESS", details: { assignmentId, runnerId: input.runnerId, workloadId: input.workloadId, payloadHash } }, signer); });
  return { assignmentId, expiresAt, payloadHash };
}

export async function pollRunnerAssignments(input: { accountId: string; runnerId: string; certificate: string; limit?: number }, resolver: RunnerCertificateKeyResolver) {
  await authenticateRunner(input, resolver); const timestamp = now(); await db().update(runners).set({ lastSeenAt: timestamp, updatedAt: timestamp }).where(and(eq(runners.accountId, input.accountId), eq(runners.id, input.runnerId)));
  const rows = await db().select().from(runnerAssignments).where(and(eq(runnerAssignments.accountId, input.accountId), eq(runnerAssignments.runnerId, input.runnerId), eq(runnerAssignments.status, "OFFERED"), gt(runnerAssignments.expiresAt, timestamp))).orderBy(asc(runnerAssignments.createdAt)).limit(Math.min(Math.max(input.limit ?? 1, 1), 10));
  const claimed = [];
  for (const row of rows) { const [value] = await db().update(runnerAssignments).set({ status: "CLAIMED", claimedAt: timestamp }).where(and(eq(runnerAssignments.accountId, input.accountId), eq(runnerAssignments.id, row.id), eq(runnerAssignments.status, "OFFERED"))).returning(); if (value) claimed.push(value); }
  return claimed;
}

export async function submitRunnerEvidence(input: { accountId: string; runnerId: string; certificate: string; assignmentId: string; fenceToken: number; sequence: number; evidence: unknown; signature: string }, resolver: RunnerCertificateKeyResolver) {
  const runner = await authenticateRunner(input, resolver); const evidenceHash = canonicalHash(input.evidence); const signed = canonicalJson({ assignmentId: input.assignmentId, fenceToken: input.fenceToken, sequence: input.sequence, evidenceHash });
  if (!verifySignature(null, Buffer.from(signed), runner.publicKeyPem, Buffer.from(input.signature, "base64url"))) throw new RelayError("INVALID_CREDENTIAL", "Runner evidence signature failed.", undefined, 401);
  return await withTransaction(async (tx) => { const [assignment] = await tx.select().from(runnerAssignments).where(and(eq(runnerAssignments.accountId, input.accountId), eq(runnerAssignments.id, input.assignmentId), eq(runnerAssignments.runnerId, input.runnerId), eq(runnerAssignments.fenceToken, input.fenceToken), inArray(runnerAssignments.status, ["CLAIMED", "RUNNING", "PAUSED"]), gt(runnerAssignments.expiresAt, now()))).limit(1); if (!assignment || input.sequence !== assignment.evidenceSequence + 1) throw new RelayError("CAPABILITY_DENIED", "Runner evidence fence or sequence is invalid.", undefined, 409); await tx.insert(runnerEvidenceReceipts).values({ id: id("rer"), accountId: input.accountId, runnerId: input.runnerId, assignmentId: input.assignmentId, sequence: input.sequence, evidenceHash, signature: input.signature }); await tx.update(runnerAssignments).set({ evidenceSequence: input.sequence, status: "RUNNING" }).where(and(eq(runnerAssignments.accountId, input.accountId), eq(runnerAssignments.id, input.assignmentId))); return { accepted: true, evidenceHash, source: "runner_reported" as const }; });
}

export async function registerPrivateGatewayResource(input: { accountId: string; principalId: string; runnerId: string; name: string; host: string; port: number; allowedMethods: string[]; allowedPathPrefixes: string[] }) {
  await requireMembership({ accountId: input.accountId, principalId: input.principalId, allowedRoles: ["OWNER", "ADMIN", "OPERATOR"] }); if (!/^[A-Za-z0-9.-]+$/.test(input.host) || input.port < 1 || input.port > 65535 || !input.allowedMethods.length || !input.allowedPathPrefixes.length) throw new RelayError("INVALID_INPUT", "A bounded named HTTPS resource is required.");
  const [runner] = await db().select({ id: runners.id }).from(runners).where(and(eq(runners.accountId, input.accountId), eq(runners.id, input.runnerId), eq(runners.status, "ACTIVE"))).limit(1); if (!runner) throw new RelayError("CAPABILITY_DENIED", "Runner is unavailable.", undefined, 403);
  const resourceId = id("pgr"); await db().insert(privateGatewayResources).values({ id: resourceId, accountId: input.accountId, runnerId: input.runnerId, name: input.name, host: input.host.toLowerCase(), port: input.port, allowedMethods: input.allowedMethods.map((value) => value.toUpperCase()), allowedPathPrefixes: input.allowedPathPrefixes }); return { resourceId };
}

export async function authorizePrivateGatewayRequest(input: { accountId: string; runnerId: string; assignmentId: string; resourceId: string; method: string; path: string }) {
  const [binding] = await db().select({ assignment: runnerAssignments, resource: privateGatewayResources }).from(runnerAssignments).innerJoin(privateGatewayResources, and(eq(privateGatewayResources.id, input.resourceId), eq(privateGatewayResources.accountId, runnerAssignments.accountId), eq(privateGatewayResources.runnerId, runnerAssignments.runnerId))).where(and(eq(runnerAssignments.accountId, input.accountId), eq(runnerAssignments.id, input.assignmentId), eq(runnerAssignments.runnerId, input.runnerId), inArray(runnerAssignments.status, ["CLAIMED", "RUNNING"]), gt(runnerAssignments.expiresAt, now()), eq(privateGatewayResources.enabled, true))).limit(1);
  const payload = binding ? assignmentPayloadSchema.parse(binding.assignment.payload) : undefined; const method = input.method.toUpperCase(); if (!binding || !payload?.gatewayResourceIds.includes(input.resourceId) || !binding.resource.allowedMethods.includes(method) || !binding.resource.allowedPathPrefixes.some((prefix) => input.path.startsWith(prefix))) throw new RelayError("CAPABILITY_DENIED", "Private gateway request is outside the named assignment scope.", undefined, 403);
  await db().insert(privateGatewayReceipts).values({ id: id("pgrc"), accountId: input.accountId, assignmentId: input.assignmentId, resourceId: input.resourceId, method, pathHash: canonicalHash(input.path), outcome: "AUTHORIZED" }); return { scheme: "https" as const, host: binding.resource.host, port: binding.resource.port, method, path: input.path };
}

export async function bindRunnerCredentials(input: { accountId: string; runnerId: string; assignmentId: string }, broker: RunnerSecretBroker) { const [assignment] = await db().select().from(runnerAssignments).where(and(eq(runnerAssignments.accountId, input.accountId), eq(runnerAssignments.runnerId, input.runnerId), eq(runnerAssignments.id, input.assignmentId), inArray(runnerAssignments.status, ["CLAIMED", "RUNNING"]), gt(runnerAssignments.expiresAt, now()))).limit(1); if (!assignment) throw new RelayError("CAPABILITY_DENIED", "Active runner assignment is required.", undefined, 403); const payload = assignmentPayloadSchema.parse(assignment.payload); return await broker.bind({ accountId: input.accountId, taskId: assignment.taskId, assignmentId: assignment.id, audience: `runner-socket:${assignment.id}`, handles: payload.credentialHandles, expiresAt: assignment.expiresAt }); }

export async function createSignedRunnerUpdate(input: { accountId: string; principalId: string; runnerId: string; softwareDigest: string; downloadUrl: string }, signer: AuditSigner) { await requireMembership({ accountId: input.accountId, principalId: input.principalId, allowedRoles: ["OWNER", "ADMIN", "OPERATOR"] }); digestSchema.parse(input.softwareDigest); if (new URL(input.downloadUrl).protocol !== "https:") throw new RelayError("INVALID_INPUT", "Runner updates require HTTPS."); const manifest = { accountId: input.accountId, runnerId: input.runnerId, softwareDigest: input.softwareDigest, downloadUrl: input.downloadUrl, issuedAt: now() }; return { manifest, signature: await signer.sign(canonicalHash(manifest)), signingKeyId: signer.keyId }; }

export async function revokeRunner(input: { accountId: string; principalId: string; runnerId: string; reason: string }, signer: AuditSigner) { await requireMembership({ accountId: input.accountId, principalId: input.principalId, allowedRoles: ["OWNER", "ADMIN", "OPERATOR"] }); return await withTransaction(async (tx) => { const [runner] = await tx.update(runners).set({ status: "REVOKED", revokedAt: now(), trustEpoch: 2, updatedAt: now() }).where(and(eq(runners.accountId, input.accountId), eq(runners.id, input.runnerId), eq(runners.status, "ACTIVE"))).returning(); if (!runner) return false; await tx.update(runnerAssignments).set({ status: "REVOKED", fenceToken: 2, completedAt: now() }).where(and(eq(runnerAssignments.accountId, input.accountId), eq(runnerAssignments.runnerId, input.runnerId), inArray(runnerAssignments.status, ["OFFERED", "CLAIMED", "RUNNING", "PAUSED"]))); await tx.update(workloads).set({ status: "REVOKED", revokedAt: now() }).where(and(eq(workloads.accountId, input.accountId), eq(workloads.runnerId, input.runnerId), inArray(workloads.status, ["BOOTSTRAPPING", "ACTIVE"]))); await tx.update(capabilityLeases).set({ status: "REVOKED", revokedAt: now() }).where(and(eq(capabilityLeases.accountId, input.accountId), inArray(capabilityLeases.workloadId, db().select({ id: workloads.id }).from(workloads).where(and(eq(workloads.accountId, input.accountId), eq(workloads.runnerId, input.runnerId)))))); await appendAuditRecordInTransaction(tx, { accountId: input.accountId, actorPrincipalId: input.principalId, eventType: "runner.revoked", outcome: "REVOKED", details: { runnerId: input.runnerId, reason: input.reason } }, signer); return true; }); }

export const customerRunnerManifest = { schemaVersion: "relay.execution-provider.v1", providerKey: "customer-runner", version: "1.0", kind: "customer_runner", features: ["shell", "files", "private_network", "network_policy", "secret_broker"], assurance: "registered", regions: ["customer"], isolationModes: ["container", "microvm", "vm", "dedicated"], persistenceModes: ["ephemeral"], maximumClassification: "internal", evidenceTypes: ["runner_reported"], meteringDimensions: ["COMPUTE_SECONDS"], supportsPrivateNetwork: true, supportsIdempotentCreate: false, maximumSessionSeconds: 3600 } as const;
