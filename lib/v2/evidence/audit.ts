import { and, asc, eq, sql } from "drizzle-orm";
import { db, withTransaction } from "@/lib/db";
import { auditChainHeads, auditRecords } from "@/lib/db/schema";
import { id, now } from "@/lib/ids";
import { canonicalHash, type CanonicalValue } from "@/lib/v2/contracts";
import { verifyAuditSignature, type AuditSigner } from "./crypto";
import { redactForEvidence } from "./redaction";

export type AuditRecordInput = {
  accountId: string; eventType: string; outcome: string; occurredAt?: string;
  actorPrincipalId?: string; agentId?: string; runtimeClientId?: string; taskId?: string;
  actionIntentId?: string; policyDecisionId?: string; approvalDecisionId?: string; leaseId?: string;
  provider?: string; details?: Record<string, unknown>;
};

function defined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as unknown as CanonicalValue;
}

function canonicalTimestamp(value: string) {
  return new Date(value).toISOString();
}

type AuditRecord = Awaited<ReturnType<typeof listAuditRecords>>[number];

function recordMaterial(record: Pick<AuditRecord, "id" | "accountId" | "sequence" | "eventType" | "outcome" | "occurredAt" | "actorPrincipalId" | "agentId" | "runtimeClientId" | "taskId" | "actionIntentId" | "policyDecisionId" | "approvalDecisionId" | "leaseId" | "provider" | "details" | "previousHash">) {
  return defined({ id: record.id, accountId: record.accountId, sequence: record.sequence, eventType: record.eventType, outcome: record.outcome, occurredAt: canonicalTimestamp(record.occurredAt), actorPrincipalId: record.actorPrincipalId ?? undefined, agentId: record.agentId ?? undefined, runtimeClientId: record.runtimeClientId ?? undefined, taskId: record.taskId ?? undefined, actionIntentId: record.actionIntentId ?? undefined, policyDecisionId: record.policyDecisionId ?? undefined, approvalDecisionId: record.approvalDecisionId ?? undefined, leaseId: record.leaseId ?? undefined, provider: record.provider ?? undefined, details: record.details as CanonicalValue, previousHash: record.previousHash });
}

