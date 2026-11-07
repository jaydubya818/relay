import { generateKeyPairSync, sign } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { agentPassports, agents, capabilityDefinitions, policyBundles, runtimeClients } from '@/lib/db/schema';
import { RelayError } from '@/lib/errors';
import { canonicalHash } from '@/lib/v2/contracts';
import type { AuditSigner } from '@/lib/v2/evidence/crypto';
import { completePasswordStepUp, createStepUpChallenge, requireMembership } from '@/lib/v2/identity';
import { createWorkloadBootstrap, exchangeWorkloadBootstrap } from '@/lib/v2/leases';
import { activateV2Agent, createV2Agent, issueAgentPassport } from '@/lib/v2/passports';
import { activateAccountPolicy, registerCapabilityDefinition, stageAccountPolicy } from '@/lib/v2/policy/service';
import { registerRuntimeClient } from '@/lib/v2/runtime-clients';

/**
 * Hosted Sofie private-beta enrollment (owner only, password step-up). One call per installation creates, or finds, the
 * `resource.myfactory.admit` capability, an account ALLOW policy, the runtime client, the Agent + Passport, records the
 * installation's P-256 permit PUBLIC key, and issues a fresh workload token. Re-running returns the same ids and only a new
 * workload token (the runtime-client credential is shown once, at creation). Secrets are returned to the caller and never logged.
 */
export const HOSTED_CAPABILITY = { name: 'resource.myfactory.admit', version: '1.0' } as const;
const p256PublicJwk = z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string().regex(/^[A-Za-z0-9_-]{43}$/), y: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export const hostedEnrollmentCommand = z.object({
  installationId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  permitPublicKey: z.object({ keyId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/), jwk: p256PublicJwk }).strict(),
  password: z.string().max(1024).optional(),
}).strict();
type Operator = { accountId: string; principalId: string };

