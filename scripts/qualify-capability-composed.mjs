import assert from 'node:assert/strict';
import { execFile as callback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';
const require = createRequire(import.meta.url);
const { createLocalEd25519Signer } = require('../lib/v2/evidence/index.ts');
const { registerRuntimeClient } = require('../lib/v2/runtime-clients.ts');
const { createV2Agent, issueAgentPassport } = require('../lib/v2/passports.ts');
const { registerCapabilityDefinition, publishRelaySafetyPolicy, evaluatePolicy } = require('../lib/v2/policy/index.ts');
const { createWorkloadBootstrap, exchangeWorkloadBootstrap, issueCapabilityLease } = require('../lib/v2/leases.ts');
const { canonicalHash } = require('../lib/v2/contracts/index.ts');
const { advanceRelayPolicyFence, flushRelayPolicyFences, flushOwnerPolicyFences } = require('../lib/v2/policy/ordering.ts');
const { lockActiveAccount } = require('../lib/account-fence.ts');
const { withTransaction } = require('../lib/db.ts');
const { POST } = require('../app/api/v2/control/capability-fences/route.ts');
const { policyMessageHash } = require('../lib/v2/policy/ordering-wire.ts');

process.env.LC_ALL = 'C';
process.env.LANG = 'C';
const execFile = promisify(callback), fixture = JSON.parse(await readFile(process.argv[2], 'utf8'));
const mcRequire = createRequire(join(dirname(dirname(fixture.cli)), '../package.json'));
const { ConvexHttpClient } = mcRequire('convex/browser'), { makeFunctionReference } = mcRequire('convex/server');
const { CapabilityStore } = await import(join(fixture.myeveRoot, 'apps/eve/lib/capability-control/store.ts'));
const { issueBackendOrderedPermit } = await import(join(fixture.myeveRoot, 'packages/capability-enforcement/src/ordering-source.ts'));
const { propagateCapabilityPolicy } = await import(join(fixture.myeveRoot, 'packages/capability-enforcement/src/ordering-transport.ts'));
const eveRequire = createRequire(join(fixture.myeveRoot, 'package.json'));
const { capabilityRegistry } = await import(eveRequire.resolve('@mission-control/capability-control'));
const directory = await mkdtemp('/private/tmp/cap-composed-');
const bin = process.env.CAPABILITY_TEST_POSTGRES_BIN ?? '/opt/homebrew/opt/postgresql@17/bin';
const databaseUrl = 'postgresql://capability_admin@127.0.0.1:55497/postgres';
let started = false, admin, runtime, server, cleanup, closeEve;
const platformOwner = process.argv[3] !== "ordinary";
const checks = [], pass = name => { checks.push(name); console.log('PASS composed: ' + name); };
const mc = new ConvexHttpClient(fixture.url, { logger: false });
mc.setAdminAuth(fixture.admin, { subject: 'synthetic-owner', issuer: 'https://synthetic.invalid', tokenIdentifier: 'synthetic|owner' });
const mutation = (name, args) => mc.mutation(makeFunctionReference(name), args);
const query = (name, args) => mc.query(makeFunctionReference(name), args);
const insert = (table, value) => mutation('qualificationFixture:insert', { table, value });
try {
  await execFile(join(bin, 'initdb'), ['-D', join(directory, 'data'), '-U', 'capability_admin', '--auth-local=trust', '--auth-host=trust', '--no-locale', '-E', 'UTF8']);
  await execFile(join(bin, 'pg_ctl'), ['-D', join(directory, 'data'), '-l', join(directory, 'log'), '-o', `-k ${directory} -h 127.0.0.1 -p 55497 -c shared_memory_type=mmap -c dynamic_shared_memory_type=posix`, '-w', 'start']); started = true;
  process.env.RELAY_TEST_DATABASE_URL = databaseUrl;
  const { freshDatabase, cleanupDatabase } = await import('../tests/helpers.ts'); cleanup = cleanupDatabase;
  const { accountId, principalId } = await freshDatabase();
  const signer = createLocalEd25519Signer('composed-synthetic'), resolver = { publicKeyForKeyId: async id => id === signer.keyId ? signer.publicKeyPem() : undefined };
  const nativeRuntime = await registerRuntimeClient({ accountId, actorPrincipalId: principalId, displayName: 'Isolated runner', selfDeclaredProduct: 'custom' }, signer);
  const capabilityName = 'resource.composed.mission';
  await registerCapabilityDefinition({ name: capabilityName, version: '1.0', domain: 'resource', description: 'Isolated admission qualification', effectClass: 'read', riskClass: 'low', resourceType: 'target', inputSchema: {}, outputSchema: {}, meteringDimensions: [] }, signer);
  await publishRelaySafetyPolicy({ name: 'composed-safety', rules: [{ id: 'bounded', effect: 'ALLOW', match: { capability: { name: capabilityName, version: '1.0' } }, reasonCode: 'ISOLATED_QUALIFICATION' }] }, signer);
  const agent = await createV2Agent({ accountId, ownerPrincipalId: principalId, name: 'Synthetic Sofie' }, signer);
  await issueAgentPassport({ accountId, agentId: agent.agentId, ownerPrincipalId: principalId, policy: { trustTier: 'HIGH_ASSURANCE', capabilityEligibility: [{ name: capabilityName, version: '1.0' }], policyReferences: ['composed-safety'], budgetReferences: [], allowedEnvironments: { providerIds: ['relay-managed'], minimumAssurance: 'managed-equivalent' }, dataAccess: [], expiresAt: new Date(Date.now() + 3600000).toISOString() } }, signer);
  const pair = generateKeyPairSync('ed25519');
  const bootstrap = await createWorkloadBootstrap({ accountId, agentId: agent.agentId, runtimeClientId: nativeRuntime.runtimeClientId, taskId: 'tsk_composed1', providerId: 'relay-managed', assurance: 'managed-equivalent', audience: 'composed-pep', publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }, signer);
  const workload = await exchangeWorkloadBootstrap({ accountId, secret: bootstrap.secret, proofSignature: sign(null, Buffer.from(bootstrap.challenge), pair.privateKey).toString('base64url') }, signer);
  const binding = { ...fixture.binding, ownerId: principalId, organizationId: accountId, agentId: agent.agentId, registryVersion: capabilityRegistry.version };
  await execFile(process.execPath, [fixture.cli, 'env', 'set', 'MC_CAPABILITY_BINDINGS_JSON', JSON.stringify([binding]), '--url', fixture.url, '--admin-key', fixture.admin], { env: process.env, cwd: dirname(process.argv[2]) }).catch(error => { throw Error(String(error.stderr ?? 'Isolated Convex configuration failed').replaceAll(fixture.admin, '[synthetic key]')); });
  const destination = { ...binding, accountId, capabilityNames: { 'enterprise.missions': capabilityName }, endpoint: `http://127.0.0.1:${fixture.sitePort}/capability-control/fence`, sourceKey: fixture.sourceKey, backendKey: fixture.backendKey };
  process.env.RELAY_CAPABILITY_ENVIRONMENT = 'qualification';
  process.env.RELAY_CAPABILITY_COORDINATION_JSON = JSON.stringify({ signer: fixture.relayKey, destinations: [destination] });
  await withTransaction(async tx => { await lockActiveAccount(tx, accountId); await advanceRelayPolicyFence(tx, accountId); });
  await flushRelayPolicyFences(accountId);
  server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const part of req) { body += part; if (body.length > 32768) throw Error('bounded request'); }
      const response = await POST(new Request('http://127.0.0.1/capability-fences', { method: 'POST', body, headers: { 'content-type': 'application/json' } }));
      res.writeHead(response.status, { 'content-type': 'application/json' }); res.end(await response.text());
    } catch { res.writeHead(503); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const relayEndpoint = `http://127.0.0.1:${server.address().port}/capability-fences`;
  admin = new pg.Pool({ connectionString: databaseUrl });
  for (const file of ['migration.sql', 'enforcement.sql', 'decisions.sql', 'ordering.sql'])
    await admin.query(await readFile(join(fixture.myeveRoot, 'docs/capability-control', file), 'utf8'));
  await admin.query('CREATE ROLE capability_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
  await admin.query('GRANT USAGE ON SCHEMA capability_control TO capability_runtime');
  await admin.query('GRANT SELECT ON ALL TABLES IN SCHEMA capability_control TO capability_runtime');
  await admin.query('GRANT INSERT,UPDATE ON capability_control.owner_state,capability_control.policy_changes,capability_control.policy_deliveries TO capability_runtime');
  await admin.query('GRANT INSERT ON capability_control.commands,capability_control.audit,capability_control.control_requests,capability_control.policy_decisions TO capability_runtime');
  await admin.query('GRANT EXECUTE ON FUNCTION capability_control.lock_admission_policy(text,text,text) TO capability_runtime');
  await admin.query('INSERT INTO capability_control.installations(id,organization_id,environment) VALUES($1,$2,$3)', [binding.installationId, accountId, 'qualification']);
  if (platformOwner) await admin.query(`INSERT INTO capability_control.platform_owner_bindings VALUES($1,$2,$3,'composed-platform',1,'synthetic-auth','synthetic-admin','synthetic-membership','synthetic-installation','synthetic-audit','ACTIVE',clock_timestamp()+interval '1 hour')`, [binding.installationId, accountId, principalId]);
  const facts = Object.fromEntries(capabilityRegistry.capabilities.map(item => [item.id, { supported: true, deployed: true, entitled: true, administrator: 'ALLOW', lifecycle: 'ACTIVE', setup: Object.fromEntries(item.setupRequirements.map(key => [key, true])), qualification: Object.fromEntries(item.qualificationRequirements.map(key => [key, 'QUALIFIED'])) }]));
  await admin.query(`INSERT INTO capability_control.evidence VALUES($1,$2,$3,$4,$5,clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 hour','synthetic-qualification')`, [binding.installationId, accountId, principalId, capabilityRegistry.version, facts]);
  await admin.query(`INSERT INTO capability_control.relay_agent_evidence VALUES($1,$2,$3,$4,1,$5,'ACTIVE',clock_timestamp()+interval '1 hour','native-relay-passport-fixture')`, [binding.installationId, principalId, accountId, agent.agentId, JSON.stringify(capabilityRegistry.capabilities.map(item => item.id))]);
  const publicKey = { ...fixture.backendKey.jwk }; delete publicKey.d; delete publicKey.key_ops;
  await admin.query('INSERT INTO capability_control.policy_destinations VALUES($1,$2,$3,$4,$5,$6,$7)', [binding.installationId, principalId, binding.backendId, binding.incarnation, binding.enrollmentVersion, fixture.backendKey.keyId, publicKey]);
  runtime = new pg.Pool({ connectionString: 'postgresql://capability_runtime@127.0.0.1:55497/postgres' });
  const scope = { ownerId: principalId, organizationId: accountId, installationId: binding.installationId, agentId: agent.agentId, environment: 'qualification' };
  const deliver = () => propagateCapabilityPolicy(runtime, scope, fixture.sourceKey, relayEndpoint);
  const store = new CapabilityStore(runtime, { id: binding.installationId, environment: 'qualification' }, { ownerId: principalId, source: 'settings' }, deliver);
  const sofie = new CapabilityStore(runtime, { id: binding.installationId, environment: 'qualification' }, { ownerId: principalId, source: 'sofie' }, deliver);
  const command = async operation => store.command({ requestId: randomUUID(), expectedRevision: (await store.inspect()).revision, capabilityId: 'missioncontrol', operation });
  const transaction = async run => { const c = await runtime.connect(); try { await c.query('BEGIN'); const result = await run(c); await c.query('COMMIT'); return result; } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); } };
  async function mission() {
    const now = Date.now(), { tenantId, projectId, ownerMemberId, teamId } = fixture;
    const missionId = await insert('missions', { tenantId, projectId, ownerMemberId, owningTeamId: teamId, title: 'Composed qualification', objective: 'No paid execution', state: 'READY', budgetUsd: 0, spentUsd: 0, correctiveIterations: 0, maxCorrectiveIterations: 1, maxReadOnlyConcurrency: 1, executionPolicy: 'SERIAL_MUTATIONS', stopCondition: 'qualification only', createdAt: now, updatedAt: now });
    await insert('missionAssignments', { tenantId, projectId, missionId, memberId: ownerMemberId, teamId, role: 'OWNER', active: true, activeFrom: now, createdAt: now, updatedAt: now });
    await insert('workOrders', { tenantId, projectId, missionId, ownerMemberId, owningTeamId: teamId, title: 'Bounded qualification', desiredOutcome: 'No paid execution', priority: 3, riskLevel: 'LOW', acceptanceCriteria: [], state: 'READY', verificationStatus: 'PENDING', approvalStatus: 'APPROVED', releasedAt: now, createdAt: now, updatedAt: now });
    return missionId;
  }
  async function proposal(missionId) {
    const native = await mc.action(makeFunctionReference('capabilityChallenges:create'), { missionId, idempotencyKey: randomUUID(), budgetMicros: 0 });
    const source = await transaction(c => issueBackendOrderedPermit(c, native.challenge, scope, binding.backendId, fixture.sourceKey));
    const material = { capability: { name: capabilityName, version: '1.0' }, resource: { type: 'target', ids: [missionId], attributes: { accountId } }, parameters: { capabilityAdmissionDigest: await policyMessageHash(JSON.parse(source.message)) } };
    const action = { schemaVersion: 'relay.action-intent.v2', id: 'act_' + randomUUID().replaceAll('-', ''), accountId, agentId: agent.agentId, runtimeClientId: nativeRuntime.runtimeClientId, taskId: 'tsk_composed1', ...material, idempotencyKey: randomUUID(), createdAt: new Date().toISOString(), canonicalHash: canonicalHash(material) };
    await evaluatePolicy({ accountId, action, resourceResolver: { resolveOwnership: async () => ({ name: 'resource.account_id', value: accountId, authoritative: true, observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), sourceRevision: 'composed' }) } }, signer);
    const lease = await issueCapabilityLease({ accountId, action, workloadId: workload.workloadId, workloadIdentityToken: workload.token, audience: 'composed-pep', maxCalls: 1, remoteAdmission: source }, signer, resolver);
    return { ...native.nativeArgs, capabilityPermits: { myeve: source, relay: lease.remotePermit } };
  }
  assert.equal((await store.inspect()).capabilities.filter(item => item.preference === 'ENABLED').length, platformOwner ? 36 : 5);
  if (!platformOwner) for (const capabilityId of ['work', 'enterprise.missions']) await store.command({ requestId: randomUUID(), expectedRevision: (await store.inspect()).revision, capabilityId, operation: 'enable' });
  await command('enable'); assert.equal((await store.inspect()).propagation.status, 'ACKNOWLEDGED');
  const first = await mission(), second = await mission();
  const admitted = await proposal(first), stale = await proposal(second);
  assert.equal((await mutation('missions:start', admitted)).created, true);
  assert.equal((await mutation('missions:start', admitted)).created, false);
  pass('MyEve persists enable; native Relay propagates exact ACK; backend challenge and native lease authorize exact-owner Mission once');
  async function disabled(_view, cookies) {
    let sofieView = await sofie.inspect();
    if (cookies) {
      const { authenticateWebPrincipal } = await import(join(fixture.myeveRoot, 'apps/eve/lib/web-auth.ts'));
      const principal = await authenticateWebPrincipal(new Request('http://localhost:3318/api/capability-control', {
        headers: { cookie: cookies.map(item => `${item.name}=${item.value}`).join('; ') } }), { ...process.env, NODE_ENV: 'production' });
      assert.equal(principal.id, principalId);
      const { inspectOwnerCapabilities } = await import(join(fixture.myeveRoot, 'apps/eve/lib/capability-control/sofie.ts'));
      sofieView = await inspectOwnerCapabilities({ session: { auth: { current: { principalId: principal.id, principalType: 'user',
        authenticator: 'myeve-web-session', issuer: 'myeve', attributes: { owner: 'true', myeveCapabilityOwner: 'signed-session' } } } } });
    }
    assert.equal(sofieView.capabilities.find(item => item.id === 'missioncontrol').preference, 'DISABLED');
    assert.equal((await store.inspect()).propagation.status, 'ACKNOWLEDGED');
    await assert.rejects(mutation('missions:start', stale), /CAPABILITY/);
    await assert.rejects(proposal(second), /POLICY_BLOCKED/);
    assert.equal((await mutation('missions:start', { missionId: first, idempotencyKey: admitted.idempotencyKey })).mission.state, 'IN_PROGRESS');
    pass('disable reaches real receiver, denies stale and fresh admissions, preserves admitted Mission and authenticated Sofie readback');
  }
  async function enabled() {
    assert.equal((await store.inspect()).propagation.status, 'ACKNOWLEDGED');
    assert.equal((await mutation('missions:start', await proposal(second))).created, true);
  }
  async function revoked() {
    assert.equal((await store.inspect()).propagation.status, 'ACKNOWLEDGED');
    await assert.rejects(proposal(await mission()), /CONTROL_PENDING|POLICY_BLOCKED/);
    const view = await sofie.inspect();
    assert.equal(view.capabilities.find(item => item.id === 'missioncontrol').control, 'REVOKE_REQUESTED');
    assert.equal(view.activeWork.status, 'UNKNOWN');
    assert.equal((await query('qualificationFixture:read', { id: first })).state, 'IN_PROGRESS');
    assert.deepEqual(await flushOwnerPolicyFences(accountId), []);
    const controls = await query('qualificationFixture:rows', { table: 'capabilityWorkControls' });
    assert(controls.some(item => item.scope.includes(principalId) && item.operation === 'revoke' && item.capabilityId === 'missioncontrol'));
    pass('re-enable requires fresh proof; revoke commits durable active-Work control and never reports a resource stopped');
  }
  if (process.env.CAPABILITY_COMPOSED_BROWSER === '1') {
    const configuration = { MYEVE_CAPABILITY_CONTROL_ENABLED: 'true', MYEVE_CAPABILITY_ENVIRONMENT: 'qualification',
      MYEVE_CAPABILITY_INSTALLATION_ID: binding.installationId, MYEVE_CAPABILITY_DATABASE_URL: 'postgresql://capability_runtime@127.0.0.1:55497/postgres',
      MYEVE_OWNER_ID: principalId, MYEVE_ACCESS_PASSWORD: 'synthetic-composed-password', MYEVE_SESSION_SECRET: 'synthetic-composed-session-secret-000000000',
      MYEVE_CAPABILITY_ORIGIN: 'http://localhost:3318', MYEVE_CAPABILITY_PROPAGATION_JSON: JSON.stringify({ signer: fixture.sourceKey, relayEndpoint }) };
    Object.assign(process.env, configuration);
    closeEve = (await import(join(fixture.myeveRoot, 'apps/eve/lib/capability-control/runtime.ts'))).closeCapabilityDatabase;
    const { qualifyComposedBrowser } = await import(join(fixture.myeveRoot, 'apps/eve/scripts/qualify-capability-composed-browser.mjs'));
    checks.push(...await qualifyComposedBrowser({ root: fixture.myeveRoot, configuration, platformOwner,
      onDisabled: disabled, onEnabled: enabled, onRevoked: revoked }));
  } else {
    await command('disable'); await disabled(); await command('enable'); await enabled(); await command('revoke'); await revoked();
  }
  await mkdir('docs/capability-control/evidence', { recursive: true });
  await writeFile(`docs/capability-control/evidence/composed-${platformOwner ? 'platform' : 'ordinary'}.json`, JSON.stringify({ status: 'PASS', checks, scope: 'real PostgreSQL + native Relay APIs/HTTP route + real Convex Mission admission', activeResourceStop: 'PENDING_BACKEND', paidOperations: 0 }, null, 2) + '\n');
} catch (error) {
  console.error(await readFile(join(directory, 'log'), 'utf8').catch(() => 'Disposable PostgreSQL log unavailable.'));
  throw error;
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await closeEve?.();
  await runtime?.end(); await admin?.end(); await cleanup?.();
  if (started) await execFile(join(bin, 'pg_ctl'), ['-D', join(directory, 'data'), '-m', 'immediate', '-w', 'stop']);
  await rm(directory, { recursive: true, force: true });
}
