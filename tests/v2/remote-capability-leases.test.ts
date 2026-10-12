import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, withTransaction, closeDatabasesForTests } from '@/lib/db';
import { capabilityLeases, controlOutbox, approvalRequests, budgetReservations } from '@/lib/db/schema';
import { lockActiveAccount } from '@/lib/account-fence';
import { canonicalHash, type ActionIntent } from '@/lib/v2/contracts';
import { createLocalEd25519Signer } from '@/lib/v2/evidence';
import { createWorkloadBootstrap, exchangeWorkloadBootstrap, revokeLease, authorizeLeaseCall } from '@/lib/v2/leases';
import { createV2Agent, issueAgentPassport } from '@/lib/v2/passports';
import { evaluatePolicy, publishRelaySafetyPolicy, registerCapabilityDefinition, type PolicyRule } from '@/lib/v2/policy';
import { registerRuntimeClient, revokeRuntimeClient } from '@/lib/v2/runtime-clients';
import { createApprovalRequest, decideApproval } from '@/lib/v2/approvals';
import { createBudget, reserveBudget } from '@/lib/v2/budgets';
import { configureV2PlatformBindings } from '@/lib/v2/platform-bindings';
import { advanceRelayPolicyFence, flushRelayPolicyFences, forwardOwnerPolicyFence, flushOwnerPolicyFences } from '@/lib/v2/policy/ordering';
import { signPolicyMessage, verifyPolicyMessage, policyMessageHash, type PolicyKey } from '@/lib/v2/policy/ordering-wire';
import { POST } from '@/app/api/v2/runtime/capability-leases/route';
import { cleanupDatabase, freshDatabase, secondAccount } from '../helpers';

function proposedAction(accountId: string, agentId: string, runtimeClientId: string, capabilityName: string, target = "target-1"): ActionIntent {
  const material = { capability: { name: capabilityName, version: "1.0" }, resource: { type: "target", ids: [target], attributes: { accountId } }, parameters: { operation: "read" } };
  return { schemaVersion: "relay.action-intent.v2", id: `act_${crypto.randomUUID().replaceAll("-", "")}`, accountId, agentId, runtimeClientId, taskId: "tsk_12345678", ...material, idempotencyKey: crypto.randomUUID(), createdAt: new Date().toISOString(), canonicalHash: canonicalHash(material) };
}

