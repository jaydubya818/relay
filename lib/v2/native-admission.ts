import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { lockActiveAccount } from '@/lib/account-fence';
import { withTransaction, type RelayDatabase } from '@/lib/db';
import { approvalRequests, budgetReservations, budgets, controlOutbox, runtimeClients, workloads } from '@/lib/db/schema';
import { id, now } from '@/lib/ids';
import { actionIntentSchema, canonicalHash, type ActionIntent } from '@/lib/v2/contracts';
import { appendAuditRecordInTransaction } from '@/lib/v2/evidence/audit';
import type { AuditSigner } from '@/lib/v2/evidence/crypto';
import { authenticateWorkloadToken, authorizeLeaseCallInTransaction, issueCapabilityLeaseInTransaction, type LeaseKeyResolver } from '@/lib/v2/leases';
import { admissionActionDigest, assertPolicyIdentity, policyMessageHash, verifyPolicyMessage,
  type AdmissionPermit, type Fence, type PolicyKey, type SignedPolicyMessage } from '@/lib/v2/policy/ordering-wire';

const identity = z.string().min(1).max(255);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const nativeWorkBindingSchema = z.object({
  accountId: identity, ownerId: identity, organizationId: identity, installationId: identity,
  agentId: identity, runtimeClientId: identity, workloadId: identity, taskId: identity,
  workId: identity, missionId: identity, workGeneration: z.number().int().positive(),
  connectionId: identity, connectionAuthorityVersion: z.number().int().positive(),
  descriptorHash: digest, argumentHash: digest, targetResource: identity,
  capabilityId: z.literal('connected-apps'), effect: z.literal('READ'),
}).strict();
export type NativeWorkBinding = z.infer<typeof nativeWorkBindingSchema>;
export type NativeAdmissionReceipt = {
  schemaVersion: 'relay.native-admission.v1'; commandId: string; leaseId: string;
  binding: NativeWorkBinding; bindingHash: string; requestHash: string;
  sourceReferenceId: string; relayReferenceId: string; admittedAt: string;
  backendId: string; incarnation: string; enrollmentVersion: number; sourcePolicyVersion: number; relayPolicyVersion: number;
};
export type NativeLeaseRequest = Omit<Parameters<typeof issueCapabilityLeaseInTransaction>[1], 'maxCalls' | 'allowOffline' | 'remoteAdmission'>;

/** A trusted, server-installed adapter to an EXISTING native command transaction.
 * Never construct this object or its enrollment from request JSON. No network effects
 * in admitCommand; connection and Work writers must use the account authority lock.
 * Heads are authenticated durable receiver mirrors. The independent witness must
 * survive receiver database restore and fail closed when it cannot be consulted. */
export interface NativeReceivingHost {
  enrollment: { accountId: string; ownerId: string; organizationId: string; installationId: string;
    backendId: string; incarnation: string; enrollmentVersion: number; audience: string;
    sourceKey: PolicyKey; relayKey: PolicyKey };
  resolveBinding(transaction: RelayDatabase, requested: NativeWorkBinding, action: ActionIntent): Promise<{
    binding: NativeWorkBinding; descriptor: unknown;
  }>;
  readPolicyHeads(transaction: RelayDatabase): Promise<{ myeve: SignedPolicyMessage; relay: SignedPolicyMessage }>;
  readTrustedPolicyHeads(): Promise<{ myeve: SignedPolicyMessage; relay: SignedPolicyMessage }>;
  admitCommand(transaction: RelayDatabase, input: { binding: NativeWorkBinding; action: ActionIntent;
    leaseId: string; idempotencyKey: string; requestHash: string }): Promise<{ commandId: string }>;
}