export async function appendAuditRecord(input: AuditRecordInput, signer: AuditSigner) {
  const occurredAt = input.occurredAt ?? now();
  return await withTransaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.accountId}, 0))`);
    await transaction.insert(auditChainHeads).values({ accountId: input.accountId, sequence: 0, updatedAt: occurredAt }).onConflictDoNothing();
    const [head] = await transaction.select({ sequence: auditChainHeads.sequence, lastHash: auditChainHeads.lastHash }).from(auditChainHeads).where(eq(auditChainHeads.accountId, input.accountId)).limit(1);
    if (!head) throw new Error("Audit chain head unavailable.");
    const recordId = id("aud");
    const sequence = head.sequence + 1;
    const details = redactForEvidence(input.details ?? {});
    const material = defined({ id: recordId, accountId: input.accountId, sequence, eventType: input.eventType, outcome: input.outcome, occurredAt: canonicalTimestamp(occurredAt), actorPrincipalId: input.actorPrincipalId, agentId: input.agentId, runtimeClientId: input.runtimeClientId, taskId: input.taskId, actionIntentId: input.actionIntentId, policyDecisionId: input.policyDecisionId, approvalDecisionId: input.approvalDecisionId, leaseId: input.leaseId, provider: input.provider, details, previousHash: head.lastHash });
    const recordHash = canonicalHash(material);
    const signature = await signer.sign(recordHash);
    await transaction.insert(auditRecords).values({ id: recordId, accountId: input.accountId, sequence, eventType: input.eventType, outcome: input.outcome, occurredAt, actorPrincipalId: input.actorPrincipalId, agentId: input.agentId, runtimeClientId: input.runtimeClientId, taskId: input.taskId, actionIntentId: input.actionIntentId, policyDecisionId: input.policyDecisionId, approvalDecisionId: input.approvalDecisionId, leaseId: input.leaseId, provider: input.provider, details, previousHash: head.lastHash, recordHash, signature, signingKeyId: signer.keyId, createdAt: occurredAt });
    await transaction.update(auditChainHeads).set({ sequence, lastHash: recordHash, updatedAt: occurredAt }).where(eq(auditChainHeads.accountId, input.accountId));
    return { ...material as Record<string, unknown>, recordHash, signature, signingKeyId: signer.keyId };
  });
}

export async function listAuditRecords(accountId: string) {
  return await db().select().from(auditRecords).where(eq(auditRecords.accountId, accountId)).orderBy(asc(auditRecords.sequence));
}

export async function verifyAuditRecords(records: Awaited<ReturnType<typeof listAuditRecords>>, signer: AuditSigner) {
  let previousHash: string | null = null;
  let expectedSequence = 1;
  for (const record of records) {
    if (record.sequence !== expectedSequence || record.previousHash !== previousHash || record.signingKeyId !== signer.keyId) return false;
    if (canonicalHash(recordMaterial(record)) !== record.recordHash || !(await signer.verify(record.recordHash, record.signature))) return false;
    previousHash = record.recordHash;
    expectedSequence += 1;
  }
  return true;
}

export type AuditExportBundle = {
  schemaVersion: "relay.audit-export.v1";
  accountId: string;
  exportedAt: string;
  finalSequence: number;
  finalHash: string | null;
  exportSigningKeyId: string;
  exportSignature: string;
  signingKeys: Array<{ keyId: string; algorithm: "Ed25519"; publicKeyPem: string }>;
  records: AuditRecord[];
};

export async function exportAuditBundle(accountId: string, signers: AuditSigner | AuditSigner[]): Promise<AuditExportBundle> {
  const availableSigners = Array.isArray(signers) ? signers : [signers];
  const records = await listAuditRecords(accountId);
  const [head] = await db().select().from(auditChainHeads).where(eq(auditChainHeads.accountId, accountId)).limit(1);
  const finalSequence = head?.sequence ?? 0;
  const finalHash = head?.lastHash ?? null;
  const exportSigner = availableSigners.find((signer) => signer.keyId === records.at(-1)?.signingKeyId) ?? availableSigners[0];
  if (!exportSigner) throw new Error("At least one audit signer is required.");
  const exportedAt = now();
  const manifestHash = canonicalHash({ schemaVersion: "relay.audit-export.v1", accountId, exportedAt, finalSequence, finalHash });
  return {
    schemaVersion: "relay.audit-export.v1",
    accountId,
    exportedAt,
    finalSequence,
    finalHash,
    exportSigningKeyId: exportSigner.keyId,
    exportSignature: await exportSigner.sign(manifestHash),
    signingKeys: await Promise.all(availableSigners.map(async (signer) => ({ keyId: signer.keyId, algorithm: "Ed25519" as const, publicKeyPem: await signer.publicKeyPem() }))),
    records,
  };
}

export function verifyAuditBundle(bundle: AuditExportBundle) {
  if (bundle.schemaVersion !== "relay.audit-export.v1" || bundle.records.some((record) => record.accountId !== bundle.accountId)) return false;
  const keys = new Map(bundle.signingKeys.map((key) => [key.keyId, key]));
  const exportKey = keys.get(bundle.exportSigningKeyId);
  const manifestHash = canonicalHash({ schemaVersion: bundle.schemaVersion, accountId: bundle.accountId, exportedAt: bundle.exportedAt, finalSequence: bundle.finalSequence, finalHash: bundle.finalHash });
  if (!exportKey || !verifyAuditSignature(exportKey.publicKeyPem, manifestHash, bundle.exportSignature)) return false;
  let previousHash: string | null = null;
  for (const [index, record] of bundle.records.entries()) {
    const key = keys.get(record.signingKeyId);
    if (!key || key.algorithm !== "Ed25519" || record.sequence !== index + 1 || record.previousHash !== previousHash) return false;
    if (canonicalHash(recordMaterial(record)) !== record.recordHash || !verifyAuditSignature(key.publicKeyPem, record.recordHash, record.signature)) return false;
    previousHash = record.recordHash;
  }
  return bundle.finalSequence === bundle.records.length && bundle.finalHash === previousHash;
}

export async function getAuditRecord(accountId: string, recordId: string) {
  const [record] = await db().select().from(auditRecords).where(and(eq(auditRecords.accountId, accountId), eq(auditRecords.id, recordId))).limit(1);
  return record;
}
