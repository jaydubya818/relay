import { vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { eventRoutes, taskCommands, v2Events, v2Tasks } from '@/lib/db/schema';
import { canonicalHash, canonicalJson } from '@/lib/v2/contracts';
import { createNativeReceiver, type ResourceEvidence } from '@/lib/v2/native-receiving';
import { signPolicyMessage } from '@/lib/v2/policy/ordering-wire';
import { setup } from './native-fixture';
import { activateV2Agent } from '@/lib/v2/passports';

export async function receiverFixture(requireApproval = false) {
  const f = await setup(requireApproval);
  const b = f.binding;
  await activateV2Agent({ accountId: f.accountId, agentId: b.agentId, actorPrincipalId: f.principalId }, f.signer);
  await db().insert(eventRoutes).values({ id: 'route-native', accountId: f.accountId, name: 'native', version: 1,
    source: 'authenticated-myeve', eventType: 'work.authorized', agentId: b.agentId, createdByPrincipalId: f.principalId });
  await db().insert(v2Events).values({ id: 'event-native', accountId: f.accountId, source: 'authenticated-myeve', type: 'work.authorized',
    occurredAt: new Date().toISOString(), dedupeKey: 'native', correlationId: 'native', schemaVersion: 'relay.native-work.v1',
    classification: 'internal', signatureStatus: 'VERIFIED', data: { nativeWork: {
      ownerId: b.ownerId, organizationId: b.organizationId, installationId: b.installationId,
      workId: b.workId, missionId: b.missionId, workGeneration: b.workGeneration } } });
  await db().insert(v2Tasks).values({ id: b.taskId, accountId: f.accountId, eventId: 'event-native', routeId: 'route-native',
    logicalKey: 'native', maxAttempts: 1, agentId: b.agentId, status: 'RUNNING' });
  let descriptor = { tool: 'fixture', version: 1 };
  let connectionActive = true;
  const execute = vi.fn(async () => ({ state: 'SUCCEEDED', data: { fixture: true } }));
  let sequence = 0;
  const options = { enrollment: f.host.enrollment, backendSigner: f.backendKey, ownerPrincipalId: f.principalId,
    recoveryWitness: { read: async () => sequence, advance: async (expected: number) => { if (expected !== sequence) throw Error('STALE_WITNESS'); return ++sequence; } },
    workSource: 'authenticated-myeve', signer: f.signer, resolver: f.resolver, witness: { read: async () => f.heads },
    resourceEvidenceKey: { keyId: f.signer.keyId, publicKeyPem: await f.signer.publicKeyPem() },
    provider: {
      connectionQuery: () => sql`SELECT 1 AS available`,
      resolve: () => { if (!connectionActive) throw Error('CONNECTION_REVOKED'); return { descriptor, material: null }; },
      execute, validateResult: (_context: unknown, value: unknown) => structuredClone(value),
    } };
  const receiver = createNativeReceiver(options);
  await receiver.receivePolicy(f.heads.myeve);
  await receiver.receivePolicy(f.heads.relay);
  async function policy(operation: 'enable' | 'disable' | 'pause' | 'revoke', version = 2) {
    const envelope = await signPolicyMessage({ ...f.sourceHead, version, policyId: `${operation}-${version}`, operation }, f.sourceKey);
    f.heads.myeve = envelope;
    await receiver.receivePolicy(envelope);
    return envelope;
  }
  return { ...f, receiver, options, execute, policy, changeDescriptor: () => { descriptor = { tool: 'fixture', version: 2 }; },
    revokeConnection: () => { connectionActive = false; },
    admit: () => receiver.admit(f.input),
    async evidence(commandId: string, state: ResourceEvidence['state'], sequence: number) {
      const [command] = await db().select().from(taskCommands).where(eq(taskCommands.id, commandId));
      const payload = command!.payload as { requestHash: string; dispatchFence: number };
      const evidence: ResourceEvidence = { schema: 'relay.native-resource.v1', accountId: f.accountId,
        installationId: b.installationId, incarnation: options.enrollment.incarnation, commandId,
        requestHash: payload.requestHash, dispatchFence: payload.dispatchFence, sequence, state, evidenceDigest: canonicalHash({ state, sequence }) };
      return { evidence, keyId: f.signer.keyId, signature: await f.signer.sign(canonicalJson(evidence)) };
    } };
}
