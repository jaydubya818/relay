import { generateKeyPairSync, sign } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, withTransaction } from '@/lib/db';
import { controlOutbox } from '@/lib/db/schema';
import { freshDatabase } from '../helpers';
import { createBudget, reserveBudget } from '@/lib/v2/budgets';
import { canonicalHash, type ActionIntent } from '@/lib/v2/contracts';
import { createLocalEd25519Signer } from '@/lib/v2/evidence';
import { createWorkloadBootstrap, exchangeWorkloadBootstrap } from '@/lib/v2/leases';
import { createV2Agent, issueAgentPassport } from '@/lib/v2/passports';
import { evaluatePolicy, publishRelaySafetyPolicy, registerCapabilityDefinition } from '@/lib/v2/policy';
import { registerRuntimeClient } from '@/lib/v2/runtime-clients';
import { advanceRelayPolicyFence } from '@/lib/v2/policy/ordering';
import { admissionActionDigest, policyMessageHash, signPolicyMessage, type Fence, type PolicyKey } from '@/lib/v2/policy/ordering-wire';
import { nativeAdmissionActionMaterial, type NativeReceivingHost, type NativeWorkBinding } from '@/lib/v2/native-admission';

async function policyKey(keyId: string): Promise<PolicyKey> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { keyId, jwk: await crypto.subtle.exportKey('jwk', pair.privateKey) };
}
export async function setup(requireApproval = false) {
  const { accountId, principalId } = await freshDatabase();
  const signer = createLocalEd25519Signer('native-test');
  const resolver = { publicKeyForKeyId: async (key: string) => key === signer.keyId ? signer.publicKeyPem() : undefined };
  const runtime = await registerRuntimeClient({ accountId, actorPrincipalId: principalId, displayName: 'Native qualification', selfDeclaredProduct: 'custom' }, signer);
  await registerCapabilityDefinition({ name: 'integrations.use', version: '1.0', domain: 'integration', description: 'Synthetic read', effectClass: 'read', riskClass: 'low', resourceType: 'integration_tool', inputSchema: {}, outputSchema: {}, meteringDimensions: ['CONNECTOR_CALLS'] }, signer);
  await publishRelaySafetyPolicy({ name: 'native-test', rules: [{ id: 'native-read', effect: requireApproval ? 'REQUIRE_APPROVAL' : 'ALLOW', ...(requireApproval ? { approval: { class: 'native-read', allowedScopes: ['once' as const] } } : {}), match: { capability: { name: 'integrations.use', version: '1.0' } }, reasonCode: 'ALLOWED_BY_POLICY' }] }, signer);
  const { agentId } = await createV2Agent({ accountId, ownerPrincipalId: principalId, name: 'Native Agent' }, signer);
  await issueAgentPassport({ accountId, agentId, ownerPrincipalId: principalId, policy: { trustTier: 'HIGH_ASSURANCE', capabilityEligibility: [{ name: 'integrations.use', version: '1.0' }], policyReferences: ['native-test'], budgetReferences: [], allowedEnvironments: { providerIds: ['relay-managed'], minimumAssurance: 'managed-equivalent' }, dataAccess: [], expiresAt: '2099-01-01T00:00:00.000Z' } }, signer);
  const taskId = 'tsk_native1234';
  const pair = generateKeyPairSync('ed25519');
  const bootstrap = await createWorkloadBootstrap({ accountId, agentId, runtimeClientId: runtime.runtimeClientId, taskId, providerId: 'relay-managed', assurance: 'managed-equivalent', audience: 'qualification-native', publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }, signer);
  const workload = await exchangeWorkloadBootstrap({ accountId, secret: bootstrap.secret, proofSignature: sign(null, Buffer.from(bootstrap.challenge), pair.privateKey).toString('base64url') }, signer);
  const binding: NativeWorkBinding = { accountId, ownerId: principalId, organizationId: 'org-qualification', installationId: 'installation-qualification', agentId, runtimeClientId: runtime.runtimeClientId, workloadId: workload.workloadId, taskId, workId: 'work-fixture', missionId: 'mission-fixture', workGeneration: 1, connectionId: 'connection-fixture', connectionAuthorityVersion: 1, descriptorHash: canonicalHash({ tool: 'fixture', version: 1 }), argumentHash: canonicalHash({ target: 'fixture' }), targetResource: 'fixture', capabilityId: 'connected-apps', effect: 'READ' };
  const sourceKey = await policyKey('source-fixture'), relayKey = await policyKey('relay-fixture'), backendKey = await policyKey('backend-fixture');
  const enrollment = { accountId, ownerId: principalId, organizationId: binding.organizationId, installationId: binding.installationId, backendId: 'backend-fixture', incarnation: 'incarnation-fixture', enrollmentVersion: 1, audience: 'qualification-native', sourceKey, relayKey };
  const destination = { ...enrollment, agentId, capabilityNames: { 'connected-apps': 'integrations.use' }, endpoint: 'http://127.0.0.1:56680/fence', sourceKey, backendKey };
  process.env.RELAY_CAPABILITY_ENVIRONMENT = 'qualification';
  process.env.RELAY_CAPABILITY_COORDINATION_JSON = JSON.stringify({ signer: relayKey, destinations: [destination] });
  let relayHead!: Fence;
  await withTransaction(async tx => {
    await advanceRelayPolicyFence(tx, accountId);
    const [epochRow] = await tx.select().from(controlOutbox).where(eq(controlOutbox.idempotencyKey, 'capability-ordering:epoch'));
    const epoch = epochRow!.payload as { version: number; policyId: string };
    await tx.update(controlOutbox).set({ payload: { ...epochRow!.payload as object, pending: [] } }).where(eq(controlOutbox.id, epochRow!.id));
    relayHead = { kind: 'FENCE', authority: 'relay', ownerId: principalId, organizationId: binding.organizationId, installationId: binding.installationId, backendId: enrollment.backendId, incarnation: enrollment.incarnation, enrollmentVersion: 1, version: epoch.version, policyId: epoch.policyId, capabilityId: 'work', operation: 'disable' };
  });
  const sourceHead: Fence = { ...relayHead, authority: 'myeve', version: 1, policyId: 'owner-policy-1', capabilityId: 'connected-apps', operation: 'enable' };
  const heads = { myeve: await signPolicyMessage(sourceHead, sourceKey), relay: await signPolicyMessage(relayHead, relayKey) };
  await db().insert(controlOutbox).values({ id: 'fixture_heads', accountId, aggregateType: 'fixture', aggregateId: 'fixture', type: 'fixture', payload: heads, idempotencyKey: 'fixture-heads', publishedAt: new Date().toISOString() });
  const material = { capability: { name: 'integrations.use', version: '1.0' }, resource: { type: 'integration_tool', ids: [binding.connectionId, binding.targetResource], attributes: { accountId } }, parameters: { target: 'fixture' } };
  const action: ActionIntent = { schemaVersion: 'relay.action-intent.v2', id: 'act_nativefixture', accountId, agentId, runtimeClientId: runtime.runtimeClientId, taskId, workloadId: workload.workloadId, ...material, idempotencyKey: 'native-fixture', createdAt: new Date().toISOString(), canonicalHash: canonicalHash(material) };
  const { kind: _kind, operation: _operation, ...identity } = sourceHead;
  void _kind; void _operation;
  const issuedAt = Date.now();
  const source = await signPolicyMessage({ ...identity, kind: 'PERMIT', referenceId: crypto.randomUUID(), capabilityId: 'connected-apps', requiredCapabilities: ['connected-apps', 'work'], registryVersion: 'fixture-registry', agentId, agentRevision: 0, workId: binding.workId, missionId: binding.missionId, workGeneration: 1, actionDigest: await admissionActionDigest(nativeAdmissionActionMaterial(binding, action)), budgetMicros: 0, issuedAt, expiresAt: issuedAt + 30_000, sourcePermitHash: 'SELF' }, sourceKey);
  action.parameters = { ...action.parameters, capabilityAdmissionDigest: await policyMessageHash(JSON.parse(source.message)) };
  action.canonicalHash = canonicalHash({ capability: action.capability, resource: action.resource, parameters: action.parameters });
  const decision = await evaluatePolicy({ accountId, action, resourceResolver: { resolveOwnership: async () => ({ name: 'resource.account_id', value: accountId, authoritative: true, observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceRevision: 'fixture:1' }) } }, signer);
  const budget = await createBudget({ accountId, actorPrincipalId: principalId, scope: 'ACCOUNT', dimension: 'CONNECTOR_CALLS', unit: 'calls', hardLimit: '2' }, signer);
  const reservation = await reserveBudget({ accountId, leafBudgetId: budget.budgetId, agentId, taskId, actionIntentId: action.id, amount: '1', idempotencyKey: 'fixture-reservation', expiresAt: new Date(Date.now() + 60_000).toISOString() }, signer);
  const host: NativeReceivingHost = { enrollment,
    resolveBinding: async () => ({ binding, descriptor: { tool: 'fixture', version: 1 } }),
    readPolicyHeads: async tx => (await tx.select().from(controlOutbox).where(eq(controlOutbox.id, 'fixture_heads')))[0]!.payload as typeof heads,
    readTrustedPolicyHeads: async () => heads,
    admitCommand: async (tx, command) => {
      // Synthetic native host transaction; no provider worker or remote effect exists.
      await tx.insert(controlOutbox).values({ id: 'fixture_command', accountId, aggregateType: 'fixture-native-command', aggregateId: 'fixture-native-command', type: 'fixture', payload: { requestHash: command.requestHash }, idempotencyKey: 'fixture-native-command', publishedAt: new Date().toISOString() });
      return { commandId: 'fixture-native-command' };
    },
  };
  const input = { binding, source, idempotencyKey: 'native-fixture', lease: { accountId, action, workloadId: workload.workloadId, workloadIdentityToken: workload.token, audience: enrollment.audience, budgetReservationId: reservation.reservationId } };
  return { accountId, principalId, signer, resolver, binding, input, host, heads, sourceHead, sourceKey, backendKey, reservation, decision };
}

