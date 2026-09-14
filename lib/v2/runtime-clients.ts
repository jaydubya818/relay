import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { hashSecret } from "@/lib/crypto";
import { db, withTransaction } from "@/lib/db";
import { runtimeClients } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { requireMembership } from "@/lib/v2/identity";

export interface RuntimeAttestationVerifier {
  verify(proof: string): Promise<{ product: string; evidence: Record<string, unknown> }>;
}

function secretsEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function registerRuntimeClient(input: { accountId: string; actorPrincipalId: string; displayName: string; selfDeclaredProduct: string }, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.actorPrincipalId, allowedRoles: ["OWNER", "ADMIN"] });
  const secret = `rrtc_${randomBytes(32).toString("base64url")}`;
  const runtimeClientId = id("rtc");
  await withTransaction(async (transaction) => {
    await transaction.insert(runtimeClients).values({ id: runtimeClientId, accountId: input.accountId, displayName: input.displayName.trim(), selfDeclaredProduct: input.selfDeclaredProduct.trim(), secretHash: hashSecret(secret), prefix: secret.slice(0, 14) });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.actorPrincipalId, runtimeClientId, eventType: "runtime_client.registered", outcome: "SUCCESS", details: { selfDeclaredProduct: input.selfDeclaredProduct, verificationStatus: "SELF_DECLARED" } }, signer);
  });
  return { runtimeClientId, secret, verificationStatus: "SELF_DECLARED" as const };
}

export async function authenticateRuntimeClient(accountId: string, secret: string) {
  const prefix = secret.slice(0, 14);
  const candidates = await db().select().from(runtimeClients).where(and(eq(runtimeClients.accountId, accountId), eq(runtimeClients.prefix, prefix), isNull(runtimeClients.revokedAt)));
  const client = candidates.find((candidate) => secretsEqual(candidate.secretHash, hashSecret(secret)));
  if (!client) throw new RelayError("INVALID_CREDENTIAL", "Invalid runtime credential.", undefined, 401);
  return { runtimeClientId: client.id, verificationStatus: client.verificationStatus, selfDeclaredProduct: client.selfDeclaredProduct, verifiedProduct: client.verifiedProduct };
}

export async function verifyRuntimeClient(input: { accountId: string; actorPrincipalId: string; runtimeClientId: string; proof: string }, verifier: RuntimeAttestationVerifier, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.actorPrincipalId, allowedRoles: ["OWNER", "ADMIN"] });
  const [client] = await db().select({ id: runtimeClients.id }).from(runtimeClients).where(and(eq(runtimeClients.accountId, input.accountId), eq(runtimeClients.id, input.runtimeClientId), isNull(runtimeClients.revokedAt))).limit(1);
  if (!client) throw new RelayError("INVALID_INPUT", "Runtime client not found.", undefined, 404);
  const verified = await verifier.verify(input.proof);
  return await withTransaction(async (transaction) => {
    const updated = await transaction.update(runtimeClients).set({ verifiedProduct: verified.product, verificationStatus: "VERIFIED", verificationEvidence: verified.evidence, verifiedAt: now() }).where(and(eq(runtimeClients.accountId, input.accountId), eq(runtimeClients.id, input.runtimeClientId), isNull(runtimeClients.revokedAt))).returning({ id: runtimeClients.id });
    if (!updated.length) throw new RelayError("INVALID_INPUT", "Runtime client not found.", undefined, 404);
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.actorPrincipalId, runtimeClientId: input.runtimeClientId, eventType: "runtime_client.verified", outcome: "SUCCESS", details: { verifiedProduct: verified.product } }, signer);
    return { verifiedProduct: verified.product, verificationStatus: "VERIFIED" as const };
  });
}

export async function revokeRuntimeClient(input: { accountId: string; actorPrincipalId: string; runtimeClientId: string }, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.actorPrincipalId, allowedRoles: ["OWNER", "ADMIN"] });
  await withTransaction(async (transaction) => {
    const updated = await transaction.update(runtimeClients).set({ verificationStatus: "REVOKED", revokedAt: now() }).where(and(eq(runtimeClients.accountId, input.accountId), eq(runtimeClients.id, input.runtimeClientId), isNull(runtimeClients.revokedAt))).returning({ id: runtimeClients.id });
    if (!updated.length) throw new RelayError("INVALID_INPUT", "Runtime client not found.", undefined, 404);
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.actorPrincipalId, runtimeClientId: input.runtimeClientId, eventType: "runtime_client.revoked", outcome: "SUCCESS" }, signer);
  });
}