async function setup(effectClass: "read" | "financial" = "read", policyEffect: "ALLOW" | "REQUIRE_APPROVAL" = "ALLOW", meteringDimensions: Array<"TOKENS"> = [], parameters?: ActionIntent["parameters"]) {
  const { accountId, principalId } = await freshDatabase();
  const signer = createLocalEd25519Signer("lease-key");
  const resolver = { publicKeyForKeyId: async (keyId: string) => keyId === signer.keyId ? await signer.publicKeyPem() : undefined };
  const runtime = await registerRuntimeClient({ accountId, actorPrincipalId: principalId, displayName: "Runner client", selfDeclaredProduct: "custom" }, signer);
  const capabilityName = `${capabilityDomain(effectClass)}.lease.execute`;
  await registerCapabilityDefinition({ name: capabilityName, version: "1.0", domain: effectClass, description: "Lease fixture", effectClass, riskClass: effectClass === "financial" ? "critical" : "low", resourceType: "target", inputSchema: {}, outputSchema: {}, meteringDimensions }, signer);
  const rule: PolicyRule = { id: "lease-policy", effect: policyEffect, match: { capability: { name: capabilityName, version: "1.0" } }, reasonCode: policyEffect === "ALLOW" ? "ALLOWED_BY_POLICY" : "APPROVAL_REQUIRED", ...(policyEffect === "REQUIRE_APPROVAL" ? { approval: { class: effectClass === "financial" ? "financial" : "test", allowedScopes: ["once"] } } : {}) };
  await publishRelaySafetyPolicy({ name: "lease-safety", rules: [rule] }, signer);
  const agent = await createV2Agent({ accountId, ownerPrincipalId: principalId, name: "Lease Agent" }, signer);
  await issueAgentPassport({ accountId, agentId: agent.agentId, ownerPrincipalId: principalId, policy: { trustTier: "HIGH_ASSURANCE", capabilityEligibility: [{ name: capabilityName, version: "1.0" }], policyReferences: ["lease-safety"], budgetReferences: [], allowedEnvironments: { providerIds: ["relay-managed"], minimumAssurance: "managed-equivalent" }, dataAccess: [], expiresAt: "2099-01-01T00:00:00.000Z" } }, signer);
  const action = proposedAction(accountId, agent.agentId, runtime.runtimeClientId, capabilityName);
  if (parameters) { action.parameters = parameters; action.canonicalHash = canonicalHash({ capability: action.capability, resource: action.resource, parameters }); }
  const policy = await evaluatePolicy({ accountId, action, resourceResolver: { resolveOwnership: async () => ({ name: "resource.account_id", value: accountId, authoritative: true, observedAt: new Date(Date.now() - 100).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceRevision: "target:1" }) } }, signer);
  const pair = generateKeyPairSync("ed25519");
  const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const bootstrap = await createWorkloadBootstrap({ accountId, agentId: agent.agentId, runtimeClientId: runtime.runtimeClientId, taskId: action.taskId, providerId: "relay-managed", assurance: "managed-equivalent", audience: "relay-pep", publicKeyPem }, signer);
  const workload = await exchangeWorkloadBootstrap({ accountId, secret: bootstrap.secret, proofSignature: sign(null, Buffer.from(bootstrap.challenge), pair.privateKey).toString("base64url") }, signer);
  return { accountId, principalId, signer, resolver, runtimeSecret: runtime.secret, runtimeClientId: runtime.runtimeClientId, agentId: agent.agentId, capabilityName, action, policy, bootstrap, workload };
}