/** Exact action material; the source-permit digest itself is excluded to avoid a cycle. */
export function nativeAdmissionActionMaterial(binding: NativeWorkBinding, action: ActionIntent) {
  const { capabilityAdmissionDigest: _sourceReference, ...parameters } = action.parameters;
  void _sourceReference;
  return { schemaVersion: 'relay.native-action.v1', binding, action: {
    id: action.id, accountId: action.accountId, agentId: action.agentId, runtimeClientId: action.runtimeClientId,
    taskId: action.taskId, workloadId: action.workloadId, capability: action.capability, resource: action.resource, parameters,
    idempotencyKey: action.idempotencyKey,
  } };
}
function deny(reason: string): never { throw new Error(`NATIVE_ADMISSION_${reason}`); }
function matchEnrollment(binding: NativeWorkBinding, host: NativeReceivingHost) {
  for (const key of ['accountId', 'ownerId', 'organizationId', 'installationId'] as const)
    if (binding[key] !== host.enrollment[key]) deny('ENROLLMENT_MISMATCH');
}
async function currentHeads(transaction: RelayDatabase, host: NativeReceivingHost) {
  const persisted = await host.readPolicyHeads(transaction);
  const trusted = await host.readTrustedPolicyHeads();
  const result = {} as Record<'myeve' | 'relay', Fence>;
  for (const authority of ['myeve', 'relay'] as const) {
    const key = authority === 'myeve' ? host.enrollment.sourceKey : host.enrollment.relayKey;
    const local = await verifyPolicyMessage(persisted[authority], key);
    const witness = await verifyPolicyMessage(trusted[authority], key);
    if (local.kind !== 'FENCE' || local.authority !== authority || witness.kind !== 'FENCE'
      || await policyMessageHash(local) !== await policyMessageHash(witness)) deny('RESTORE_OR_STALE_POLICY');
    for (const field of ['ownerId', 'organizationId', 'installationId', 'backendId', 'incarnation', 'enrollmentVersion'] as const)
      if (local[field] !== host.enrollment[field]) deny('POLICY_ENROLLMENT_MISMATCH');
    result[authority] = local;
  }
  return result;
}
function assertPermitCurrent(permit: AdmissionPermit, head: Fence, binding: NativeWorkBinding) {
  assertPolicyIdentity(permit, head);
  if (head.authority === 'myeve' && ['disable', 'pause', 'revoke'].includes(head.operation)
    && permit.requiredCapabilities.includes(head.capabilityId)) deny('CAPABILITY_DISABLED');
  if (permit.expiresAt <= Date.now() || permit.issuedAt > Date.now()
    || permit.capabilityId !== binding.capabilityId || permit.agentId !== binding.agentId
    || permit.workId !== binding.workId || permit.missionId !== binding.missionId
    || permit.workGeneration !== binding.workGeneration) deny('PERMIT_SCOPE');
}

/** No provider dispatch occurs here. Native command, approval consumption, lease/call
 * debit, reservation binding, receipt and audit either all commit or all roll back. */
