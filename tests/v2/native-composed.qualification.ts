import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { budgetReservations, policyDecisions } from '@/lib/db/schema';
import { canonicalHash } from '@/lib/v2/contracts';
import { reserveBudget } from '@/lib/v2/budgets';
import { evaluatePolicy } from '@/lib/v2/policy';
import { admissionActionDigest, policyMessageHash, signPolicyMessage } from '@/lib/v2/policy/ordering-wire';
import { nativeAdmissionActionMaterial, admitNativeCommand } from '@/lib/v2/native-admission';
import { createNativeReceiver } from '@/lib/v2/native-receiving';
import { cleanupDatabase } from '../helpers';
import { receiverFixture } from './native-receiving-fixture';
// Runtime imports load the separately source-verified consumer; no frozen module
// is copied over or reinterpreted. Both sides share the canonical database ABI.
const bridgePath = '@consumer/lib/integrations/native-bridge.ts';
const fixturePath = '@consumer/tests/integrations/fixtures.ts';
const consumerPath = '@consumer/lib/integrations/consumer.ts';
const contractsPath = '@consumer/lib/integrations/contracts.ts';
const { createNativeConsumerPort } = await import(bridgePath);
const consumerFixtures = await import(fixturePath);
const { consumerResource } = await import(consumerPath);
const { providerUserId } = await import(contractsPath);

describe('exact-source canonical Relay × consumer positive admission', () => {
  afterEach(async () => { delete process.env.RELAY_CAPABILITY_COORDINATION_JSON; delete process.env.RELAY_CAPABILITY_ENVIRONMENT; await cleanupDatabase(); });
  it('admits one real database command, executes only the mocked SDK, and preserves authority on duplicate delivery', async () => {
    const f = await receiverFixture();
    const provider = consumerFixtures.fixture();
    const descriptor = await provider.adapter.getAction(consumerFixtures.tool.slug);
    const scope = { accountId: f.accountId, ownerPrincipalId: f.principalId, installationId: f.binding.installationId, agentId: f.binding.agentId };
    const connection = { ...consumerFixtures.binding, ...scope, connectionId: f.binding.connectionId, providerUserId: providerUserId(scope) };
    await db().execute(sql`CREATE TABLE integration_connections (id text PRIMARY KEY, account_id text NOT NULL,
      owner_principal_id text NOT NULL, installation_id text NOT NULL, agent_id text NOT NULL, binding jsonb NOT NULL)`);
    await db().execute(sql`INSERT INTO integration_connections VALUES (${connection.connectionId}, ${scope.accountId},
      ${scope.ownerPrincipalId}, ${scope.installationId}, ${scope.agentId}, ${JSON.stringify(connection)}::jsonb)`);
    const [decision] = await db().select().from(policyDecisions);
    const request = { schemaVersion: 'relay.integration-read.v1', scope, connectionId: connection.connectionId,
      toolkit: connection.toolkit, tool: descriptor.slug, toolVersion: descriptor.version, toolSchemaHash: descriptor.schemaHash,
      authorityVersion: 1, ownerPolicyRevision: 1, relayPolicyRevision: canonicalHash(decision!.policyBundleHashes),
      harnessId: 'native-composed-fixture', effect: 'READ', targetResource: f.binding.targetResource,
      expiresAt: new Date((Math.floor(Date.now() / 1000) + 10) * 1000).toISOString() };
    const action = { ...f.input.lease.action, id: 'act_nativecomposed', idempotencyKey: 'native-composed',
      resource: consumerResource(request, 'native-composed'), parameters: { per_page: 10 } as Record<string, unknown> };
    const binding = { ...f.binding, descriptorHash: canonicalHash(descriptor), argumentHash: canonicalHash(action.parameters) };
    const source = await signPolicyMessage({ ...JSON.parse(f.input.source.message),
      actionDigest: await admissionActionDigest(nativeAdmissionActionMaterial(binding, action)) }, f.sourceKey);
    action.parameters.capabilityAdmissionDigest = await policyMessageHash(JSON.parse(source.message));
    action.canonicalHash = canonicalHash({ capability: action.capability, resource: action.resource, parameters: action.parameters });
    await evaluatePolicy({ accountId: f.accountId, action, resourceResolver: { resolveOwnership: async () => ({ name: 'resource.account_id',
      value: f.accountId, authoritative: true, observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30_000).toISOString(), sourceRevision: 'fixture:1' }) } }, f.signer);
    const [originalReservation] = await db().select().from(budgetReservations);
    const reservation = await reserveBudget({ accountId: f.accountId, leafBudgetId: originalReservation!.appliedBudgetIds[0]!,
      agentId: binding.agentId, taskId: binding.taskId, actionIntentId: action.id, amount: '1', idempotencyKey: 'composed-budget',
      expiresAt: new Date(Date.now() + 30_000).toISOString() }, f.signer);
    const port = createNativeConsumerPort({ ownerPrincipalId: f.principalId, descriptors: [descriptor], adapter: provider.adapter });
    const receiver = createNativeReceiver({ ...f.options, provider: port });
    const input = { ...f.input, binding, source, idempotencyKey: 'composed-admission', lease: { ...f.input.lease, action, budgetReservationId: reservation.reservationId } };
    const receipt = await admitNativeCommand(input, receiver.host, f.signer, f.resolver);
    const result = await receiver.execute(receipt.commandId, 'native-composed-worker');
    expect(result).toMatchObject({ outcome: 'SUCCEEDED' });
    expect(provider.sdk.getClient().tools.execute).toHaveBeenCalledTimes(1);
    expect(await admitNativeCommand(input, receiver.host, f.signer, f.resolver)).toEqual(receipt);
    await receiver.execute(receipt.commandId, 'duplicate');
    expect(provider.sdk.getClient().tools.execute).toHaveBeenCalledTimes(1);
    await f.policy('disable');
    await expect(admitNativeCommand({ ...input, idempotencyKey: 'after-disable' }, receiver.host, f.signer, f.resolver)).rejects.toBeDefined();
    expect(await receiver.read(receipt.commandId)).toMatchObject({ outcome: 'SUCCEEDED' });
  });
});
