import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { lockActiveAccount, lockAccountDelivery } from '@/lib/account-fence';
import { withTransaction, type RelayDatabase } from '@/lib/db';
import { accountMemberships, agents, controlOutbox, eventRoutes, principals, taskCommands, v2Events, v2Tasks } from '@/lib/db/schema';
import { id, now } from '@/lib/ids';
import { canonicalHash, canonicalJson, type ActionIntent, type CapabilityLeaseClaims } from '@/lib/v2/contracts';
import { appendAuditRecordInTransaction } from '@/lib/v2/evidence/audit';
import { verifyAuditSignature, type AuditSigner } from '@/lib/v2/evidence/crypto';
import { revalidateAdmittedLease, type LeaseKeyResolver } from '@/lib/v2/leases';
import { admitNativeCommand, nativeWorkBindingSchema, type NativeAdmissionReceipt, type NativeLifecycleHost, type NativeWorkBinding } from '@/lib/v2/native-admission';
import { policyMessageHash, signPolicyMessage, verifyPolicyMessage, type Fence, type SignedPolicyMessage } from '@/lib/v2/policy/ordering-wire';

/** Structural consumer interface, implemented by the independently pinned consumer.
 * It resolves provider metadata in this transaction; it does not grant authority.
 * No caller-supplied object or HTTP body may construct this server-installed port. */
export interface NativeProviderPort {
  /** Reviewed SELECT only. The receiver owns query execution and cancellation;
   * adapters never retain a transaction handle or await remote metadata here. */
  connectionQuery(binding: NativeWorkBinding): SQL;
  resolve(rows: readonly Record<string, unknown>[], binding: NativeWorkBinding, action: ActionIntent): { descriptor: unknown; material: unknown };
  execute(input: { binding: NativeWorkBinding; action: ActionIntent; claims: CapabilityLeaseClaims; material: unknown; signal: AbortSignal }): Promise<unknown>;
  validateResult(input: { binding: NativeWorkBinding; action: ActionIntent; claims: CapabilityLeaseClaims; material: unknown }, result: unknown): unknown;
}
export type NativeReceiverOptions = {
  enrollment: NativeLifecycleHost['enrollment']; backendSigner: NativeLifecycleHost['backendSigner'];
  ownerPrincipalId: string; workSource: string; signer: AuditSigner; resolver: LeaseKeyResolver;
  witness: { read(signal: AbortSignal): Promise<{ myeve: SignedPolicyMessage; relay: SignedPolicyMessage }> };
  provider: NativeProviderPort;
  dispatchTimeoutMs?: number;
  /** One monotonic installation counter outside the receiver backup domain.
   * It contains no Work, authority, accounting, or execution ledger. CAS failure
   * quarantines dispatch; never reset it from a restored receiver database. */
  recoveryWitness: { read(signal: AbortSignal): Promise<number>; advance(expected: number, signal: AbortSignal): Promise<number> };
  resourceEvidenceKey: { keyId: string; publicKeyPem: string };
};
const kind = 'NATIVE_CAPABILITY_READ';
const workSchema = z.object({ ownerId: z.string(), organizationId: z.string(), installationId: z.string(),
  workId: z.string(), missionId: z.string(), workGeneration: z.number().int().positive() }).strict();
type CommandPayload = { binding: NativeWorkBinding; action: ActionIntent; leaseId: string; callId: string;
  requestHash: string; control?: 'pause' | 'revoke'; outcome?: 'SUCCEEDED' | 'UNKNOWN'; dispatchFence?: number };
function fail(code: string): never { throw Error(`NATIVE_RECEIVER_${code}`); }
const headKey = (options: NativeReceiverOptions, authority: 'myeve' | 'relay') =>
  `native-policy-head:${options.enrollment.backendId}:${authority}`;

