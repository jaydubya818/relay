import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, withTransaction } from '@/lib/db';
import { accounts, approvalRequests, budgetReservations, capabilityLeases, controlOutbox, taskCommands, v2Events, v2Tasks } from '@/lib/db/schema';
import { admitNativeCommand, receiveNativeControl } from '@/lib/v2/native-admission';
import { createNativeReceiver } from '@/lib/v2/native-receiving';
import { signPolicyMessage } from '@/lib/v2/policy/ordering-wire';
import { verifyLifecycleReceipt } from '@/lib/v2/policy/lifecycle-wire';
import { createApprovalRequest, decideApproval } from '@/lib/v2/approvals';
import { cleanupDatabase } from '../helpers';
import { markTaskCommandEffectState, failTaskCommand } from '@/lib/v2/orchestration';

import { receiverFixture } from './native-receiving-fixture';

describe('durable native receiver and worker (isolated PostgreSQL; synthetic provider)', () => {
  afterEach(async () => { delete process.env.RELAY_CAPABILITY_COORDINATION_JSON; delete process.env.RELAY_CAPABILITY_ENVIRONMENT; await cleanupDatabase(); });
  it('commits one authenticated admission and dispatch under concurrent retries and controller restart', async () => {
    const f = await receiverFixture();
    const receipts = await Promise.all([f.admit(), f.admit()]);
    expect(receipts[0]).toEqual(receipts[1]);
    const receiver = createNativeReceiver(f.options);
    await Promise.all([receiver.execute(receipts[0]!.commandId, 'worker-a'), receiver.execute(receipts[0]!.commandId, 'worker-b')]);
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(await receiver.read(receipts[0]!.commandId)).toMatchObject({ outcome: 'SUCCEEDED' });
    expect(await f.admit()).toEqual(receipts[0]);
    expect((await db().select().from(capabilityLeases))[0]).toMatchObject({ callCount: 1, status: 'EXHAUSTED' });
    expect((await db().select().from(budgetReservations))[0]).toMatchObject({ status: 'RESERVED' });
  });
  it('preserves admitted Work across disable while denying new admission', async () => {
    const f = await receiverFixture(); const receipt = await f.admit();
    await f.policy('disable');
    await expect(admitNativeCommand({ ...f.input, idempotencyKey: 'new-work' }, f.receiver.host, f.signer, f.resolver)).rejects.toBeDefined();
    expect(await f.receiver.execute(receipt.commandId, 'worker')).toMatchObject({ outcome: 'SUCCEEDED' });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it.each(['pause', 'revoke'] as const)('fences undispatched Work on %s with truthful no-resource confirmation', async operation => {
    const f = await receiverFixture(); const receipt = await f.admit(); const control = await f.policy(operation);
    const ack = await receiveNativeControl(control, f.receiver.host);
    expect(await verifyLifecycleReceipt(ack, f.backendKey)).toMatchObject({ state: operation === 'pause' ? 'PAUSE_CONFIRMED' : 'CLEANUP_CONFIRMED' });
    expect(await receiveNativeControl(control, f.receiver.host)).toEqual(ack);
    expect(await f.receiver.execute(receipt.commandId, 'worker')).toMatchObject({ outcome: 'NOT_DISPATCHED', control: operation });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('reports pending resources until signed stop and cleanup evidence; preserves UNKNOWN accounting', async () => {
    const f = await receiverFixture(); const receipt = await f.admit();
    await f.receiver.execute(receipt.commandId, 'worker');
    await db().update(budgetReservations).set({ status: 'UNKNOWN' }).where(eq(budgetReservations.id, f.reservation.reservationId));
    const revoke = await f.policy('revoke');
    expect(await verifyLifecycleReceipt(await receiveNativeControl(revoke, f.receiver.host), f.backendKey)).toMatchObject({ state: 'PENDING_BACKEND' });
    const stop = await f.evidence(receipt.commandId, 'STOP_CONFIRMED', 1);
    await expect(f.receiver.resourceEvidence({ ...stop, signature: 'forged' })).rejects.toBeDefined();
    await f.receiver.resourceEvidence(stop);
    expect(await verifyLifecycleReceipt(await receiveNativeControl(revoke, f.receiver.host), f.backendKey)).toMatchObject({ state: 'STOP_CONFIRMED' });
    await expect(f.receiver.resourceEvidence(await f.evidence(receipt.commandId, 'STOP_UNKNOWN', 2))).rejects.toThrow('REGRESSION');
    const cleanup = await f.evidence(receipt.commandId, 'CLEANUP_CONFIRMED', 2);
    await f.receiver.resourceEvidence(cleanup);
    await f.receiver.resourceEvidence(cleanup);
    expect(await verifyLifecycleReceipt(await receiveNativeControl(revoke, f.receiver.host), f.backendKey)).toMatchObject({ state: 'CLEANUP_CONFIRMED' });
    expect((await db().select().from(budgetReservations))[0]!.status).toBe('UNKNOWN');
  });
  it('recovers a crash after committed dispatch intent without redispatch or budget release', async () => {
    const f = await receiverFixture(); const receipt = await f.admit();
    const [command] = await db().select().from(taskCommands);
    await db().update(taskCommands).set({ status: 'PROCESSING', effectState: 'POSSIBLY_COMMITTED', fenceToken: 1,
      workerId: 'dead-worker', leaseUntil: new Date(Date.now() - 1000).toISOString(), payload: { ...command!.payload as object, dispatchFence: 1 } }).where(eq(taskCommands.id, receipt.commandId));
    const restarted = createNativeReceiver(f.options);
    expect(await restarted.recover(receipt.commandId)).toMatchObject({ redispatch: false, accounting: 'PRESERVE_UNKNOWN' });
    expect(await restarted.execute(receipt.commandId, 'replacement')).toMatchObject({ outcome: 'UNKNOWN' });
    expect(f.execute).not.toHaveBeenCalled();
    expect((await db().select().from(budgetReservations))[0]!.status).toBe('RESERVED');
  });
  it('contains provider failure and never replays an ambiguous external call', async () => {
    const f = await receiverFixture(); const receipt = await f.admit();
    f.execute.mockRejectedValueOnce(Error('private-provider-body'));
    expect(await f.receiver.execute(receipt.commandId, 'worker')).toMatchObject({ outcome: 'UNKNOWN' });
    expect(await f.receiver.execute(receipt.commandId, 'retry')).toMatchObject({ outcome: 'UNKNOWN' });
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await db().select().from(controlOutbox))).not.toContain('private-provider-body');
  });
  it.each(['descriptor', 'connection', 'task', 'policy', 'witness'] as const)('blocks dispatch when %s no longer matches admission', async mutation => {
    const f = await receiverFixture(); const receipt = await f.admit();
    if (mutation === 'descriptor') f.changeDescriptor();
    if (mutation === 'connection') f.revokeConnection();
    if (mutation === 'task') await db().update(v2Tasks).set({ status: 'CANCELLED' }).where(eq(v2Tasks.id, f.binding.taskId));
    if (mutation === 'policy') await f.policy('revoke');
    if (mutation === 'witness') f.heads.myeve = await signPolicyMessage({ ...f.sourceHead, version: 2, policyId: 'restore-revoked', operation: 'revoke' }, f.sourceKey);
    await expect(f.receiver.execute(receipt.commandId, 'worker')).rejects.toBeDefined();
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('rejects unsigned or cross-owner Work provenance before consuming lease authority', async () => {
    const f = await receiverFixture();
    await db().update(v2Events).set({ signatureStatus: 'UNVERIFIED' });
    await expect(f.admit()).rejects.toThrow('WORK_UNAVAILABLE');
    await db().update(v2Events).set({ signatureStatus: 'VERIFIED', data: { nativeWork: { ownerId: 'another-owner' } } });
    await expect(f.admit()).rejects.toBeDefined();
    expect(await db().select().from(capabilityLeases)).toHaveLength(0);
  });
  it('denies stale delivery, mutated same-version identity and another installation', async () => {
    const f = await receiverFixture(); const initial = f.heads.myeve;
    await f.policy('revoke');
    await expect(f.receiver.receivePolicy(initial)).rejects.toThrow('WITNESS');
    const mutated = await signPolicyMessage({ ...f.sourceHead, version: 2, policyId: 'substituted', operation: 'enable' }, f.sourceKey);
    f.heads.myeve = mutated;
    await expect(f.receiver.receivePolicy(mutated)).rejects.toThrow('REGRESSION');
    const other = await signPolicyMessage({ ...f.sourceHead, installationId: 'another-installation' }, f.sourceKey);
    await expect(f.receiver.receivePolicy(other)).rejects.toThrow('ENROLLMENT');
  });
  it('rechecks consumed approval before dispatch without consuming it twice', async () => {
    const f = await receiverFixture(true);
    const request = await createApprovalRequest({ accountId: f.accountId, action: f.input.lease.action,
      policyDecisionId: f.decision.decisionId, approvalClass: 'native-read', summary: 'read fixture', consequence: 'read fixture',
      displayEvidence: {}, assignedPrincipalIds: [f.principalId], expiresAt: new Date(Date.now() + 60_000).toISOString() }, f.signer);
    await decideApproval({ accountId: f.accountId, requestId: request.requestId, principalId: f.principalId,
      decision: 'APPROVE', scope: { kind: 'once', actionHash: f.input.lease.action.canonicalHash },
      authenticationEvidence: { sessionId: 'test', method: 'password', authenticatedAt: new Date().toISOString() } }, f.signer);
    const receipt = await admitNativeCommand({ ...f.input, lease: { ...f.input.lease, approvalRequestId: request.requestId } }, f.receiver.host, f.signer, f.resolver);
    await db().update(approvalRequests).set({ status: 'REVOKED', revokedAt: new Date().toISOString() }).where(eq(approvalRequests.id, request.requestId));
    await expect(f.receiver.execute(receipt.commandId, 'worker')).rejects.toThrow('APPROVAL_REVOKED');
    expect((await db().select().from(approvalRequests))[0]!.useCount).toBe(1);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('quarantines same-policy database restore behind independently advanced dispatch watermark', async () => {
    const f = await receiverFixture(); const receipt = await f.admit();
    const [snapshot] = await db().select().from(taskCommands);
    await f.receiver.execute(receipt.commandId, 'worker');
    // Restore the pre-dispatch database image: command and watermark, unchanged policy.
    await db().update(taskCommands).set(snapshot!).where(eq(taskCommands.id, receipt.commandId));
    await db().delete(controlOutbox).where(eq(controlOutbox.aggregateType, 'native_recovery_watermark'));
    await expect(createNativeReceiver(f.options).execute(receipt.commandId, 'after-restore')).rejects.toThrow('RESTORE_QUARANTINE');
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it('bounds an unresponsive provider, discards late output and allows revocation without claiming stop', async () => {
    const f = await receiverFixture(); const receipt = await f.admit();
    let finish!: (value: { state: string; data: { fixture: boolean } }) => void;
    f.execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const receiver = createNativeReceiver({ ...f.options, dispatchTimeoutMs: 20 });
    expect(await receiver.execute(receipt.commandId, 'worker')).toMatchObject({ outcome: 'UNKNOWN' });
    const revoke = await f.policy('revoke');
    expect(await verifyLifecycleReceipt(await receiveNativeControl(revoke, receiver.host), f.backendKey)).toMatchObject({ state: 'STOP_UNKNOWN' });
    finish({ state: 'SUCCEEDED', data: { fixture: true } });
    await Promise.resolve();
    expect(await receiver.read(receipt.commandId)).toMatchObject({ outcome: 'UNKNOWN' });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it('rejects legacy START_TASK writer calls for a native worker claim', async () => {
    const f = await receiverFixture(); const receipt = await f.admit();
    await db().update(taskCommands).set({ status: 'PROCESSING', effectState: 'POSSIBLY_COMMITTED',
      fenceToken: 1, workerId: 'native-worker', leaseUntil: new Date(Date.now() + 30_000).toISOString() });
    const claim = { accountId: f.accountId, commandId: receipt.commandId, workerId: 'native-worker', fenceToken: 1 };
    await expect(markTaskCommandEffectState({ ...claim, effectState: 'PRE_EFFECT' })).rejects.toBeDefined();
    await expect(failTaskCommand({ ...claim, classification: 'PRE_EFFECT_RETRYABLE' }, f.signer)).rejects.toBeDefined();
    expect((await db().select().from(taskCommands))[0]!.effectState).toBe('POSSIBLY_COMMITTED');
  });
  it('keeps authenticated cleanup delivery possible after retirement while rejecting dispatch', async () => {
    const f = await receiverFixture(); const receipt = await f.admit();
    await f.receiver.execute(receipt.commandId, 'worker');
    await db().update(accounts).set({ retiredAt: new Date().toISOString() }).where(eq(accounts.id, f.accountId));
    const revoke = await f.policy('revoke');
    await receiveNativeControl(revoke, f.receiver.host);
    await f.receiver.resourceEvidence(await f.evidence(receipt.commandId, 'CLEANUP_CONFIRMED', 1));
    expect(await verifyLifecycleReceipt(await receiveNativeControl(revoke, f.receiver.host), f.backendKey)).toMatchObject({ state: 'CLEANUP_CONFIRMED' });
    await expect(f.admit()).rejects.toBeDefined();
    expect(f.execute).toHaveBeenCalledTimes(1);
  });

  it.each(['policy', 'recovery', 'metadata'] as const)('bounds stalled %s preflight without giving adapters a transaction handle', async port => {
    const f = await receiverFixture(); const receipt = await f.admit();
    const options = { ...f.options, dispatchTimeoutMs: 50 };
    if (port === 'policy') options.witness = { read: () => new Promise(() => {}) };
    if (port === 'recovery') options.recoveryWitness = { ...options.recoveryWitness, read: () => new Promise(() => {}) };
    if (port === 'metadata') options.provider = { ...options.provider, connectionQuery: () => sql`SELECT pg_sleep(1)` };
    await expect(createNativeReceiver(options).execute(receipt.commandId, 'worker')).rejects.toBeDefined();
    expect(f.execute).not.toHaveBeenCalled();
    const revoke = await f.policy('revoke');
    expect(await verifyLifecycleReceipt(await receiveNativeControl(revoke, f.receiver.host), f.backendKey)).toMatchObject({ state: 'CLEANUP_CONFIRMED' });
  });
  it('checks lease expiry after delayed metadata resolution before external dispatch', async () => {
    const f = await receiverFixture();
    const receipt = await f.admit();
    const [lease] = await db().select().from(capabilityLeases).where(eq(capabilityLeases.id, receipt.leaseId));
    const clock = vi.spyOn(Date, 'now');
    let resolutions = 0;
    const resolve = vi.fn(() => {
      const material = f.options.provider.resolve();
      // Binding resolution is followed by final provider resolution. Expire
      // only at that final boundary; PostgreSQL and timers remain real.
      if (++resolutions === 2) clock.mockReturnValue(Date.parse(lease!.expiresAt) + 1_000);
      return material;
    });
    try {
      const receiver = createNativeReceiver({ ...f.options, provider: { ...f.options.provider, resolve } });
      await expect(receiver.execute(receipt.commandId, 'worker')).rejects.toThrow('Lease is not currently valid.');
      expect(resolve).toHaveBeenCalledTimes(2);
      expect(f.execute).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });

  it.each(['resolver', 'signer'] as const)('bounds stalled %s and leaves revocation available', async port => {
    const f = await receiverFixture(); const receipt = await f.admit();
    const options = { ...f.options, dispatchTimeoutMs: 50 };
    if (port === 'resolver') options.resolver = { publicKeyForKeyId: () => new Promise(() => {}) };
    if (port === 'signer') options.signer = { ...options.signer, sign: () => new Promise(() => {}) };
    const receiver = createNativeReceiver(options);
    await expect(receiver.execute(receipt.commandId, 'worker')).rejects.toThrow('PORT_TIMEOUT');
    expect(f.execute).toHaveBeenCalledTimes(port === 'signer' ? 1 : 0);
    const revoke = await f.policy('revoke');
    expect(await verifyLifecycleReceipt(await receiveNativeControl(revoke, f.receiver.host), f.backendKey)).toMatchObject({ state: port === 'signer' ? 'PENDING_BACKEND' : 'CLEANUP_CONFIRMED' });
  });
  it('cancels a blocked task-row read before it indefinitely blocks control delivery', async () => {
    const f = await receiverFixture(); const receipt = await f.admit();
    let release!: () => void; let locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const blocker = withTransaction(async tx => { await tx.select().from(v2Tasks).for('update'); locked(); await hold; });
    await ready;
    try { await expect(createNativeReceiver({ ...f.options, dispatchTimeoutMs: 50 }).execute(receipt.commandId, 'worker')).rejects.toBeDefined(); }
    finally { release(); await blocker; }
    expect(f.execute).not.toHaveBeenCalled();
    const revoke = await f.policy('revoke');
    expect(await verifyLifecycleReceipt(await receiveNativeControl(revoke, f.receiver.host), f.backendKey)).toMatchObject({ state: 'CLEANUP_CONFIRMED' });
  });

});