function capabilityDomain(value: string) { return value === "read" ? "resource" : value; }

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllEnvs();
  await cleanupDatabase();
});
async function remoteFixture(options: { approval?: boolean; metered?: boolean } = {}) {
  const f = await setup('read', options.approval ? 'REQUIRE_APPROVAL' : 'ALLOW', options.metered ? ['TOKENS'] : []);
  const key = async (keyId: string): Promise<PolicyKey> => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    return { keyId, jwk: await crypto.subtle.exportKey('jwk', pair.privateKey) };
  };
  const source = await key('owner'), relay = await key('relay'), receiver = await key('receiver');
  const transport = { loseAcknowledgment: false };
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      const envelope = JSON.parse(body).envelope;
      const fence = await verifyPolicyMessage(envelope, JSON.parse(envelope.message).authority === 'myeve' ? source : relay);
      if (fence.kind !== 'FENCE') throw Error('fence required');
      const { kind, capabilityId, operation, controls, ...identity } = fence;
      void kind; void capabilityId; void operation; void controls;
      const acknowledgment = await signPolicyMessage({ ...identity, kind: 'FENCE_ACK', fenceHash: await policyMessageHash(fence) }, receiver);
      // A durable synthetic receiver acknowledgment, never a claimed installed MC transaction.
      await db().insert(controlOutbox).values({ id: 'ack_' + crypto.randomUUID(), accountId: f.accountId, aggregateType: 'test_receiver', aggregateId: fence.policyId,
        type: 'test.ack', payload: acknowledgment, idempotencyKey: `receiver:${fence.authority}:${fence.version}`, publishedAt: new Date().toISOString() }).onConflictDoNothing();
      if (transport.loseAcknowledgment) { res.destroy(); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(acknowledgment));
    } catch { res.writeHead(500); res.end(); }
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const identity = { ownerId: 'synthetic-owner', organizationId: f.accountId, installationId: 'synthetic-installation', backendId: 'missioncontrol', incarnation: 'qualification-1', enrollmentVersion: 1 };
  const destination = { ...identity, accountId: f.accountId, agentId: f.agentId, capabilityNames: { 'enterprise.fleet': f.capabilityName }, endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/fence`, sourceKey: source, backendKey: receiver };
  vi.stubEnv('RELAY_V2_ACTIONS_ENABLED', 'true'); vi.stubEnv('RELAY_DEPLOYMENT_MODE', 'local');
  vi.stubEnv('RELAY_CAPABILITY_ENVIRONMENT', 'qualification'); vi.stubEnv('RELAY_CAPABILITY_COORDINATION_JSON', JSON.stringify({ signer: relay, destinations: [destination] }));
  await withTransaction(async tx => { await lockActiveAccount(tx, f.accountId); await advanceRelayPolicyFence(tx, f.accountId); });
  await flushRelayPolicyFences(f.accountId);
  const issuedAt = Date.now();
  const permit = { ...identity, kind: 'PERMIT' as const, authority: 'myeve' as const, version: 1, policyId: 'owner-policy-1', referenceId: crypto.randomUUID(), capabilityId: 'enterprise.fleet', requiredCapabilities: ['work', 'missioncontrol', 'enterprise.fleet'], registryVersion: 'qualification', agentId: f.agentId, agentRevision: 1, workId: 'work-1', missionId: 'mission-1', workGeneration: 1, actionDigest: 'a'.repeat(64), budgetMicros: 0, issuedAt, expiresAt: issuedAt + 30000, sourcePermitHash: 'SELF' };
  const remoteAdmission = await signPolicyMessage(permit, source);
  f.action.parameters = { capabilityAdmissionDigest: await policyMessageHash(permit) };
  f.action.canonicalHash = canonicalHash({ capability: f.action.capability, resource: f.action.resource, parameters: f.action.parameters });
  const policy = await evaluatePolicy({ accountId: f.accountId, action: f.action, resourceResolver: { resolveOwnership: async () => ({ name: 'resource.account_id', value: f.accountId, authoritative: true, observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), sourceRevision: 'fixture:1' }) } }, f.signer);
  const request = { action: f.action, workloadId: f.workload.workloadId, workloadIdentityToken: f.workload.token, audience: 'relay-pep', maxCalls: 1 as const, remoteAdmission, approvalRequestId: undefined as string | undefined, budgetReservationId: undefined as string | undefined };
  configureV2PlatformBindings({ signer: f.signer, keyResolver: f.resolver });
  const send = (body: unknown = request, accountId = f.accountId, credential = f.runtimeSecret) => POST(new Request('http://127.0.0.1/api/v2/runtime/capability-leases', { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'x-relay-account-id': accountId, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  return { ...f, policy, identity, permit, source, relay, transport, request, send };
}

it('authenticates one canonical positive lease and recovers identical concurrent/lost-response retries without spending a call', async () => {
  const f = await remoteFixture();
  const responses = await Promise.all([f.send(), f.send(), f.send()]);
  expect(responses.map(r => r.status)).toEqual([200, 200, 200]);
  const results = await Promise.all(responses.map(r => r.json()));
  expect(results[1]).toEqual(results[0]); expect(results[2]).toEqual(results[0]);
  expect(responses[0].headers.get('cache-control')).toBe('no-store');
  expect(await verifyPolicyMessage(results[0].remotePermit, f.relay)).toMatchObject({ authority: 'relay', referenceId: results[0].leaseId, sourcePermitHash: await policyMessageHash(f.permit), missionId: f.permit.missionId });
  await closeDatabasesForTests();
  expect(await (await f.send()).json()).toEqual(results[0]);
  const leases = await db().select().from(capabilityLeases);
  expect(leases).toHaveLength(1); expect(leases[0]).toMatchObject({ callCount: 0, maxCalls: 1, status: 'ACTIVE' });
  expect(await db().select().from(controlOutbox).where(eq(controlOutbox.aggregateType, 'capability_reference'))).toHaveLength(1);
  expect((await f.send({ ...f.request, ttlSeconds: 29 })).status).toBe(409);
  await authorizeLeaseCall({ token: results[0].token, expectedAccountId: f.accountId, expectedAudience: f.request.audience, expectedWorkloadId: f.workload.workloadId, action: f.action, callId: 'actual-relay-call', online: true }, f.resolver, f.signer);
  expect((await f.send()).status).toBe(403);
});

it('fails closed on disabled transport, wrong runtime/account, foreign identity, or changed Work proof', async () => {
  const f = await remoteFixture();
  vi.stubEnv('RELAY_V2_ACTIONS_ENABLED', 'false'); expect((await f.send()).status).toBe(503);
  vi.stubEnv('RELAY_V2_ACTIONS_ENABLED', 'true');
  expect((await f.send(f.request, await secondAccount())).status).toBe(401);
  expect((await f.send(f.request, f.accountId, 'rrtc_wrong')).status).toBe(401);
  const foreign = await registerRuntimeClient({ accountId: f.accountId, actorPrincipalId: f.principalId, displayName: 'Other runner', selfDeclaredProduct: 'test' }, f.signer);
  expect((await f.send(f.request, f.accountId, foreign.secret)).status).toBe(403);
  for (const patch of [{ ownerId: 'other' }, { installationId: 'other' }, { missionId: 'other' }, { agentId: 'agt_other' }]) {
    const remoteAdmission = await signPolicyMessage({ ...f.permit, ...patch }, f.source);
    expect((await f.send({ ...f.request, remoteAdmission })).status).not.toBe(200);
  }
  expect((await f.send({ ...f.request, workloadId: 'wkl_foreign' })).status).toBe(401);
  expect(await db().select().from(capabilityLeases)).toHaveLength(0);
});

it('does not replay authority after Relay revocation or a concurrent fence', async () => {
  const f = await remoteFixture();
  const result = await (await f.send()).json();
  await Promise.allSettled([f.send(), revokeLease({ accountId: f.accountId, leaseId: result.leaseId, reason: 'qualification' }, f.signer)]);
  expect((await f.send()).status).not.toBe(200);
  await flushRelayPolicyFences(f.accountId);
  expect((await f.send()).status).not.toBe(200);
  expect((await db().select().from(capabilityLeases))[0]).toMatchObject({ status: 'REVOKED', callCount: 0 });
  await revokeRuntimeClient({ accountId: f.accountId, actorPrincipalId: f.principalId, runtimeClientId: f.runtimeClientId }, f.signer);
  expect((await f.send()).status).toBe(401);
});

it('fences stale owner proofs before and after lost acknowledgment recovery without changing admitted leases', async () => {
  const f = await remoteFixture();
  expect((await f.send()).status).toBe(200);
  const fence = await signPolicyMessage({ ...f.identity, authority: 'myeve', kind: 'FENCE', version: 2, policyId: 'owner-policy-2', capabilityId: 'missioncontrol', operation: 'disable' }, f.source);
  f.transport.loseAcknowledgment = true;
  await expect(forwardOwnerPolicyFence(fence)).rejects.toBeDefined();
  expect((await f.send()).status).not.toBe(200);
  await closeDatabasesForTests(); f.transport.loseAcknowledgment = false;
  expect(await flushOwnerPolicyFences(f.accountId)).toEqual([{ backendId: 'missioncontrol', status: 'ACKNOWLEDGED' }]);
  expect((await f.send()).status).not.toBe(200);
  expect((await db().select().from(capabilityLeases))[0]).toMatchObject({ status: 'ACTIVE', callCount: 0 });
});

it('requires canonical approval and preserves a bound UNKNOWN budget on denied retries', async () => {
  const f = await remoteFixture({ approval: true, metered: true });
  expect((await f.send()).status).toBe(403);
  const budget = await createBudget({ accountId: f.accountId, actorPrincipalId: f.principalId, scope: 'TASK', scopeId: f.action.taskId, dimension: 'TOKENS', unit: 'token', hardLimit: '100' }, f.signer);
  const reservation = await reserveBudget({ accountId: f.accountId, leafBudgetId: budget.budgetId, agentId: f.agentId, taskId: f.action.taskId, actionIntentId: f.action.id, amount: '10', idempotencyKey: 'remote-meter', expiresAt: new Date(Date.now() + 60000).toISOString() }, f.signer);
  f.request.budgetReservationId = reservation.reservationId;
  expect((await f.send()).status).toBe(403);
  const approval = await createApprovalRequest({ accountId: f.accountId, action: f.action, policyDecisionId: f.policy.decisionId, approvalClass: 'test', summary: 'Synthetic Work', consequence: 'One qualified fixture lease', displayEvidence: {}, assignedPrincipalIds: [f.principalId], expiresAt: new Date(Date.now() + 60000).toISOString() }, f.signer);
  await decideApproval({ accountId: f.accountId, requestId: approval.requestId, principalId: f.principalId, decision: 'APPROVE', scope: { kind: 'once', actionHash: f.action.canonicalHash }, authenticationEvidence: { sessionId: 'ses_approved1', method: 'password', authenticatedAt: new Date().toISOString() } }, f.signer);
  f.request.approvalRequestId = approval.requestId;
  expect((await f.send()).status).toBe(200);
  expect((await f.send()).status).toBe(200);
  expect((await db().select().from(approvalRequests))[0].useCount).toBe(1);
  // Fault injection: an unresolved reservation cannot be made spendable by replay.
  await db().update(budgetReservations).set({ status: 'UNKNOWN' }).where(and(eq(budgetReservations.accountId, f.accountId), eq(budgetReservations.id, reservation.reservationId)));
  expect((await f.send()).status).toBe(403);
  expect((await db().select().from(budgetReservations))[0]).toMatchObject({ status: 'UNKNOWN' });
});

it('denies a cached receipt when canonical owner membership becomes unavailable', async () => {
  const f = await remoteFixture();
  expect((await f.send()).status).toBe(200);
  const { suspendPrincipal } = await import('@/lib/v2/identity');
  await suspendPrincipal({ accountId: f.accountId, principalId: f.principalId });
  expect((await f.send()).status).not.toBe(200);
  expect(await db().select().from(capabilityLeases)).toHaveLength(1);
});

it('denies expired source policy on replay and refuses oversized transport requests', async () => {
  const f = await remoteFixture();
  expect((await f.send()).status).toBe(200);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(f.permit.expiresAt + 1);
  try { expect((await f.send()).status).not.toBe(200); } finally { clock.mockRestore(); }
  expect((await f.send({ padding: 'x'.repeat(65536) })).status).toBe(413);
});

it('cannot replay a lease after its exact approval expires', async () => {
  const f = await remoteFixture({ approval: true });
  const approval = await createApprovalRequest({ accountId: f.accountId, action: f.action, policyDecisionId: f.policy.decisionId, approvalClass: 'test', summary: 'Synthetic Work', consequence: 'One fixture', displayEvidence: {}, assignedPrincipalIds: [f.principalId], expiresAt: new Date(Date.now() + 60000).toISOString() }, f.signer);
  await decideApproval({ accountId: f.accountId, requestId: approval.requestId, principalId: f.principalId, decision: 'APPROVE', scope: { kind: 'once', actionHash: f.action.canonicalHash }, authenticationEvidence: { sessionId: 'ses_approved1', method: 'password', authenticatedAt: new Date().toISOString() } }, f.signer);
  f.request.approvalRequestId = approval.requestId;
  const response = await f.send(); expect(response.status).toBe(200);
  const result = await response.json();
  await db().update(approvalRequests).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(eq(approvalRequests.id, approval.requestId));
  expect((await f.send()).status).not.toBe(200);
  await expect(authorizeLeaseCall({ token: result.token, expectedAccountId: f.accountId, expectedAudience: f.request.audience, expectedWorkloadId: f.workload.workloadId, action: f.action, callId: 'expired-approval', online: true }, f.resolver, f.signer)).rejects.toThrow('APPROVAL_REVOKED_OR_EXPIRED');
  expect((await db().select().from(capabilityLeases))[0].callCount).toBe(0);
});
