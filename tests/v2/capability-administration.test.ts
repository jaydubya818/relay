import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { accountMemberships, auditRecords } from '@/lib/db/schema';
import { createLocalEd25519Signer } from '@/lib/v2/evidence';
import { createV2Agent, requireCurrentAgentPassport } from '@/lib/v2/passports';
import { capabilityAdministrationCommand, inspectCapabilityAdministration, manageCapabilityAdministration } from '@/lib/v2/policy/administration';
import { cleanupDatabase, freshDatabase, secondAccount } from '../helpers';

const password = 'correct-horse-battery-staple';
const stage = { operation: 'stage_policy', name: 'capability-testing', layer: 'ACCOUNT', rules: [
  { id: 'deny-effect', effect: 'DENY', reasonCode: 'ADMINISTRATOR_DENIED', match: { capability: { name: 'communications.message.send', version: '1.0' } } },
] };
const policy = { trustTier: 'VERIFIED', capabilityEligibility: [{ name: 'communications.message.send', version: '1.0' }], policyReferences: [], budgetReferences: [],
  allowedEnvironments: { providerIds: ['relay-managed'], minimumAssurance: 'managed-equivalent' }, dataAccess: [], expiresAt: '2099-01-01T00:00:00.000Z' };

describe('capability administration uses canonical Relay contracts', () => {
  afterEach(cleanupDatabase);
  it('rejects owner preferences, actor substitution and safety-layer authoring', () => {
    for (const extra of [{ ownerId: 'foreign' }, { accountId: 'foreign' }, { principalId: 'foreign' }, { preferences: { myfactory: 'ENABLED' } }, { layer: 'RELAY_SAFETY' }])
      expect(capabilityAdministrationCommand.safeParse({ ...stage, ...extra }).success).toBe(false);
  });
  it('stages, step-up activates and retires the existing signed account bundle', async () => {
    const actor = await freshDatabase(), signer = createLocalEd25519Signer();
    const result = await manageCapabilityAdministration(actor, stage, signer);
    expect(result).toHaveProperty('bundleHash');
    const bundleId = (result as { bundleId: string }).bundleId;
    await expect(manageCapabilityAdministration(actor, { operation:'activate_policy',bundleId,password:'wrong' }, signer)).rejects.toMatchObject({ status:401 });
    expect(await manageCapabilityAdministration(actor, { operation:'activate_policy',bundleId,password }, signer)).toMatchObject({ status:'ACTIVE' });
    expect(await manageCapabilityAdministration(actor, { operation:'retire_policy',bundleId,password }, signer)).toMatchObject({ status:'RETIRED' });
    const audit = await db().select().from(auditRecords).where(eq(auditRecords.accountId,actor.accountId));
    expect(audit.map(row=>row.eventType)).toEqual(expect.arrayContaining(['policy.staged','policy.activated','policy.retired']));
  });
  it('denies cross-account and revoked administrative membership', async () => {
    const actor = await freshDatabase(), signer = createLocalEd25519Signer();
    const other = await secondAccount();
    await expect(manageCapabilityAdministration({ ...actor,accountId:other },stage,signer)).rejects.toMatchObject({ status:403 });
    await db().update(accountMemberships).set({status:'REMOVED'}).where(eq(accountMemberships.principalId,actor.principalId));
    await expect(manageCapabilityAdministration(actor,stage,signer)).rejects.toMatchObject({status:403});
    await expect(inspectCapabilityAdministration(actor)).rejects.toMatchObject({status:403});
  });
  it('rejects activating an older staged version after concurrent policy changes', async () => {
    const actor = await freshDatabase(), signer = createLocalEd25519Signer();
    const first = await manageCapabilityAdministration(actor,stage,signer) as { bundleId:string };
    await manageCapabilityAdministration(actor,stage,signer);
    await expect(manageCapabilityAdministration(actor,{operation:'activate_policy',bundleId:first.bundleId,password},signer)).rejects.toMatchObject({status:409});
  });
  it('version-fences agent eligibility and revokes the exact current Passport', async () => {
    const actor = await freshDatabase(), signer = createLocalEd25519Signer();
    const {agentId} = await createV2Agent({accountId:actor.accountId,ownerPrincipalId:actor.principalId,name:'Capability agent'},signer);
    const command={operation:'issue_passport',agentId,expectedVersion:0,policy};
    const attempts=await Promise.allSettled([manageCapabilityAdministration(actor,command,signer),manageCapabilityAdministration(actor,command,signer)]);
    expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const winner=attempts.find(r=>r.status==='fulfilled')!;
    const passportId=(winner as {value:{passport:{passportId:string}}}).value.passport.passportId;
    await expect(manageCapabilityAdministration(actor,{operation:'revoke_passport',agentId,passportId:'stale'},signer)).rejects.toMatchObject({status:404});
    expect(await manageCapabilityAdministration(actor,{operation:'revoke_passport',agentId,passportId},signer)).toMatchObject({revoked:true});
    await expect(requireCurrentAgentPassport(actor.accountId,agentId,signer)).rejects.toBeDefined();
  });
});
