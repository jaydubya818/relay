import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { policyBundles } from '@/lib/db/schema';
import { RelayError } from '@/lib/errors';
import type { AuditSigner } from '@/lib/v2/evidence/crypto';
import { completePasswordStepUp, createStepUpChallenge, requireMembership } from '@/lib/v2/identity';
import { issueAgentPassport, passportPolicySchema, revokeAgentPassport } from '@/lib/v2/passports';
import { policyRuleSchema } from './contracts';
import { activateAccountPolicy, retireAccountPolicy, stageAccountPolicy } from './service';

const reference = z.string().trim().min(1).max(255);
export const capabilityAdministrationCommand = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('stage_policy'), name: reference,
    layer: z.enum(['ACCOUNT', 'RESOURCE', 'TASK', 'DYNAMIC_RISK']), rules: z.array(policyRuleSchema).min(1).max(1000) }).strict(),
  z.object({ operation: z.enum(['activate_policy', 'retire_policy']), bundleId: reference, password: z.string().min(1).max(1024) }).strict(),
  z.object({ operation: z.literal('issue_passport'), agentId: reference,
    expectedVersion: z.number().int().nonnegative(), policy: passportPolicySchema }).strict(),
  z.object({ operation: z.literal('revoke_passport'), agentId: reference, passportId: reference }).strict(),
]);
type Operator = { accountId: string; principalId: string };

export async function inspectCapabilityAdministration(operator: Operator) {
  await requireMembership({ ...operator, allowedRoles: ['OWNER', 'ADMIN'] });
  return db().select({ id: policyBundles.id, name: policyBundles.name, layer: policyBundles.layer,
    version: policyBundles.version, status: policyBundles.status, bundleHash: policyBundles.bundleHash,
    rules: policyBundles.rules }).from(policyBundles).where(eq(policyBundles.accountId, operator.accountId))
    .orderBy(desc(policyBundles.createdAt), desc(policyBundles.id)).limit(100);
}

/** Transport for existing Relay policy and Passport commands. Owner preferences remain in MyEve. */
export async function manageCapabilityAdministration(operator: Operator, value: unknown, signer: AuditSigner) {
  await requireMembership({ ...operator, allowedRoles: ['OWNER', 'ADMIN'] });
  const command = capabilityAdministrationCommand.parse(value);
  if (command.operation === 'stage_policy') return stageAccountPolicy({ accountId: operator.accountId,
    actorPrincipalId: operator.principalId, name: command.name, layer: command.layer, rules: command.rules }, signer);
  if (command.operation === 'issue_passport') return issueAgentPassport({ accountId: operator.accountId,
    ownerPrincipalId: operator.principalId, agentId: command.agentId, expectedVersion: command.expectedVersion, policy: command.policy }, signer);
  if (command.operation === 'revoke_passport') return revokeAgentPassport({ accountId: operator.accountId,
    ownerPrincipalId: operator.principalId, agentId: command.agentId, passportId: command.passportId }, signer);
  const [bundle] = await db().select({ id: policyBundles.id, hash: policyBundles.bundleHash }).from(policyBundles)
    .where(and(eq(policyBundles.accountId, operator.accountId), eq(policyBundles.id, command.bundleId))).limit(1);
  if (!bundle) throw new RelayError('INVALID_INPUT', 'Account policy not found.', undefined, 404);
  const actionClass = command.operation === 'activate_policy' ? 'policy.activate' : 'policy.retire';
  const challenge = await createStepUpChallenge({ ...operator, actionClass, actionHash: bundle.hash, authenticationMethod: 'password' });
  const stepUp = await completePasswordStepUp({ ...operator, secret: challenge.secret, password: command.password, actionClass, actionHash: bundle.hash });
  const input = { accountId: operator.accountId, actorPrincipalId: operator.principalId, bundleId: bundle.id, stepUpChallengeId: stepUp.id };
  if (command.operation === 'activate_policy') await activateAccountPolicy(input, signer);
  else await retireAccountPolicy(input, signer);
  return { bundleId: bundle.id, bundleHash: bundle.hash, status: command.operation === 'activate_policy' ? 'ACTIVE' : 'RETIRED' };
}
