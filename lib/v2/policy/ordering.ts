import { and, eq } from 'drizzle-orm';
import { withTransaction, type RelayDatabase } from '@/lib/db';
import { controlOutbox } from '@/lib/db/schema';
import { lockAccountDelivery } from '@/lib/account-fence';
import { id, now } from '@/lib/ids';
import { canonicalHash, type ActionIntent } from '@/lib/v2/contracts';
import { assertPolicyIdentity, policyMessageHash, signPolicyMessage, verifyPolicyMessage,
  type Fence, type PolicyKey, type SignedPolicyMessage, type AdmissionPermit } from './ordering-wire';

export type OrderedDestination = {
  accountId: string; ownerId: string; organizationId: string; installationId: string;
  backendId: string; incarnation: string; enrollmentVersion: number; agentId: string;
  capabilityNames: Record<string, string>; endpoint: string;
  sourceKey: PolicyKey; backendKey: PolicyKey;
};
type Configuration = { signer: PolicyKey; destinations: OrderedDestination[] };
export function orderingConfiguration(): Configuration | null {
  if (!process.env.RELAY_CAPABILITY_COORDINATION_JSON) return null;
  if (process.env.RELAY_CAPABILITY_ENVIRONMENT !== 'qualification' || process.env.VERCEL)
    throw Error('CAPABILITY_INSTALLATION_UNQUALIFIED');
  const config = JSON.parse(process.env.RELAY_CAPABILITY_COORDINATION_JSON) as Configuration;
  if (!Array.isArray(config.destinations) || !config.signer) throw Error('CAPABILITY_INSTALLATION_UNQUALIFIED');
  return config;
}
const epochKey = 'capability-ordering:epoch';
type Epoch = { version: number; policyId: string; destinations: OrderedDestination[]; pending: string[] };
const destinationId = (destination: OrderedDestination) => canonicalHash({ ownerId: destination.ownerId,
  organizationId: destination.organizationId, installationId: destination.installationId,
  backendId: destination.backendId, incarnation: destination.incarnation, enrollmentVersion: destination.enrollmentVersion });
async function epochRow(transaction: RelayDatabase, accountId: string) {
  return (await transaction.select().from(controlOutbox).where(and(eq(controlOutbox.accountId, accountId), eq(controlOutbox.idempotencyKey, epochKey))).limit(1))[0];
}

/** Caller holds the account authority lock; policy edits and this outbox commit together. */
export async function advanceRelayPolicyFence(transaction: RelayDatabase, accountId: string, operation: 'disable' | 'revoke' = 'disable') {
  const prior = await epochRow(transaction, accountId), config = orderingConfiguration();
  const destinations = config?.destinations.filter(item => item.accountId === accountId) ?? [];
  if (!destinations.length) {
    if (prior) throw Error('CAPABILITY_ENROLLMENT_UNAVAILABLE');
    return;
  }
  const previous = prior?.payload as Epoch | undefined;
  if (previous && canonicalHash(previous.destinations) !== canonicalHash(destinations)) throw Error('CAPABILITY_ENROLLMENT_CHANGED');
  const epoch: Epoch = { version: (previous?.version ?? 0) + 1, policyId: id('pol'), destinations, pending: destinations.map(destinationId) };
  for (const destination of destinations) {
    const fence: Fence = { kind: 'FENCE', authority: 'relay', ownerId: destination.ownerId,
      organizationId: destination.organizationId, installationId: destination.installationId,
      backendId: destination.backendId, incarnation: destination.incarnation, enrollmentVersion: destination.enrollmentVersion,
      version: epoch.version, policyId: epoch.policyId, capabilityId: 'work', operation };
    const envelope = await signPolicyMessage(fence, config!.signer);
    await transaction.insert(controlOutbox).values({ id: id('obx'), accountId, aggregateType: 'capability_fence',
      aggregateId: epoch.policyId, type: 'capability.fence', payload: { destination, envelope },
      idempotencyKey: `capability-fence:${epoch.version}:${destinationId(destination)}` });
  }
  if (prior) await transaction.update(controlOutbox).set({ payload: epoch }).where(eq(controlOutbox.id, prior.id));
  else await transaction.insert(controlOutbox).values({ id: id('obx'), accountId, aggregateType: 'capability_epoch',
    aggregateId: accountId, type: 'capability.epoch', payload: epoch, idempotencyKey: epochKey, publishedAt: now() });
}

