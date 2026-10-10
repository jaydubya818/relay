import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { lockActiveAccount } from '@/lib/account-fence';
import { db, withTransaction, type RelayDatabase } from '@/lib/db';
import { controlOutbox } from '@/lib/db/schema';
import { RelayError } from '@/lib/errors';
import { id, now } from '@/lib/ids';
import { purposeSigner } from '@/lib/v2/evidence/signing-provider';
import { canonicalHash } from '@/lib/v2/contracts';
import { appendAuditRecordInTransaction } from '@/lib/v2/evidence/audit';
import { verifyAuditSignature, type AuditSigner } from '@/lib/v2/evidence/crypto';

const reference = z.string().min(1).max(255);
const acknowledgment = z.object({
  schema: z.literal('relay.policy-ack.v1'), accountId: reference, eventId: reference,
  eventHash: z.string().regex(/^sha256:[a-f0-9]{64}$/), backendId: reference,
  installationId: reference, keyId: reference, sequence: z.number().int().positive(),
  admissionFence: z.literal('APPLIED'), writers: z.enum(['FENCED', 'PENDING_BACKEND']),
  executionAuthority: z.enum(['INVALIDATED', 'PENDING_BACKEND']),
  cleanup: z.enum(['CONFIRMED', 'PENDING_BACKEND']),
  accounting: z.literal('PRESERVE_UNKNOWN'), evidenceReferences: z.array(reference).min(1).max(100),
}).strict();

export interface PropagationBinding {
  accountId: string; backendId: string; installationId: string; keyId: string; publicKeyPem: string;
}

export async function enqueuePolicyPropagation(transaction: RelayDatabase,
  input: { accountId: string; aggregateId: string; kind: 'POLICY_CHANGED' | 'AGENT_REVOKED'; revision: number; source: Record<string, unknown> },
  signer: AuditSigner) {
  signer = purposeSigner(signer, 'evidence');
  const eventId = id('obx');
  const payload = { schema: 'relay.policy-change.v1', eventId, ...input, issuedAt: now(), accounting: 'PRESERVE_UNKNOWN' };
  const payloadHash = canonicalHash(payload);
  const envelope = { payload, payloadHash, keyId: signer.keyId, signature: await signer.sign(payloadHash) };
  await transaction.insert(controlOutbox).values({ id: eventId, accountId: input.accountId,
    aggregateType: 'capability_policy', aggregateId: input.aggregateId, type: 'capability.policy.changed',
    payload: envelope, idempotencyKey: `capability-policy:${input.kind}:${input.aggregateId}:${input.revision}` });
  return { eventId, payloadHash, status: 'PENDING_BACKEND' as const };
}

// The caller supplies a server-owned installation/key binding, never one from the request.
export async function acknowledgePolicyPropagation(value: unknown, signature: string,
  binding: PropagationBinding, signer: AuditSigner) {
  const receipt = acknowledgment.parse(value);
  if (receipt.accountId !== binding.accountId || receipt.backendId !== binding.backendId
    || receipt.installationId !== binding.installationId || receipt.keyId !== binding.keyId
    || !verifyAuditSignature(binding.publicKeyPem, canonicalHash(receipt), signature))
    throw new RelayError('INVALID_CREDENTIAL', 'Policy acknowledgment scope or signature is invalid.', undefined, 401);
  return withTransaction(async transaction => {
    await lockActiveAccount(transaction, binding.accountId);
    const [event] = await transaction.select().from(controlOutbox).where(and(
      eq(controlOutbox.id, receipt.eventId), eq(controlOutbox.accountId, binding.accountId),
      eq(controlOutbox.aggregateType, 'capability_policy'))).limit(1);
    const envelope = event?.payload as { payloadHash?: string; payload?: { kind?: string } } | undefined;
    if (!event || event.cancelledAt || envelope?.payloadHash !== receipt.eventHash)
      throw new RelayError('INVALID_INPUT', 'Policy propagation reference is unavailable.', undefined, 409);
    const key = `capability-ack:${receipt.eventId}:${binding.backendId}:${binding.installationId}`;
    const [prior] = await transaction.select().from(controlOutbox).where(and(
      eq(controlOutbox.accountId, binding.accountId), eq(controlOutbox.idempotencyKey, key))).limit(1);
    const hash = canonicalHash(receipt);
    if (prior) {
      const saved = prior.payload as { receipt: z.infer<typeof acknowledgment>; hash: string; status: string };
      if (saved.hash === hash) return { status: saved.status, replay: true };
      if (receipt.sequence <= saved.receipt.sequence || saved.status === 'ACKNOWLEDGED'
        || (saved.receipt.writers === 'FENCED' && receipt.writers !== 'FENCED')
        || (saved.receipt.executionAuthority === 'INVALIDATED' && receipt.executionAuthority !== 'INVALIDATED')
        || (saved.receipt.cleanup === 'CONFIRMED' && receipt.cleanup !== 'CONFIRMED'))
        throw new RelayError('INVALID_INPUT', 'Policy acknowledgment is stale or regressive.', undefined, 409);
    }
    const complete = envelope?.payload?.kind === 'POLICY_CHANGED'
      || (receipt.writers === 'FENCED' && receipt.executionAuthority === 'INVALIDATED' && receipt.cleanup === 'CONFIRMED');
    const status = complete ? 'ACKNOWLEDGED' : 'PENDING_BACKEND';
    const payload = { receipt, signature, hash, status };
    if (prior) await transaction.update(controlOutbox).set({ payload }).where(eq(controlOutbox.id, prior.id));
    else await transaction.insert(controlOutbox).values({ id: id('obx'), accountId: binding.accountId,
      aggregateType: 'capability_ack', aggregateId: receipt.eventId, type: 'capability.policy.acknowledged',
      payload, idempotencyKey: key, publishedAt: now() });
    await appendAuditRecordInTransaction(transaction, { accountId: binding.accountId,
      eventType: 'capability.policy.acknowledged', outcome: 'SUCCESS', details: payload }, signer);
    return { status, replay: false };
  });
}

export async function inspectPolicyPropagation(accountId: string, eventId: string, bindings: readonly PropagationBinding[]) {
  const [event] = await db().select().from(controlOutbox).where(and(eq(controlOutbox.accountId, accountId),
    eq(controlOutbox.id, eventId), eq(controlOutbox.aggregateType, 'capability_policy'))).limit(1);
  if (!event || event.cancelledAt) return { status: 'PENDING_BACKEND', accounting: 'PRESERVE_UNKNOWN' };
  const eventHash = (event.payload as { payloadHash: string }).payloadHash;
  const required = bindings.filter(binding => binding.accountId === accountId);
  const receipts = await db().select().from(controlOutbox).where(and(eq(controlOutbox.accountId, accountId),
    eq(controlOutbox.aggregateType, 'capability_ack'), eq(controlOutbox.aggregateId, eventId)));
  const acknowledged = required.length > 0 && required.every(binding => receipts.some(row => {
    const data = row.payload as { receipt?: z.infer<typeof acknowledgment>; status?: string; signature: string };
    return data.status === 'ACKNOWLEDGED' && data.receipt?.backendId === binding.backendId
      && data.receipt.installationId === binding.installationId && data.receipt.keyId === binding.keyId
      && data.receipt.eventId === eventId && data.receipt.eventHash === eventHash
      && verifyAuditSignature(binding.publicKeyPem, canonicalHash(data.receipt), data.signature);
  }));
  return { status: acknowledged ? 'ACKNOWLEDGED' : 'PENDING_BACKEND', accounting: 'PRESERVE_UNKNOWN' };
}