export async function admitNativeCommand(input: { binding: NativeWorkBinding; lease: NativeLeaseRequest;
  source: SignedPolicyMessage; idempotencyKey: string }, host: NativeReceivingHost,
  signer: AuditSigner, resolver: LeaseKeyResolver): Promise<NativeAdmissionReceipt> {
  const binding = nativeWorkBindingSchema.parse(input.binding);
  identity.parse(input.idempotencyKey);
  matchEnrollment(binding, host);
  if (input.lease.accountId !== binding.accountId || input.lease.audience !== host.enrollment.audience
    || input.lease.workloadId !== binding.workloadId) deny('RUNTIME_SCOPE');
  const authenticated = await authenticateWorkloadToken(input.lease.workloadIdentityToken, resolver, {
    accountId: binding.accountId, workloadId: binding.workloadId, audience: host.enrollment.audience });
  if (authenticated.agentId !== binding.agentId || authenticated.runtimeClientId !== binding.runtimeClientId
    || authenticated.taskId !== binding.taskId) deny('RUNTIME_SCOPE');
  const action = actionIntentSchema.parse(input.lease.action);
  if (action.accountId !== binding.accountId || action.agentId !== binding.agentId
    || action.runtimeClientId !== binding.runtimeClientId || action.taskId !== binding.taskId
    || action.workloadId !== binding.workloadId) deny('ACTION_SCOPE');
  const source = await verifyPolicyMessage(input.source, host.enrollment.sourceKey);
  if (source.kind !== 'PERMIT' || source.authority !== 'myeve') deny('SOURCE_REQUIRED');
  if (source.budgetMicros !== 0) deny('MONETARY_MAPPING_UNQUALIFIED');
  if (source.actionDigest !== await admissionActionDigest(nativeAdmissionActionMaterial(binding, action))
    || action.parameters.capabilityAdmissionDigest !== await policyMessageHash(source)) deny('ACTION_INTEGRITY');
  const { workloadIdentityToken: _credential, ...leaseMaterial } = input.lease;
  void _credential;
  const requestHash = canonicalHash({ binding, lease: leaseMaterial, source: input.source.message });
  return withTransaction(async transaction => {
    // Same order as canonical lease issuance and policy writers.
    await transaction.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtextextended('relay-safety-policy', 0))`);
    await lockActiveAccount(transaction, binding.accountId);
    const key = `native-admission:${input.idempotencyKey}`;
    const context = await host.resolveBinding(transaction, binding, action);
    const resolved = nativeWorkBindingSchema.parse(context.binding);
    if (canonicalHash(resolved) !== canonicalHash(binding)) deny('NATIVE_BINDING_CHANGED');
    const { capabilityAdmissionDigest: _proofHash, ...argumentsForExecution } = action.parameters;
    void _proofHash;
    if (canonicalHash(argumentsForExecution) !== binding.argumentHash
      || canonicalHash(context.descriptor) !== binding.descriptorHash
      || !action.resource.ids?.includes(binding.connectionId)
      || !action.resource.ids.includes(binding.targetResource)) deny('EXECUTION_MATERIAL_MISMATCH');
    const [runtime] = await transaction.select({ id: runtimeClients.id }).from(runtimeClients).where(and(
      eq(runtimeClients.accountId, binding.accountId), eq(runtimeClients.id, binding.runtimeClientId),
      isNull(runtimeClients.revokedAt), sql`${runtimeClients.verificationStatus} <> 'REVOKED'`)).limit(1);
    const [workload] = await transaction.select({ id: workloads.id }).from(workloads).where(and(
      eq(workloads.accountId, binding.accountId), eq(workloads.id, binding.workloadId), eq(workloads.agentId, binding.agentId),
      eq(workloads.runtimeClientId, binding.runtimeClientId), eq(workloads.taskId, binding.taskId),
      eq(workloads.audience, host.enrollment.audience), eq(workloads.status, 'ACTIVE'), gt(workloads.expiresAt, now()))).limit(1);
    if (!runtime || !workload) deny('RUNTIME_REVOKED');
    const heads = await currentHeads(transaction, host);
    const [prior] = await transaction.select().from(controlOutbox).where(and(eq(controlOutbox.accountId, binding.accountId), eq(controlOutbox.idempotencyKey, key))).limit(1);
    if (prior) {
      const receipt = prior.payload as NativeAdmissionReceipt;
      if (receipt.requestHash !== requestHash) deny('IDEMPOTENCY_CONFLICT');
      // A receipt is historical evidence, never a dispatch permit; no lease is reissued.
      return receipt;
    }
    assertPermitCurrent(source, heads.myeve, binding);
    if (!input.lease.budgetReservationId) deny('BUDGET_REQUIRED');
    const [nativeReservation] = await transaction.select().from(budgetReservations).where(and(
      eq(budgetReservations.accountId, binding.accountId), eq(budgetReservations.id, input.lease.budgetReservationId))).limit(1);
    if (!nativeReservation || nativeReservation.dimension !== 'CONNECTOR_CALLS' || nativeReservation.currency !== null)
      deny('MONETARY_MAPPING_UNQUALIFIED');
    const currentBudgets = await transaction.select().from(budgets).where(and(eq(budgets.accountId, binding.accountId),
      inArray(budgets.id, nativeReservation.appliedBudgetIds), eq(budgets.status, 'ACTIVE'), eq(budgets.balanceStatus, 'CURRENT')));
    if (currentBudgets.length !== nativeReservation.appliedBudgetIds.length) deny('BUDGET_STATE_UNAVAILABLE');
    const lease = await issueCapabilityLeaseInTransaction(transaction, { ...input.lease, maxCalls: 1,
      allowOffline: false, remoteAdmission: input.source }, signer, resolver);
    if (!lease.remotePermit) deny('RELAY_PERMIT_REQUIRED');
    const relay = await verifyPolicyMessage(lease.remotePermit, host.enrollment.relayKey);
    if (relay.kind !== 'PERMIT' || relay.authority !== 'relay'
      || relay.sourcePermitHash !== await policyMessageHash(source)) deny('RELAY_PERMIT_SCOPE');
    assertPermitCurrent(relay, heads.relay, binding);
    const call = await authorizeLeaseCallInTransaction(transaction, { token: lease.token, expectedAccountId: binding.accountId,
      expectedAudience: host.enrollment.audience, expectedWorkloadId: binding.workloadId, action,
      callId: `native:${input.idempotencyKey}` }, resolver, signer);
    if (call.claims.effectClass !== 'read') deny('EFFECT_UNQUALIFIED');
    const command = await host.admitCommand(transaction, { binding, action, leaseId: lease.leaseId,
      idempotencyKey: input.idempotencyKey, requestHash });
    identity.parse(command.commandId);
    const receipt: NativeAdmissionReceipt = { schemaVersion: 'relay.native-admission.v1', commandId: command.commandId,
      leaseId: lease.leaseId, binding, bindingHash: canonicalHash(binding), requestHash,
      sourceReferenceId: source.referenceId, relayReferenceId: relay.referenceId, admittedAt: now(),
      backendId: source.backendId, incarnation: source.incarnation, enrollmentVersion: source.enrollmentVersion,
      sourcePolicyVersion: source.version, relayPolicyVersion: relay.version };
    await transaction.insert(controlOutbox).values({ id: id('obx'), accountId: binding.accountId,
      aggregateType: 'native_admission_receipt', aggregateId: command.commandId, type: 'native.admitted',
      payload: receipt, idempotencyKey: key, publishedAt: receipt.admittedAt });
    await appendAuditRecordInTransaction(transaction, { accountId: binding.accountId, agentId: binding.agentId,
      runtimeClientId: binding.runtimeClientId, taskId: binding.taskId, leaseId: lease.leaseId,
      eventType: 'native.admitted', outcome: 'SUCCESS', details: { commandId: command.commandId,
        requestHash, bindingHash: receipt.bindingHash, sourceReferenceId: source.referenceId } }, signer);
    // Consumption is already durable inside this transaction; check expiry again
    // without consuming approval/calls twice. Canonical row/advisory locks remain held.
    const deadlines = [Date.parse(lease.expiresAt), source.expiresAt, relay.expiresAt];
    if (input.lease.budgetReservationId) {
      const [reservation] = await transaction.select().from(budgetReservations).where(and(
        eq(budgetReservations.accountId, binding.accountId), eq(budgetReservations.id, input.lease.budgetReservationId),
        eq(budgetReservations.leaseId, lease.leaseId), eq(budgetReservations.status, 'RESERVED'))).limit(1);
      if (!reservation) deny('BUDGET_AUTHORITY_UNAVAILABLE');
      deadlines.push(Date.parse(reservation.expiresAt));
    }
    if (input.lease.approvalRequestId) {
      const [approval] = await transaction.select().from(approvalRequests).where(and(
        eq(approvalRequests.accountId, binding.accountId), eq(approvalRequests.id, input.lease.approvalRequestId),
        eq(approvalRequests.status, 'APPROVED'), isNull(approvalRequests.revokedAt))).limit(1);
      if (!approval) deny('APPROVAL_AUTHORITY_UNAVAILABLE');
      deadlines.push(Date.parse(approval.expiresAt));
    }
    if (Math.min(...deadlines) <= Date.now()) deny('AUTHORITY_EXPIRED_BEFORE_COMMIT');
    // Slow host work must not turn an expired reference into a committed admission.
    assertPermitCurrent(source, heads.myeve, binding);
    assertPermitCurrent(relay, heads.relay, binding);
    return receipt;
  });
}

export interface NativeLifecycleHost extends NativeReceivingHost {
  backendSigner: PolicyKey;
  /** Fence/checkpoint native writers and read authenticated backend resource evidence
   * in the SAME transaction. Enqueue external stop requests; never make network calls
   * or equate a requested stop with completion. Include all native resources. */
  applyControl(transaction: RelayDatabase, input: { fence: Fence; receipts: NativeAdmissionReceipt[] }): Promise<{
    inventoryComplete: boolean; resources: Array<{ resourceId: string; commandId: string;
      state: import('@/lib/v2/policy/lifecycle-wire').LifecycleState; evidenceDigest: string }>;
  }>;
}

/** Authenticated, targeted pause/revoke composition; delivery retry queries current
 * native evidence. No accounting reservation is released by control acknowledgment. */
export async function receiveNativeControl(envelope: SignedPolicyMessage, host: NativeLifecycleHost) {
  const { signLifecycleReceipt } = await import('@/lib/v2/policy/lifecycle-wire');
  const { capabilityLeases } = await import('@/lib/db/schema');
  const fence = await verifyPolicyMessage(envelope, host.enrollment.sourceKey);
  if (fence.kind !== 'FENCE' || fence.authority !== 'myeve' || !['pause', 'revoke'].includes(fence.operation)) deny('CONTROL_REQUIRED');
  for (const field of ['ownerId', 'organizationId', 'installationId', 'backendId', 'incarnation', 'enrollmentVersion'] as const)
    if (fence[field] !== host.enrollment[field]) deny('CONTROL_ENROLLMENT_MISMATCH');
  if (!['connected-apps', 'work'].includes(fence.capabilityId)) deny('CONTROL_CAPABILITY');
  return withTransaction(async transaction => {
    await lockActiveAccount(transaction, host.enrollment.accountId);
    const heads = await currentHeads(transaction, host);
    // Later policy may retain an earlier explicit control; ordinary disable is not revoke.
    const current = heads.myeve;
    const retained = current.controls?.some(control => control.version === fence.version
      && control.policyId === fence.policyId && control.capabilityId === fence.capabilityId && control.operation === fence.operation);
    if (await policyMessageHash(current) !== await policyMessageHash(fence) && !retained) deny('CONTROL_STALE');
    const rows = await transaction.select().from(controlOutbox).where(and(eq(controlOutbox.accountId, host.enrollment.accountId), eq(controlOutbox.aggregateType, 'native_admission_receipt')));
    const receipts = rows.map(row => row.payload as NativeAdmissionReceipt).filter(receipt =>
      receipt.binding.ownerId === fence.ownerId && receipt.binding.organizationId === fence.organizationId
      && receipt.binding.installationId === fence.installationId && receipt.backendId === fence.backendId
      && receipt.incarnation === fence.incarnation && receipt.enrollmentVersion === fence.enrollmentVersion
      && receipt.sourcePolicyVersion < fence.version);
    if (fence.operation === 'revoke') for (const receipt of receipts)
      await transaction.update(capabilityLeases).set({ status: 'REVOKED', revokedAt: now() })
        .where(and(eq(capabilityLeases.accountId, host.enrollment.accountId), eq(capabilityLeases.id, receipt.leaseId)));
    const inventory = await host.applyControl(transaction, { fence, receipts });
    const commands = new Set(receipts.map(receipt => receipt.commandId));
    const resources = z.array(z.object({ resourceId: identity, commandId: identity,
      state: z.enum(['PENDING_BACKEND', 'PAUSE_CONFIRMED', 'AUTHORITY_FENCED', 'STOP_CONFIRMED', 'CLEANUP_CONFIRMED', 'STOP_FAILED', 'STOP_UNKNOWN']),
      evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict()).max(10_000).parse(inventory.resources).sort((a, b) => a.resourceId.localeCompare(b.resourceId));
    if (new Set(resources.map(resource => resource.resourceId)).size !== resources.length
      || resources.some(resource => !commands.has(resource.commandId))) deny('CONTROL_INVENTORY');
    const complete = inventory.inventoryComplete === true && receipts.every(receipt => resources.some(resource => resource.commandId === receipt.commandId));
    const states = resources.map(resource => resource.state);
    const state = !complete ? 'PENDING_BACKEND'
      : states.includes('STOP_UNKNOWN') ? 'STOP_UNKNOWN'
      : states.includes('STOP_FAILED') ? 'STOP_FAILED'
      : fence.operation === 'pause' ? (states.every(value => value === 'PAUSE_CONFIRMED') ? 'PAUSE_CONFIRMED' : 'PENDING_BACKEND')
      : states.every(value => value === 'CLEANUP_CONFIRMED') ? 'CLEANUP_CONFIRMED'
      : states.every(value => ['STOP_CONFIRMED', 'CLEANUP_CONFIRMED'].includes(value)) ? 'STOP_CONFIRMED'
      : states.every(value => ['AUTHORITY_FENCED', 'STOP_CONFIRMED', 'CLEANUP_CONFIRMED'].includes(value)) ? 'AUTHORITY_FENCED' : 'PENDING_BACKEND';
    const key = `native-control:${await policyMessageHash(fence)}`;
    const [prior] = await transaction.select().from(controlOutbox).where(and(eq(controlOutbox.accountId, host.enrollment.accountId), eq(controlOutbox.idempotencyKey, key))).limit(1);
    const old = prior?.payload as import('@/lib/v2/policy/lifecycle-wire').SignedLifecycleReceipt | undefined;
    const previous = old ? JSON.parse(old.message) as import('@/lib/v2/policy/lifecycle-wire').LifecycleReceipt : undefined;
    const inventoryDigest = await admissionActionDigest(resources);
    const evidenceDigest = await admissionActionDigest({ fenceHash: await policyMessageHash(fence), resources });
    if (previous && previous.state === state && previous.inventoryComplete === complete && previous.inventoryDigest === inventoryDigest) return old!;
    const acknowledgment = await signLifecycleReceipt({ schema: 'capability-control.lifecycle.v1', kind: 'CONTROL_ACK', authority: 'myeve',
      ownerId: fence.ownerId, organizationId: fence.organizationId, installationId: fence.installationId,
      backendId: fence.backendId, incarnation: fence.incarnation, enrollmentVersion: fence.enrollmentVersion,
      version: fence.version, policyId: fence.policyId, capabilityId: fence.capabilityId, operation: fence.operation as 'pause' | 'revoke',
      sequence: (previous?.sequence ?? 0) + 1, state, observedAt: Date.now(), evidenceDigest, inventoryDigest, inventoryComplete: complete,
    }, host.backendSigner);
    await transaction.insert(controlOutbox).values({ id: id('obx'), accountId: host.enrollment.accountId,
      aggregateType: 'native_control_evidence', aggregateId: fence.policyId, type: 'native.control.evidence',
      payload: acknowledgment, idempotencyKey: `${key}:sequence:${(previous?.sequence ?? 0) + 1}`, publishedAt: now() });
    if (prior) await transaction.update(controlOutbox).set({ payload: acknowledgment }).where(eq(controlOutbox.id, prior.id));
    else await transaction.insert(controlOutbox).values({ id: id('obx'), accountId: host.enrollment.accountId,
      aggregateType: 'native_control_receipt', aggregateId: fence.policyId, type: 'native.control.ack',
      payload: acknowledgment, idempotencyKey: key, publishedAt: now() });
    return acknowledgment;
  });
}