export async function relayAdmissionPermit(transaction: RelayDatabase, input: {
  accountId: string; action: ActionIntent; source: SignedPolicyMessage; leaseId: string; agentRevision: number; expiresAt: number;
}) {
  const config = orderingConfiguration();
  const untrusted = JSON.parse(input.source.message) as AdmissionPermit;
  const destination = config?.destinations.find(item => item.accountId === input.accountId && item.ownerId === untrusted.ownerId
    && item.installationId === untrusted.installationId && item.backendId === untrusted.backendId && item.agentId === input.action.agentId);
  if (!config || !destination) throw Error('CAPABILITY_ENROLLMENT_UNAVAILABLE');
  const permit = await verifyPolicyMessage(input.source, destination.sourceKey);
  if (permit.kind !== 'PERMIT' || permit.authority !== 'myeve' || permit.agentId !== input.action.agentId
    || permit.organizationId !== destination.organizationId || permit.incarnation !== destination.incarnation
    || permit.enrollmentVersion !== destination.enrollmentVersion || permit.expiresAt <= Date.now()
    || permit.issuedAt > Date.now() || destination.capabilityNames[permit.capabilityId] !== input.action.capability.name
    || input.action.parameters.capabilityAdmissionDigest !== await policyMessageHash(permit)) throw Error('CAPABILITY_ADMISSION_SCOPE');
  const current = await epochRow(transaction, input.accountId), epoch = current?.payload as Epoch | undefined;
  if (!epoch || epoch.pending.length || canonicalHash(epoch.destinations) !== canonicalHash(config.destinations.filter(item => item.accountId === input.accountId)))
    throw Error('CAPABILITY_PROPAGATION_PENDING');
  const expiresAt = Math.min(permit.expiresAt, input.expiresAt);
  if (expiresAt <= Date.now()) throw Error('CAPABILITY_REFERENCE_EXPIRED');
  const result = await signPolicyMessage({ ...permit, authority: 'relay', referenceId: input.leaseId,
    version: epoch.version, policyId: epoch.policyId, agentRevision: input.agentRevision, expiresAt,
    sourcePermitHash: await policyMessageHash(permit) }, config.signer);
  await transaction.insert(controlOutbox).values({ id: id('obx'), accountId: input.accountId, aggregateType: 'capability_reference',
    aggregateId: input.leaseId, type: 'capability.reference', payload: result,
    idempotencyKey: `capability-reference:${input.leaseId}`, publishedAt: now() });
  return result;
}

export async function deliverCapabilityFence(destination: OrderedDestination, envelope: SignedPolicyMessage) {
  const source = await verifyPolicyMessage(envelope, JSON.parse(envelope.message).authority === 'myeve'
    ? destination.sourceKey : orderingConfiguration()!.signer);
  if (source.kind !== 'FENCE') throw Error('CAPABILITY_FENCE_REQUIRED');
  const endpoint = new URL(destination.endpoint);
  if (endpoint.username || endpoint.password || endpoint.hash || endpoint.search
    || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(endpoint.hostname))))
    throw Error('CAPABILITY_ENDPOINT_UNQUALIFIED');
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envelope }) });
  if (!response.ok || !response.body) throw Error('CAPABILITY_DELIVERY_UNAVAILABLE');
  const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > 32_768) throw Error('CAPABILITY_ACK_TOO_LARGE'); chunks.push(value); }
  } finally { await reader.cancel(); }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  const acknowledgment = JSON.parse(new TextDecoder().decode(data)) as SignedPolicyMessage;
  const ack = await verifyPolicyMessage(acknowledgment, destination.backendKey);
  assertPolicyIdentity(ack, source);
  if (ack.kind !== 'FENCE_ACK' || ack.fenceHash !== await policyMessageHash(source)) throw Error('CAPABILITY_ACK_MISMATCH');
  return acknowledgment;
}