export async function installHostedEnrollment(operator: Operator, value: unknown, signer: AuditSigner) {
  await requireMembership({ ...operator, allowedRoles: ['OWNER'] });
  const command = hostedEnrollmentCommand.parse(value);
  if (!command.password) throw new RelayError('CAPABILITY_DENIED', 'Password step-up required.', undefined, 403);
  const inst = command.installationId, permitKey = command.permitPublicKey;
  const actionHash = canonicalHash({ installationId: inst, permitPublicKey: permitKey });
  const stepUp = async (actionClass: string, hash: string) => {
    const challenge = await createStepUpChallenge({ ...operator, actionClass, actionHash: hash, authenticationMethod: 'password' });
    return completePasswordStepUp({ ...operator, secret: challenge.secret, password: command.password!, actionClass, actionHash: hash });
  };
  await stepUp('enrollment.install', actionHash);

  const agentName = `Sofie hosted (${inst})`, clientName = `MyEve hosted (${inst})`, policyName = `sofie-hosted-${inst}`;
  const [existingAgent] = await db().select().from(agents).where(and(eq(agents.accountId, operator.accountId), eq(agents.name, agentName))).limit(1);
  if (existingAgent) {
    const recorded = JSON.parse(existingAgent.description || '{}');
    if (canonicalHash(recorded.permitPublicKey ?? null) !== canonicalHash(permitKey)) throw new RelayError('INVALID_INPUT', 'Installation is enrolled with a different permit key.', undefined, 409);
  }
  // Capability definition (global catalog entry; created once).
  const [capability] = await db().select({ id: capabilityDefinitions.id }).from(capabilityDefinitions)
    .where(and(eq(capabilityDefinitions.name, HOSTED_CAPABILITY.name), eq(capabilityDefinitions.version, HOSTED_CAPABILITY.version))).limit(1);
  if (!capability) await registerCapabilityDefinition({ ...HOSTED_CAPABILITY, domain: 'resource', description: 'Hosted Sofie MyFactory admission reference',
    effectClass: 'read', riskClass: 'low', resourceType: 'target', inputSchema: {}, outputSchema: {}, meteringDimensions: [] }, signer);
  // Account ALLOW policy, activated under its own password step-up (same mechanism as policy activation).
  let [policy] = await db().select({ id: policyBundles.id }).from(policyBundles).where(and(eq(policyBundles.accountId, operator.accountId),
    eq(policyBundles.name, policyName), eq(policyBundles.status, 'ACTIVE'))).orderBy(desc(policyBundles.version)).limit(1);
  if (!policy) {
    const staged = await stageAccountPolicy({ accountId: operator.accountId, actorPrincipalId: operator.principalId, name: policyName, layer: 'ACCOUNT',
      rules: [{ id: `hosted-${inst}-myfactory`, effect: 'ALLOW', match: { capability: HOSTED_CAPABILITY }, reasonCode: 'ALLOWED_BY_POLICY' }] }, signer);
    const [row] = await db().select({ id: policyBundles.id, hash: policyBundles.bundleHash }).from(policyBundles).where(eq(policyBundles.id, staged.bundleId)).limit(1);
    const activation = await stepUp('policy.activate', row!.hash);
    await activateAccountPolicy({ accountId: operator.accountId, actorPrincipalId: operator.principalId, bundleId: row!.id, stepUpChallengeId: activation.id }, signer);
    policy = { id: row!.id };
  }
  // Runtime client: its credential is returned only when it is created here.
  let credential: string | null = null;
  let [client] = await db().select({ id: runtimeClients.id }).from(runtimeClients).where(and(eq(runtimeClients.accountId, operator.accountId),
    eq(runtimeClients.displayName, clientName), isNull(runtimeClients.revokedAt))).limit(1);
  if (!client) {
    const created = await registerRuntimeClient({ accountId: operator.accountId, actorPrincipalId: operator.principalId, displayName: clientName, selfDeclaredProduct: 'custom' }, signer);
    client = { id: created.runtimeClientId }; credential = created.secret;
  }
  // Agent + Passport; the agent record carries the installation's permit PUBLIC key (no secret).
  let agentId = existingAgent?.id;
  if (!agentId) {
    agentId = (await createV2Agent({ accountId: operator.accountId, ownerPrincipalId: operator.principalId, name: agentName,
      description: JSON.stringify({ installationId: inst, permitPublicKey: permitKey }) }, signer)).agentId;
  }
  const [passport] = await db().select({ id: agentPassports.id }).from(agentPassports).where(and(eq(agentPassports.accountId, operator.accountId),
    eq(agentPassports.agentId, agentId), eq(agentPassports.status, 'ACTIVE'))).limit(1);
  if (!passport) {
    await issueAgentPassport({ accountId: operator.accountId, agentId, ownerPrincipalId: operator.principalId, policy: { trustTier: 'HIGH_ASSURANCE',
      capabilityEligibility: [HOSTED_CAPABILITY], policyReferences: [policyName], budgetReferences: [],
      allowedEnvironments: { providerIds: ['relay-managed'], minimumAssurance: 'managed-equivalent' }, dataAccess: [],
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() } }, signer);
    await activateV2Agent({ accountId: operator.accountId, agentId, actorPrincipalId: operator.principalId }, signer);
  }
  // Fresh workload token (short-lived; re-run to renew). The proof key is ephemeral and discarded.
  const pair = generateKeyPairSync('ed25519'), taskId = `tsk_hosted${inst.replace(/-/g, '')}enroll`.slice(0, 64);
  const bootstrap = await createWorkloadBootstrap({ accountId: operator.accountId, agentId, runtimeClientId: client.id, taskId, providerId: 'relay-managed',
    assurance: 'managed-equivalent', audience: 'relay-pep', publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }, signer);
  const workload = await exchangeWorkloadBootstrap({ accountId: operator.accountId, secret: bootstrap.secret,
    proofSignature: sign(null, Buffer.from(bootstrap.challenge), pair.privateKey).toString('base64url') }, signer);
  return { installationId: inst, accountId: operator.accountId, agentId, runtimeClientId: client.id, policyBundleId: policy.id, taskId,
    capability: HOSTED_CAPABILITY, permitKeyId: permitKey.keyId, workloadId: workload.workloadId, workloadExpiresAt: workload.expiresAt,
    workloadToken: workload.token, runtimeClientCredential: credential };
}