export function createNativeReceiver(options: NativeReceiverOptions) {
  // Snapshot installation configuration. The witness/provider objects are installed
  // capabilities, not request input; public configuration never creates a grant.
  options = { ...options, enrollment: structuredClone(options.enrollment),
    backendSigner: structuredClone(options.backendSigner), resourceEvidenceKey: { ...options.resourceEvidenceKey } };
  const enrollment = options.enrollment;
  const ownerPrincipalId = options.ownerPrincipalId;
  const provider = options.provider;
  const dispatchTimeoutMs = z.number().int().min(1).max(30_000).parse(options.dispatchTimeoutMs ?? 10_000);
  async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, timeout = dispatchTimeoutMs): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([operation(controller.signal), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Error('NATIVE_RECEIVER_PORT_TIMEOUT')); }, timeout);
    })]); } finally { clearTimeout(timer); }
  }
  function boundedSigner(signer: AuditSigner): AuditSigner {
    return { ...signer,
      sign: value => bounded(() => signer.sign(value)), verify: (value, signature) => bounded(() => signer.verify(value, signature)),
      publicKeyPem: () => bounded(() => signer.publicKeyPem()),
      ...(signer.forPurpose ? { forPurpose: (purpose: Parameters<NonNullable<AuditSigner['forPurpose']>>[0]) => boundedSigner(signer.forPurpose!(purpose)) } : {}),
    };
  }
  const signer = boundedSigner(options.signer);
  const resolver: LeaseKeyResolver = {
    publicKeyForKeyId: key => bounded(() => options.resolver.publicKeyForKeyId(key)),
    ...(options.resolver.publicKeyForPurpose ? { publicKeyForPurpose: (key: string, purpose: 'lease' | 'session') =>
      bounded(() => options.resolver.publicKeyForPurpose!(key, purpose)) } : {}),
  };
  async function transactionDeadline(tx: RelayDatabase) {
    await tx.execute(sql`SELECT set_config('statement_timeout', ${String(dispatchTimeoutMs)}, true),
      set_config('lock_timeout', ${String(dispatchTimeoutMs)}, true)`);
  }
  async function resolveProvider(tx: RelayDatabase, binding: NativeWorkBinding, action: ActionIntent) {
    // PostgreSQL cancels this single statement before returning its connection.
    // The pure resolver receives rows only; no late adapter can access the tx.
    await transactionDeadline(tx);
    const result = await tx.execute(provider.connectionQuery(binding));
    return provider.resolve(result.rows, binding, action);
  }
  const recoveryKey = `native-recovery:${enrollment.backendId}:${enrollment.incarnation}`;
  async function recoveryFence(tx: RelayDatabase, advance = false) {
    const [row] = await tx.select().from(controlOutbox).where(and(eq(controlOutbox.accountId, enrollment.accountId),
      eq(controlOutbox.idempotencyKey, recoveryKey)));
    const local = row ? z.number().int().nonnegative().parse((row.payload as { sequence: unknown }).sequence) : 0;
    if (local !== await bounded(signal => options.recoveryWitness.read(signal))) fail('RESTORE_QUARANTINE');
    if (advance) {
      const sequence = await bounded(signal => options.recoveryWitness.advance(local, signal));
      if (!Number.isSafeInteger(sequence) || sequence !== local + 1) fail('RESTORE_QUARANTINE');
      // If commit fails after the independent CAS, the mismatch intentionally
      // quarantines all further dispatch until a separately qualified recovery.
      if (row) await tx.update(controlOutbox).set({ payload: { sequence } }).where(eq(controlOutbox.id, row.id));
      else await tx.insert(controlOutbox).values({ id: id('obx'), accountId: enrollment.accountId,
        aggregateType: 'native_recovery_watermark', aggregateId: enrollment.backendId, type: 'native.recovery.watermark',
        idempotencyKey: recoveryKey, payload: { sequence }, publishedAt: now() });
    }
  }
  const host: NativeLifecycleHost = {
    enrollment, backendSigner: options.backendSigner,
    readTrustedPolicyHeads: () => bounded(signal => options.witness.read(signal)),
    async readPolicyHeads(tx) {
      const read = async (authority: 'myeve' | 'relay') => {
        const [row] = await tx.select().from(controlOutbox).where(and(eq(controlOutbox.accountId, enrollment.accountId),
          eq(controlOutbox.idempotencyKey, headKey(options, authority)), eq(controlOutbox.aggregateType, 'native_policy_head'))).limit(1);
        if (!row || row.cancelledAt) fail('POLICY_UNAVAILABLE');
        return row.payload as SignedPolicyMessage;
      };
      return { myeve: await read('myeve'), relay: await read('relay') };
    },
    async resolveBinding(tx, requested, action) {
      const binding = nativeWorkBindingSchema.parse(requested);
      const [owner] = await tx.select({ id: principals.id }).from(principals)
        .innerJoin(accountMemberships, eq(accountMemberships.principalId, principals.id)).where(and(
          eq(principals.id, ownerPrincipalId), eq(principals.type, 'HUMAN'), eq(principals.status, 'ACTIVE'),
          eq(accountMemberships.accountId, enrollment.accountId), eq(accountMemberships.role, 'OWNER'), eq(accountMemberships.status, 'ACTIVE'))).limit(1).for('share');
      const [task] = await tx.select({ task: v2Tasks, event: v2Events, route: eventRoutes, agent: agents }).from(v2Tasks)
        .innerJoin(v2Events, and(eq(v2Events.id, v2Tasks.eventId), eq(v2Events.accountId, v2Tasks.accountId)))
        .innerJoin(eventRoutes, and(eq(eventRoutes.id, v2Tasks.routeId), eq(eventRoutes.accountId, v2Tasks.accountId)))
        .innerJoin(agents, and(eq(agents.id, v2Tasks.agentId), eq(agents.accountId, v2Tasks.accountId)))
        .where(and(eq(v2Tasks.accountId, enrollment.accountId), eq(v2Tasks.id, binding.taskId))).limit(1).for('share');
      if (!owner || !task || task.agent.id !== binding.agentId || task.agent.status !== 'ACTIVE'
        || task.route.createdByPrincipalId !== ownerPrincipalId || task.route.agentId !== binding.agentId
        || task.route.source !== task.event.source || task.route.eventType !== task.event.type || task.event.source !== options.workSource
        || task.event.signatureStatus !== 'VERIFIED' || task.event.schemaVersion !== 'relay.native-work.v1'
        || !['RUNNING', 'STARTING'].includes(task.task.status)) fail('WORK_UNAVAILABLE');
      const data = task.event.data as { nativeWork?: unknown } | null;
      const work = workSchema.parse(data?.nativeWork);
      for (const field of Object.keys(work) as Array<keyof typeof work>) if (work[field] !== binding[field]) fail('WORK_BINDING');
      // Resolve from canonical records; do not echo the caller's Work/owner lineage.
      const resolved = { ...binding, ...work, accountId: task.task.accountId, taskId: task.task.id, agentId: task.agent.id };
      const connection = await resolveProvider(tx, resolved, action);
      return { binding: resolved, descriptor: connection.descriptor };
    },
    async admitCommand(tx, input) {
      const commandId = id('cmd');
      const payload: CommandPayload = { ...input, callId: `native:${input.idempotencyKey}` };
      await tx.insert(taskCommands).values({ id: commandId, accountId: input.binding.accountId, taskId: input.binding.taskId,
        kind, idempotencyKey: `native:${input.idempotencyKey}`, payload });
      return { commandId };
    },
    async applyControl(tx, { fence, receipts }) {
      const resources = [];
      for (const receipt of receipts) {
        const [command] = await tx.select().from(taskCommands).where(and(eq(taskCommands.accountId, enrollment.accountId),
          eq(taskCommands.id, receipt.commandId), eq(taskCommands.kind, kind))).limit(1);
        if (!command) continue;
        const payload = command.payload as CommandPayload;
        // Control is monotone. A late pause never un-fences revoked authority.
        const control = payload.control === 'revoke' ? 'revoke' : fence.operation as 'pause' | 'revoke';
        if (payload.control !== control) await tx.update(taskCommands).set({
          payload: { ...payload, control }, fenceToken: command.fenceToken + 1,
          status: command.status === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED', workerId: null, leaseUntil: null, updatedAt: now(),
        }).where(eq(taskCommands.id, command.id));
        const [evidence] = await tx.select().from(controlOutbox).where(and(eq(controlOutbox.accountId, enrollment.accountId),
          eq(controlOutbox.idempotencyKey, `native-resource:${command.id}`))).limit(1);
        const confirmed = evidence?.payload as { evidence: ResourceEvidence } | undefined;
        const state = command.effectState === 'PRE_EFFECT'
          ? control === 'pause' ? 'PAUSE_CONFIRMED' as const : 'CLEANUP_CONFIRMED' as const
          : confirmed?.evidence.state ?? (payload.outcome === 'UNKNOWN' ? 'STOP_UNKNOWN' as const : 'PENDING_BACKEND' as const);
        resources.push({ resourceId: command.id, commandId: command.id, state,
          evidenceDigest: canonicalHash({ receipt: receipt.requestHash, control, state, evidence: confirmed ?? null }).slice(7) });
      }
      return { inventoryComplete: resources.length === receipts.length, resources };
    },
  };

  async function receivePolicy(envelope: SignedPolicyMessage) {
    const untrusted = JSON.parse(envelope.message) as Fence;
    if (!['myeve', 'relay'].includes(untrusted.authority)) fail('POLICY_AUTHORITY');
    const authority = untrusted.authority;
    const key = authority === 'myeve' ? enrollment.sourceKey : enrollment.relayKey;
    const fence = await verifyPolicyMessage(envelope, key);
    if (fence.kind !== 'FENCE' || fence.authority !== authority) fail('POLICY_KIND');
    for (const field of ['ownerId', 'organizationId', 'installationId', 'backendId', 'incarnation', 'enrollmentVersion'] as const)
      if (fence[field] !== enrollment[field]) fail('POLICY_ENROLLMENT');
    return withTransaction(async tx => {
      await transactionDeadline(tx);
      await lockAccountDelivery(tx, enrollment.accountId);
      const witnessed = await verifyPolicyMessage((await bounded(signal => options.witness.read(signal)))[authority], key);
      if (await policyMessageHash(witnessed) !== await policyMessageHash(fence)) fail('POLICY_WITNESS');
      const idempotencyKey = headKey(options, authority);
      const [prior] = await tx.select().from(controlOutbox).where(and(eq(controlOutbox.accountId, enrollment.accountId), eq(controlOutbox.idempotencyKey, idempotencyKey))).limit(1);
      if (prior) {
        const previous = await verifyPolicyMessage(prior.payload as SignedPolicyMessage, key);
        if (previous.version > fence.version || (previous.version === fence.version
          && await policyMessageHash(previous) !== await policyMessageHash(fence))) fail('POLICY_REGRESSION');
        await tx.update(controlOutbox).set({ payload: envelope }).where(eq(controlOutbox.id, prior.id));
      } else await tx.insert(controlOutbox).values({ id: id('obx'), accountId: enrollment.accountId,
        aggregateType: 'native_policy_head', aggregateId: enrollment.backendId, type: 'native.policy.head',
        idempotencyKey, payload: envelope, publishedAt: now() });
      const { kind: _kind, operation: _operation, capabilityId: _capability, controls: _controls, ...identity } = fence;
      void _kind; void _operation; void _capability; void _controls;
      return signPolicyMessage({ ...identity, kind: 'FENCE_ACK', fenceHash: await policyMessageHash(fence) }, options.backendSigner);
    });
  }

  async function commandRecord(tx: RelayDatabase, commandId: string) {
    await lockAccountDelivery(tx, enrollment.accountId);
    const [command] = await tx.select().from(taskCommands).where(and(eq(taskCommands.accountId, enrollment.accountId),
      eq(taskCommands.id, commandId), eq(taskCommands.kind, kind))).limit(1);
    if (!command) fail('COMMAND_UNAVAILABLE');
    const payload = command.payload as CommandPayload;
    const [receiptRow] = await tx.select().from(controlOutbox).where(and(eq(controlOutbox.accountId, enrollment.accountId),
      eq(controlOutbox.aggregateType, 'native_admission_receipt'), eq(controlOutbox.aggregateId, commandId))).limit(1);
    const receipt = receiptRow?.payload as NativeAdmissionReceipt | undefined;
    if (!receipt || receipt.requestHash !== payload.requestHash || receipt.leaseId !== payload.leaseId
      || receipt.bindingHash !== canonicalHash(payload.binding)) fail('RECEIPT_REQUIRED');
    for (const field of ['backendId', 'incarnation', 'enrollmentVersion'] as const)
      if (receipt[field] !== enrollment[field]) fail('RECEIPT_ENROLLMENT');
    return { command, payload, receipt };
  }
  async function validateDispatch(tx: RelayDatabase, payload: CommandPayload, receipt: NativeAdmissionReceipt) {
    await lockActiveAccount(tx, enrollment.accountId);
    await recoveryFence(tx);
    if (payload.control) fail('CONTROL_FENCED');
    await host.resolveBinding(tx, payload.binding, payload.action);
    // Verify exact current durable heads against a witness that survives restore.
    // Ordinary disable preserves this admitted call; explicit controls do not.
    const local = await host.readPolicyHeads(tx), witness = await host.readTrustedPolicyHeads();
    for (const authority of ['myeve', 'relay'] as const) {
      const key = authority === 'myeve' ? enrollment.sourceKey : enrollment.relayKey;
      const head = await verifyPolicyMessage(local[authority], key);
      if (await policyMessageHash(head) !== await policyMessageHash(await verifyPolicyMessage(witness[authority], key))) fail('RESTORE_OR_STALE_POLICY');
      if (head.kind !== 'FENCE') fail('POLICY_KIND');
      for (const field of ['ownerId', 'organizationId', 'installationId', 'backendId', 'incarnation', 'enrollmentVersion'] as const)
        if (head[field] !== enrollment[field]) fail('POLICY_ENROLLMENT');
      const admittedVersion = authority === 'myeve' ? receipt.sourcePolicyVersion : receipt.relayPolicyVersion;
      if (head.version < admittedVersion) fail('POLICY_REGRESSION');
      const controls = [...(head.controls ?? []), head];
      if (controls.some(c => ['work', payload.binding.capabilityId].includes(c.capabilityId)
        && c.version > admittedVersion && ['pause', 'revoke'].includes(c.operation))) fail('CONTROL_FENCED');
    }
    const material = await resolveProvider(tx, payload.binding, payload.action);
    if (canonicalHash(material.descriptor) !== payload.binding.descriptorHash) fail('DESCRIPTOR_CHANGED');
    const claims = await revalidateAdmittedLease(tx, { accountId: enrollment.accountId, leaseId: payload.leaseId,
      callId: payload.callId, audience: enrollment.audience, action: payload.action }, resolver);
    return { binding: payload.binding, action: payload.action, claims, material: material.material };
  }

  async function execute(commandId: string, workerId: string) {
    z.string().min(1).max(255).parse(workerId);
    // Persist ambiguous exposure BEFORE any provider call. Crash recovery never
    // redispatches this command, even if the crash occurred before the actual send.
    const claim = await withTransaction(async tx => {
      await transactionDeadline(tx);
      const { command, payload, receipt } = await commandRecord(tx, commandId);
      if (command.status !== 'PENDING' || command.effectState !== 'PRE_EFFECT') return null;
      await validateDispatch(tx, payload, receipt);
      await recoveryFence(tx, true);
      const fenceToken = command.fenceToken + 1;
      await tx.update(taskCommands).set({ status: 'PROCESSING', effectState: 'POSSIBLY_COMMITTED', workerId,
        fenceToken, attempt: command.attempt + 1, leaseUntil: new Date(Date.now() + 60_000).toISOString(),
        payload: { ...payload, dispatchFence: fenceToken }, updatedAt: now() }).where(eq(taskCommands.id, commandId));
      return fenceToken;
    });
    if (claim === null) return read(commandId);
    // Account fencing serializes the bounded provider operation with revocation.
    // The durable intent above survives transaction/process death. Result writers
    // must still match the exact claim; no automatic provider retry is allowed.
    return withTransaction(async tx => {
      await transactionDeadline(tx);
      const { command, payload, receipt } = await commandRecord(tx, commandId);
      if (command.status !== 'PROCESSING' || command.workerId !== workerId || command.fenceToken !== claim
        || !command.leaseUntil || Date.parse(command.leaseUntil) <= Date.now()) fail('WORKER_FENCED');
      let outcome: 'SUCCEEDED' | 'UNKNOWN' = 'UNKNOWN';
      let result: unknown = null;
      try {
        const context = await validateDispatch(tx, payload, receipt);
        if (context.claims.exp * 1000 <= Date.now() || Date.parse(command.leaseUntil) <= Date.now()) fail('DISPATCH_EXPIRED');
        const supplied = await bounded(signal => provider.execute({ ...context, signal }),
          Math.min(dispatchTimeoutMs, context.claims.exp * 1000 - Date.now(), Date.parse(command.leaseUntil) - Date.now()));
        // Timeout does not assert external termination. Late output has no writer
        // authority, remains UNKNOWN, and cannot cause a second dispatch.
        result = provider.validateResult(context, supplied);
        if ((result as { state?: string })?.state === 'SUCCEEDED') outcome = 'SUCCEEDED';
      } catch { /* Preserve ambiguous exposure, never provider error bodies. */ }
      const [completed] = await tx.update(taskCommands).set({ status: outcome === 'SUCCEEDED' ? 'COMPLETED' : 'DEAD_LETTERED',
        payload: { ...payload, outcome }, leaseUntil: null, updatedAt: now() }).where(and(
          eq(taskCommands.accountId, enrollment.accountId), eq(taskCommands.id, commandId),
          eq(taskCommands.kind, kind), eq(taskCommands.status, 'PROCESSING'),
          eq(taskCommands.fenceToken, claim), eq(taskCommands.workerId, workerId)))
        .returning({ id: taskCommands.id });
      // A concurrent cancellation must not be overwritten or acquire a result
      // receipt. The already committed dispatch intent retains UNKNOWN exposure.
      if (!completed) fail('WORKER_FENCED');
      await tx.insert(controlOutbox).values({ id: id('obx'), accountId: enrollment.accountId,
        aggregateType: 'native_result', aggregateId: commandId, type: 'native.result',
        payload: { commandId, dispatchFence: claim, requestHash: payload.requestHash, outcome, result },
        idempotencyKey: `native-result:${commandId}`, publishedAt: now() });
      await appendAuditRecordInTransaction(tx, { accountId: enrollment.accountId, agentId: payload.binding.agentId,
        taskId: payload.binding.taskId, leaseId: payload.leaseId, eventType: 'native.result', outcome,
        details: { commandId, dispatchFence: claim, requestHash: payload.requestHash } }, signer);
      return { commandId, outcome, accounting: 'PRESERVE_UNKNOWN' as const };
    });
  }
  async function read(commandId: string) {
    return withTransaction(async tx => {
      await transactionDeadline(tx);
      const { command, payload } = await commandRecord(tx, commandId);
      return { commandId, outcome: payload.outcome ?? (command.effectState === 'POSSIBLY_COMMITTED' ? 'UNKNOWN' : 'NOT_DISPATCHED'),
        control: payload.control ?? null, accounting: 'PRESERVE_UNKNOWN' as const };
    });
  }
  async function recover(commandId: string) {
    return withTransaction(async tx => {
      await transactionDeadline(tx);
      const { command, payload } = await commandRecord(tx, commandId);
      if (command.status === 'PROCESSING' && command.effectState === 'POSSIBLY_COMMITTED'
        && command.leaseUntil && Date.parse(command.leaseUntil) <= Date.now()) {
        await tx.update(taskCommands).set({ status: 'DEAD_LETTERED', payload: { ...payload, outcome: 'UNKNOWN' },
          fenceToken: command.fenceToken + 1, workerId: null, leaseUntil: null, updatedAt: now() }).where(eq(taskCommands.id, commandId));
      }
      return { commandId, redispatch: false, accounting: 'PRESERVE_UNKNOWN' as const };
    });
  }
  async function resourceEvidence(value: { evidence: ResourceEvidence; keyId: string; signature: string }) {
    const evidence = resourceEvidenceSchema.parse(value.evidence);
    if (value.keyId !== options.resourceEvidenceKey.keyId
      || !verifyAuditSignature(options.resourceEvidenceKey.publicKeyPem, canonicalJson(evidence), value.signature)) fail('RESOURCE_AUTHENTICATION');
    return withTransaction(async tx => {
      await transactionDeadline(tx);
      const { payload } = await commandRecord(tx, evidence.commandId);
      if (evidence.accountId !== enrollment.accountId || evidence.installationId !== enrollment.installationId
        || evidence.incarnation !== enrollment.incarnation || evidence.requestHash !== payload.requestHash
        || evidence.dispatchFence !== payload.dispatchFence) fail('RESOURCE_SCOPE');
      const idempotencyKey = `native-resource:${evidence.commandId}`;
      const [previous] = await tx.select().from(controlOutbox).where(and(eq(controlOutbox.accountId, enrollment.accountId), eq(controlOutbox.idempotencyKey, idempotencyKey))).limit(1);
      if (previous) {
        const prior = (previous.payload as typeof value).evidence;
        if (prior.sequence > evidence.sequence || (prior.sequence === evidence.sequence && canonicalHash(prior) !== canonicalHash(evidence))
          || ['STOP_UNKNOWN', 'STOP_CONFIRMED', 'CLEANUP_CONFIRMED'].indexOf(evidence.state) < ['STOP_UNKNOWN', 'STOP_CONFIRMED', 'CLEANUP_CONFIRMED'].indexOf(prior.state)) fail('RESOURCE_REGRESSION');
        await tx.update(controlOutbox).set({ payload: value }).where(eq(controlOutbox.id, previous.id));
      } else await tx.insert(controlOutbox).values({ id: id('obx'), accountId: enrollment.accountId,
        aggregateType: 'native_resource_evidence', aggregateId: evidence.commandId, type: 'native.resource.evidence',
        idempotencyKey, payload: value, publishedAt: now() });
      return { state: evidence.state, accounting: 'PRESERVE_UNKNOWN' as const };
    });
  }
  return { host, receivePolicy, execute, read, recover, resourceEvidence,
    admit: (input: Parameters<typeof admitNativeCommand>[0]) => admitNativeCommand(input, host, signer, resolver) };
}
const resourceEvidenceSchema = z.object({ schema: z.literal('relay.native-resource.v1'), accountId: z.string(),
  installationId: z.string(), incarnation: z.string(), commandId: z.string(), requestHash: z.string(),
  dispatchFence: z.number().int().positive(), sequence: z.number().int().positive(),
  state: z.enum(['STOP_UNKNOWN', 'STOP_CONFIRMED', 'CLEANUP_CONFIRMED']), evidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
export type ResourceEvidence = z.infer<typeof resourceEvidenceSchema>;