export async function forwardOwnerPolicyFence(envelope: SignedPolicyMessage) {
  if (!envelope || typeof envelope.message !== 'string' || envelope.message.length > 16_384) throw Error('CAPABILITY_PROTOCOL_INVALID');
  const hint = JSON.parse(envelope.message) as Fence;
  const destination = orderingConfiguration()?.destinations.find(item => item.ownerId === hint.ownerId
    && item.organizationId === hint.organizationId && item.installationId === hint.installationId
    && item.backendId === hint.backendId && item.incarnation === hint.incarnation && item.enrollmentVersion === hint.enrollmentVersion);
  if (!destination) throw Error('CAPABILITY_ENROLLMENT_UNAVAILABLE');
  const fence = await verifyPolicyMessage(envelope, destination.sourceKey);
  if (fence.kind !== 'FENCE' || fence.authority !== 'myeve') throw Error('CAPABILITY_FENCE_REQUIRED');
  const key = `owner-fence:${destinationId(destination)}:${fence.version}`;
  const prior = await withTransaction(async transaction => {
    await lockAccountDelivery(transaction, destination.accountId);
    const [row] = await transaction.select().from(controlOutbox).where(and(eq(controlOutbox.accountId, destination.accountId), eq(controlOutbox.idempotencyKey, key))).limit(1);
    if (row) {
      const saved = row.payload as { envelope: SignedPolicyMessage; acknowledgment?: SignedPolicyMessage };
      if (saved.envelope.message !== envelope.message) throw Error('CAPABILITY_FENCE_CONFLICT');
      return saved.acknowledgment;
    }
    await transaction.insert(controlOutbox).values({ id: id('obx'), accountId: destination.accountId,
      aggregateType: 'capability_owner_fence', aggregateId: fence.policyId, type: 'capability.owner-fence',
      payload: { envelope }, idempotencyKey: key });
    return undefined;
  });
  const acknowledgment = prior ?? await deliverCapabilityFence(destination, envelope);
  const ack = await verifyPolicyMessage(acknowledgment, destination.backendKey);
  assertPolicyIdentity(ack, fence);
  if (ack.kind !== 'FENCE_ACK' || ack.fenceHash !== await policyMessageHash(fence)) throw Error('CAPABILITY_ACK_MISMATCH');
  await withTransaction(async transaction => {
    await lockAccountDelivery(transaction, destination.accountId);
    await transaction.update(controlOutbox).set({ payload: { envelope, acknowledgment }, publishedAt: now() })
      .where(and(eq(controlOutbox.accountId, destination.accountId), eq(controlOutbox.idempotencyKey, key)));
  });
  return acknowledgment;
}

export async function flushRelayPolicyFences(accountId: string) {
  const pending = await withTransaction(async transaction => {
    await lockAccountDelivery(transaction, accountId);
    const row = await epochRow(transaction, accountId), epoch = row?.payload as Epoch | undefined;
    if (!epoch) return [];
    return transaction.select().from(controlOutbox).where(and(eq(controlOutbox.accountId, accountId),
      eq(controlOutbox.aggregateType, 'capability_fence'), eq(controlOutbox.aggregateId, epoch.policyId)));
  });
  for (const item of pending) {
    const { destination, envelope } = item.payload as { destination: OrderedDestination; envelope: SignedPolicyMessage };
    const current = orderingConfiguration()?.destinations.find(value => destinationId(value) === destinationId(destination));
    if (!current || canonicalHash(current) !== canonicalHash(destination)) throw Error('CAPABILITY_ENROLLMENT_CHANGED');
    const acknowledgment = await deliverCapabilityFence(current, envelope);
    await withTransaction(async transaction => {
      await lockAccountDelivery(transaction, accountId);
      const row = await epochRow(transaction, accountId), epoch = row!.payload as Epoch;
      if (epoch.policyId !== item.aggregateId) throw Error('CAPABILITY_ACK_SUPERSEDED');
      await transaction.update(controlOutbox).set({ payload: { ...epoch, pending: epoch.pending.filter(key => key !== destinationId(destination)) } }).where(eq(controlOutbox.id, row!.id));
      await transaction.update(controlOutbox).set({ payload: { destination, envelope, acknowledgment }, publishedAt: now() }).where(eq(controlOutbox.id, item.id));
    });
  }
}
