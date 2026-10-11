// Compatibility only: execute the pinned owner's wire implementation, never a local authority copy.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import ts from 'typescript';

const sourceSha = 'aec9d9adb4c057f4bbd85a3ec27155d14fe6f24b';
const wireHash = '4b198d32e1dcdc930c2658291906ebf72601e144596f3090202a3e7ee708d606';
const source = execFileSync('git', ['show', `${sourceSha}:lib/v2/policy/ordering-wire.ts`], { encoding: 'utf8' });
assert.equal(createHash('sha256').update(source).digest('hex'), wireHash);
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const wire = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const signer = { keyId: 'synthetic-wire-only', jwk: await crypto.subtle.exportKey('jwk', pair.privateKey) };
const verifier = { keyId: signer.keyId, jwk: await crypto.subtle.exportKey('jwk', pair.publicKey) };
const identity = { authority: 'myeve', ownerId: 'synthetic-owner', organizationId: 'synthetic-tenant', installationId: 'synthetic-installation',
  backendId: 'synthetic-wire-only', incarnation: 'synthetic-incarnation', enrollmentVersion: 1, version: 1, policyId: 'synthetic-policy' };
const material = { provider: 'composio', toolkit: 'github', connectionId: 'synthetic-connection', tool: 'GITHUB_SYNTHETIC_READ',
  descriptorDigest: 'a'.repeat(64), argumentsDigest: 'b'.repeat(64), effect: 'read', leaseId: 'synthetic-lease', approvalId: null, ...identity };
const actionDigest = await wire.admissionActionDigest(material);
const challenge = { ...identity, kind: 'CHALLENGE', referenceId: randomUUID(), capabilityId: 'connected-apps',
  registryVersion: 'synthetic-wire-only', agentId: 'synthetic-agent', workId: 'synthetic-work', missionId: 'synthetic-wire-mission',
  workGeneration: 1, actionDigest, budgetMicros: 0, issuedAt: Date.now(), expiresAt: Date.now() + 20_000 };
const signed = await wire.signPolicyMessage(challenge, signer);
assert.deepEqual(await wire.verifyPolicyMessage(signed, verifier), challenge);
const checks = ['pinned-owner-wire-digest', 'signed-challenge-roundtrip'];
for (const field of Object.keys(identity)) {
  assert.throws(() => wire.assertPolicyIdentity({ ...identity, [field]: 'substituted' }, identity));
}
checks.push('all-nine-identity-fields-reject-substitution');
for (const field of Object.keys(material)) {
  assert.notEqual(await wire.admissionActionDigest({ ...material, [field]: 'substituted' }), actionDigest);
}
checks.push('full-integration-material-changes-action-digest');
for (const invalid of [{ ...challenge, allow: true }, { ...challenge, actionDigest: `sha256:${actionDigest}` },
  { ...challenge, missionId: undefined }, { ...challenge, expiresAt: challenge.issuedAt + 30_001 }]) {
  assert.throws(() => wire.parsePolicyMessage(invalid));
}
checks.push('strict-parser-and-lifetime-bounds');
await assert.rejects(wire.verifyPolicyMessage({ ...signed, message: signed.message.replace('synthetic-agent', 'foreign-agent') }, verifier));
await assert.rejects(wire.verifyPolicyMessage({ ...signed, keyId: 'foreign-key' }, verifier));
checks.push('tampering-and-wrong-key-rejected');
const fence = { ...identity, kind: 'FENCE', capabilityId: 'connected-apps', operation: 'revoke' };
const ack = { ...identity, kind: 'FENCE_ACK', fenceHash: await wire.policyMessageHash(fence) };
assert.equal((await wire.verifyPolicyMessage(await wire.signPolicyMessage(ack, signer), verifier)).kind, 'FENCE_ACK');
assert.notEqual(await wire.policyMessageHash({ ...fence, operation: 'enable' }), ack.fenceHash);
checks.push('ack-binds-exact-fence-not-admission');
// A signature verifier deliberately does not read policy state or consume Work/leases.
const expired = { ...challenge, issuedAt: 1, expiresAt: 2 };
assert.deepEqual(await wire.verifyPolicyMessage(await wire.signPolicyMessage(expired, signer), verifier), expired);
checks.push('signature-alone-demonstrably-not-fresh-admission');
console.log(JSON.stringify({ status: 'PASS', qualification: 'WIRE_COMPATIBILITY_ONLY', sourceSha, wireHash, checks,
  receivingAdmission: 'UNAVAILABLE', providerExecutions: 0, productionActivation: false }, null, 2));
