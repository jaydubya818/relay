import { afterEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, withTransaction } from '@/lib/db';
import { controlOutbox } from '@/lib/db/schema';
import { canonicalHash } from '@/lib/v2/contracts';
import { createLocalEd25519Signer, verifyAuditSignature } from '@/lib/v2/evidence/crypto';
import { acknowledgePolicyPropagation, enqueuePolicyPropagation, inspectPolicyPropagation } from '@/lib/v2/policy/propagation';
import { freshDatabase, cleanupDatabase } from '../helpers';

afterEach(cleanupDatabase);

it('authenticates exact event/account/installation and distinguishes delivery, fencing and cleanup', async () => {
  const actor = await freshDatabase(), signer = createLocalEd25519Signer('relay-source');
  const backend = createLocalEd25519Signer('backend');
  const binding = { accountId: actor.accountId, backendId: 'myfactory', installationId: 'isolated-test',
    keyId: backend.keyId, publicKeyPem: await backend.publicKeyPem() };
  const event = await withTransaction(transaction => enqueuePolicyPropagation(transaction, {
    accountId: actor.accountId, aggregateId: 'agent', kind: 'AGENT_REVOKED', revision: 2, source: { epoch: 2 },
  }, signer));
  const [row] = await db().select().from(controlOutbox).where(eq(controlOutbox.id, event.eventId));
  const envelope = row!.payload as { payload: Record<string, unknown>; payloadHash: string; signature: string };
  expect(canonicalHash(envelope.payload)).toBe(envelope.payloadHash);
  expect(verifyAuditSignature(await signer.publicKeyPem(), envelope.payloadHash, envelope.signature)).toBe(true);
  await db().update(controlOutbox).set({ publishedAt: new Date().toISOString() }).where(eq(controlOutbox.id, event.eventId));
  expect(await inspectPolicyPropagation(actor.accountId, event.eventId, [binding])).toMatchObject({ status: 'PENDING_BACKEND' });
  const receipt = { schema: 'relay.policy-ack.v1', accountId: actor.accountId, eventId: event.eventId,
    eventHash: event.payloadHash, backendId: binding.backendId, installationId: binding.installationId,
    keyId: backend.keyId, sequence: 1, admissionFence: 'APPLIED', writers: 'FENCED', executionAuthority: 'INVALIDATED',
    cleanup: 'PENDING_BACKEND', accounting: 'PRESERVE_UNKNOWN', evidenceReferences: ['native-fence:2'] };
  const signature = await backend.sign(canonicalHash(receipt));
  for (const change of [{ accountId: 'foreign' }, { installationId: 'foreign' }, { eventHash: '0'.repeat(64) }]) {
    const changed = { ...receipt, ...change };
    await expect(acknowledgePolicyPropagation(changed, await backend.sign(canonicalHash(changed)), binding, signer)).rejects.toBeDefined();
  }
  await expect(acknowledgePolicyPropagation(receipt, 'invalid', binding, signer)).rejects.toBeDefined();
  const results = await Promise.all([1, 2].map(() => acknowledgePolicyPropagation(receipt, signature, binding, signer)));
  expect(results.filter(result => result.replay)).toHaveLength(1);
  expect(results[0]!.status).toBe('PENDING_BACKEND');
  const completed = { ...receipt, sequence: 2, cleanup: 'CONFIRMED', evidenceReferences: ['native-fence:2', 'cleanup:confirmed'] };
  expect(await acknowledgePolicyPropagation(completed, await backend.sign(canonicalHash(completed)), binding, signer)).toMatchObject({ status: 'ACKNOWLEDGED' });
  await expect(acknowledgePolicyPropagation(receipt, signature, binding, signer)).rejects.toBeDefined();
  expect(await inspectPolicyPropagation(actor.accountId, event.eventId, [binding])).toEqual({ status: 'ACKNOWLEDGED', accounting: 'PRESERVE_UNKNOWN' });
  expect(await inspectPolicyPropagation(actor.accountId, event.eventId, [])).toMatchObject({ status: 'PENDING_BACKEND' });
  expect(await inspectPolicyPropagation(actor.accountId, event.eventId, [{ ...binding, publicKeyPem: await signer.publicKeyPem() }])).toMatchObject({ status: 'PENDING_BACKEND' });
  await db().update(controlOutbox).set({ cancelledAt: new Date().toISOString() }).where(eq(controlOutbox.id, event.eventId));
  expect(await inspectPolicyPropagation(actor.accountId, event.eventId, [binding])).toMatchObject({ status: 'PENDING_BACKEND' });
});
