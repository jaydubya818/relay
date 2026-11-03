import { afterEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, withTransaction } from '@/lib/db';
import { budgetReservations, capabilityLeases, controlOutbox, leaseCallReceipts } from '@/lib/db/schema';
import { cleanupDatabase } from '../helpers';
import { createApprovalRequest, decideApproval } from '@/lib/v2/approvals';
import { lockActiveAccount } from '@/lib/account-fence';
import { canonicalHash } from '@/lib/v2/contracts';
import { verifyLifecycleReceipt } from '@/lib/v2/policy/lifecycle-wire';
import { admissionActionDigest, policyMessageHash, signPolicyMessage } from '@/lib/v2/policy/ordering-wire';
import { admitNativeCommand, receiveNativeControl, nativeAdmissionActionMaterial, type NativeLifecycleHost } from '@/lib/v2/native-admission';

import { setup } from './native-fixture';

describe('canonical native receiving transaction (real PostgreSQL, synthetic enrollment)', () => {
  afterEach(async () => { delete process.env.RELAY_CAPABILITY_COORDINATION_JSON; delete process.env.RELAY_CAPABILITY_ENVIRONMENT; await cleanupDatabase(); });
  it('durably composes policy, identity, budget, online call debit and duplicate-safe command', async () => {
    const f = await setup();
    const results = await Promise.all([admitNativeCommand(f.input, f.host, f.signer, f.resolver), admitNativeCommand(f.input, f.host, f.signer, f.resolver)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].schemaVersion).toBe('relay.native-admission.v1');
    expect(await db().select().from(leaseCallReceipts)).toHaveLength(1);
    expect(await db().select().from(capabilityLeases)).toHaveLength(1);
    expect((await db().select().from(budgetReservations))[0]).toMatchObject({ leaseId: results[0].leaseId, status: 'RESERVED' });
    expect(JSON.stringify((await db().select().from(controlOutbox)).filter(row => row.aggregateType === 'native_admission_receipt'))).not.toContain(f.input.lease.workloadIdentityToken);
  });
  it('rolls back lease, call debit, command and reservation binding on native commit failure', async () => {
    const f = await setup();
    const write = f.host.admitCommand;
    f.host.admitCommand = async (tx, input) => { await write(tx, input); throw Error('injected-before-commit'); };
    await expect(admitNativeCommand(f.input, f.host, f.signer, f.resolver)).rejects.toThrow('injected-before-commit');
    expect(await db().select().from(capabilityLeases)).toHaveLength(0);
    expect(await db().select().from(leaseCallReceipts)).toHaveLength(0);
    expect((await db().select().from(budgetReservations))[0]).toMatchObject({ leaseId: null, status: 'RESERVED' });
    expect(await db().select().from(controlOutbox).where(eq(controlOutbox.id, 'fixture_command'))).toHaveLength(0);
    f.host.admitCommand = write;
    await expect(admitNativeCommand(f.input, f.host, f.signer, f.resolver)).resolves.toHaveProperty('commandId');
  });
  it.each(['ownerId', 'installationId', 'agentId', 'connectionId', 'missionId', 'descriptorHash', 'argumentHash'] as const)('rejects substituted %s without consuming authority', async field => {
    const f = await setup();
    const binding = { ...f.binding, [field]: field.endsWith('Hash') ? canonicalHash('substitution') : 'substitution' };
    await expect(admitNativeCommand({ ...f.input, binding }, f.host, f.signer, f.resolver)).rejects.toBeDefined();
    expect(await db().select().from(capabilityLeases)).toHaveLength(0);
  });
  it('rejects changed connection authority, unavailable witness, and receiver restore behind independent head', async () => {
    const f = await setup();
    f.host.resolveBinding = async () => ({ binding: { ...f.binding, connectionAuthorityVersion: 2 }, descriptor: { tool: 'fixture', version: 1 } });
    await expect(admitNativeCommand(f.input, f.host, f.signer, f.resolver)).rejects.toThrow('NATIVE_BINDING_CHANGED');
    f.host.resolveBinding = async () => ({ binding: f.binding, descriptor: { tool: 'fixture', version: 1 } });
    f.host.readTrustedPolicyHeads = async () => { throw Error('witness-unavailable'); };
    await expect(admitNativeCommand(f.input, f.host, f.signer, f.resolver)).rejects.toThrow('witness-unavailable');
    const revoked = await signPolicyMessage({ ...f.sourceHead, version: 2, policyId: 'revoked-2', operation: 'revoke' }, f.sourceKey);
    f.host.readTrustedPolicyHeads = async () => ({ ...f.heads, myeve: revoked });
    await expect(admitNativeCommand(f.input, f.host, f.signer, f.resolver)).rejects.toThrow('RESTORE_OR_STALE_POLICY');
  });
  it('authenticates receipt replays and rejects a reused key with different lease material', async () => {
    const f = await setup();
    await admitNativeCommand(f.input, f.host, f.signer, f.resolver);
    await expect(admitNativeCommand({ ...f.input, lease: { ...f.input.lease, workloadIdentityToken: 'forged' } }, f.host, f.signer, f.resolver)).rejects.toBeDefined();
    await expect(admitNativeCommand({ ...f.input, lease: { ...f.input.lease, ttlSeconds: 1 } }, f.host, f.signer, f.resolver)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('rejects a newer disabled policy before admission while preserving committed receipt and UNKNOWN reservation', async () => {
    const f = await setup();
    const receipt = await admitNativeCommand(f.input, f.host, f.signer, f.resolver);
    const disabled = await signPolicyMessage({ ...f.sourceHead, version: 2, policyId: 'disabled-2', operation: 'disable' }, f.sourceKey);
    const heads = { ...f.heads, myeve: disabled };
    await db().update(controlOutbox).set({ payload: heads }).where(eq(controlOutbox.id, 'fixture_heads'));
    f.host.readTrustedPolicyHeads = async () => heads;
    await expect(admitNativeCommand({ ...f.input, idempotencyKey: 'new-attempt' }, f.host, f.signer, f.resolver)).rejects.toThrow('POLICY_IDENTITY');
    await db().update(budgetReservations).set({ status: 'UNKNOWN' }).where(and(eq(budgetReservations.accountId, f.accountId), eq(budgetReservations.id, f.reservation.reservationId)));
    expect(await admitNativeCommand(f.input, f.host, f.signer, f.resolver)).toEqual(receipt);
    expect((await db().select().from(budgetReservations))[0]!.status).toBe('UNKNOWN');
  });
  it('fences exhausted admitted leases, preserves UNKNOWN and reports cleanup only from complete authenticated host inventory', async () => {
    const f = await setup();
    const receipt = await admitNativeCommand(f.input, f.host, f.signer, f.resolver);
    const fence = { ...f.sourceHead, version: 2, policyId: 'revoke-native-2', operation: 'revoke' as const };
    const envelope = await signPolicyMessage(fence, f.sourceKey);
    const heads = { ...f.heads, myeve: envelope };
    await db().update(controlOutbox).set({ payload: heads }).where(eq(controlOutbox.id, 'fixture_heads'));
    f.host.readTrustedPolicyHeads = async () => heads;
    let state: 'AUTHORITY_FENCED' | 'STOP_UNKNOWN' | 'CLEANUP_CONFIRMED' = 'AUTHORITY_FENCED';
    let inventoryComplete = true;
    const host: NativeLifecycleHost = { ...f.host, backendSigner: f.backendKey,
      applyControl: async () => ({ inventoryComplete, resources: [{ resourceId: 'fixture-resource', commandId: receipt.commandId, state, evidenceDigest: 'a'.repeat(64) }] }) };
    const fenced = await receiveNativeControl(envelope, host);
    expect(await verifyLifecycleReceipt(fenced, f.backendKey)).toMatchObject({ state: 'AUTHORITY_FENCED', sequence: 1 });
    expect(await receiveNativeControl(envelope, host)).toEqual(fenced);
    expect((await db().select().from(capabilityLeases))[0]).toMatchObject({ status: 'REVOKED' });
    await db().update(budgetReservations).set({ status: 'UNKNOWN' }).where(eq(budgetReservations.id, f.reservation.reservationId));
    state = 'STOP_UNKNOWN';
    expect(await verifyLifecycleReceipt(await receiveNativeControl(envelope, host), f.backendKey)).toMatchObject({ state: 'STOP_UNKNOWN', sequence: 2 });
    state = 'CLEANUP_CONFIRMED'; inventoryComplete = false;
    expect(await verifyLifecycleReceipt(await receiveNativeControl(envelope, host), f.backendKey)).toMatchObject({ state: 'PENDING_BACKEND', inventoryComplete: false });
    inventoryComplete = true;
    expect(await verifyLifecycleReceipt(await receiveNativeControl(envelope, host), f.backendKey)).toMatchObject({ state: 'CLEANUP_CONFIRMED', inventoryComplete: true });
    expect((await db().select().from(budgetReservations))[0]!.status).toBe('UNKNOWN');
    await expect(receiveNativeControl({ ...envelope, signature: 'forged' }, host)).rejects.toBeDefined();
  });

  it('requires exact canonical owner approval and atomically consumes it with native admission', async () => {
    const f = await setup(true);
    await expect(admitNativeCommand(f.input, f.host, f.signer, f.resolver)).rejects.toThrow('Approval is required');
    const request = await createApprovalRequest({ accountId: f.accountId, action: f.input.lease.action,
      policyDecisionId: f.decision.decisionId, approvalClass: 'native-read', summary: 'Synthetic read',
      consequence: 'Read fixture only', displayEvidence: {}, assignedPrincipalIds: [f.principalId],
      expiresAt: new Date(Date.now() + 60_000).toISOString() }, f.signer);
    await decideApproval({ accountId: f.accountId, requestId: request.requestId, principalId: f.principalId,
      decision: 'APPROVE', scope: { kind: 'once', actionHash: f.input.lease.action.canonicalHash },
      authenticationEvidence: { sessionId: 'ses_nativefixture', method: 'password', authenticatedAt: new Date().toISOString() } }, f.signer);
    const input = { ...f.input, lease: { ...f.input.lease, approvalRequestId: request.requestId } };
    await expect(admitNativeCommand(input, f.host, f.signer, f.resolver)).resolves.toHaveProperty('commandId');
    expect((await db().select().from(capabilityLeases))[0]!.approvalDecisionId).toBeTruthy();
  });
  it('serializes concurrent disable and admission and denies every subsequent new admission', async () => {
    const f = await setup();
    const disabled = await signPolicyMessage({ ...f.sourceHead, version: 2, policyId: 'concurrent-disable', operation: 'disable' }, f.sourceKey);
    let trusted = f.heads;
    f.host.readTrustedPolicyHeads = async () => trusted;
    const results = await Promise.allSettled([
      admitNativeCommand(f.input, f.host, f.signer, f.resolver),
      withTransaction(async tx => { await lockActiveAccount(tx, f.accountId);
        trusted = { ...f.heads, myeve: disabled };
        await tx.update(controlOutbox).set({ payload: trusted }).where(eq(controlOutbox.id, 'fixture_heads'));
      }),
    ]);
    expect(results[1]!.status).toBe('fulfilled');
    expect((await db().select().from(leaseCallReceipts)).length).toBeLessThanOrEqual(1);
    await expect(admitNativeCommand({ ...f.input, idempotencyKey: 'after-disable' }, f.host, f.signer, f.resolver)).rejects.toBeDefined();
  });

  it('keeps pause pending until every native resource confirms a safe checkpoint', async () => {
    const f = await setup();
    const receipt = await admitNativeCommand(f.input, f.host, f.signer, f.resolver);
    const fence = { ...f.sourceHead, version: 2, policyId: 'pause-native-2', operation: 'pause' as const };
    const envelope = await signPolicyMessage(fence, f.sourceKey);
    const heads = { ...f.heads, myeve: envelope };
    await db().update(controlOutbox).set({ payload: heads }).where(eq(controlOutbox.id, 'fixture_heads'));
    f.host.readTrustedPolicyHeads = async () => heads;
    let state: 'PENDING_BACKEND' | 'PAUSE_CONFIRMED' = 'PENDING_BACKEND';
    const host: NativeLifecycleHost = { ...f.host, backendSigner: f.backendKey,
      applyControl: async () => ({ inventoryComplete: true, resources: [{ resourceId: 'pause-resource', commandId: receipt.commandId, state, evidenceDigest: 'b'.repeat(64) }] }) };
    expect(await verifyLifecycleReceipt(await receiveNativeControl(envelope, host), f.backendKey)).toMatchObject({ state: 'PENDING_BACKEND' });
    state = 'PAUSE_CONFIRMED';
    expect(await verifyLifecycleReceipt(await receiveNativeControl(envelope, host), f.backendKey)).toMatchObject({ state: 'PAUSE_CONFIRMED', sequence: 2 });
    expect((await db().select().from(capabilityLeases))[0]!.revokedAt).toBeNull();
    expect(await db().select().from(controlOutbox).where(eq(controlOutbox.aggregateType, 'native_control_evidence'))).toHaveLength(2);
    const otherOwner = await signPolicyMessage({ ...fence, ownerId: 'other-owner' }, f.sourceKey);
    await expect(receiveNativeControl(otherOwner, host)).rejects.toThrow('CONTROL_ENROLLMENT_MISMATCH');
  });

  it.each(['arguments', 'descriptor', 'target'] as const)('rejects valid signed source proof for mismatched actual %s', async mismatch => {
    const f = await setup();
    const action = structuredClone(f.input.lease.action);
    if (mismatch === 'arguments') action.parameters.target = 'different-actual-argument';
    if (mismatch === 'target') action.resource.ids = [f.binding.connectionId, 'different-actual-target'];
    if (mismatch === 'descriptor') f.host.resolveBinding = async (_tx, requested, parsedAction) => {
      expect(parsedAction).toEqual(action);
      return { binding: requested, descriptor: { tool: 'different-actual-tool', version: 1 } };
    };
    const oldPermit = JSON.parse(f.input.source.message);
    const source = await signPolicyMessage({ ...oldPermit,
      actionDigest: await admissionActionDigest(nativeAdmissionActionMaterial(f.binding, action)) }, f.sourceKey);
    action.parameters.capabilityAdmissionDigest = await policyMessageHash(JSON.parse(source.message));
    action.canonicalHash = canonicalHash({ capability: action.capability, resource: action.resource, parameters: action.parameters });
    await expect(admitNativeCommand({ ...f.input, source, lease: { ...f.input.lease, action } }, f.host, f.signer, f.resolver)).rejects.toThrow('EXECUTION_MATERIAL_MISMATCH');
    expect(await db().select().from(capabilityLeases)).toHaveLength(0);
  });

  it('rolls back if a short reservation expires during native host work before commit', async () => {
    const f = await setup();
    await db().update(budgetReservations).set({ expiresAt: new Date(Date.now() + 1000).toISOString() })
      .where(eq(budgetReservations.id, f.reservation.reservationId));
    const write = f.host.admitCommand;
    let hostReached = false;
    f.host.admitCommand = async (tx, input) => { hostReached = true; const result = await write(tx, input);
      await new Promise(resolve => setTimeout(resolve, 1200)); return result; };
    await expect(admitNativeCommand(f.input, f.host, f.signer, f.resolver)).rejects.toThrow('AUTHORITY_EXPIRED_BEFORE_COMMIT');
    expect(hostReached).toBe(true);
    expect(await db().select().from(capabilityLeases)).toHaveLength(0);
    expect(await db().select().from(leaseCallReceipts)).toHaveLength(0);
    expect((await db().select().from(budgetReservations))[0]!.leaseId).toBeNull();
    expect(await db().select().from(controlOutbox).where(eq(controlOutbox.id, 'fixture_command'))).toHaveLength(0);
  });

  it('does not turn zero-cost read qualification into monetary execution authority', async () => {
    const f = await setup();
    const monetary = await signPolicyMessage({ ...JSON.parse(f.input.source.message), budgetMicros: 1 }, f.sourceKey);
    await expect(admitNativeCommand({ ...f.input, source: monetary }, f.host, f.signer, f.resolver)).rejects.toThrow('MONETARY_MAPPING_UNQUALIFIED');
    await db().update(budgetReservations).set({ dimension: 'MODEL_SPEND', currency: 'USD' })
      .where(eq(budgetReservations.id, f.reservation.reservationId));
    await expect(admitNativeCommand(f.input, f.host, f.signer, f.resolver)).rejects.toThrow('MONETARY_MAPPING_UNQUALIFIED');
    expect(await db().select().from(capabilityLeases)).toHaveLength(0);
  });

});
