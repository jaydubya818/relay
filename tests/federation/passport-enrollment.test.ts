import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentPassports, capabilityDefinitions, capabilityGrants, federationGrants, principals, accountMemberships } from "@/lib/db/schema";
import { createAgent } from "@/lib/agents";
import { id } from "@/lib/ids";
import { createLocalEd25519Signer, createLocalRsaKeyWrapper } from "@/lib/v2/evidence/crypto";
import { requireCurrentAgentPassport, issueAgentPassport, revokeAgentPassport, verifyAgentPassport } from "@/lib/v2/passports";
import { manageMessageEnrollment, readMessageEnrollment } from "@/lib/v2/federation/enrollment";
import { provisionFederationCapabilities } from "@/lib/v2/federation/capabilities";
import { registerFederationAgent, createFederationGrant } from "@/lib/v2/federation/registry";
import { authenticateFederationAgent, submitFederationRequest } from "@/lib/v2/federation/service";
import { executeFederationCommand } from "@/lib/v2/federation/api";
import { suspendPrincipal } from "@/lib/v2/identity";
import { canonicalHash } from "@/lib/v2/contracts";
import { publishRelaySafetyPolicy } from "@/lib/v2/policy";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

const capabilities = [{ name: "message.send" as const, version: "1.0" }, { name: "message.receive" as const, version: "1.0" }];
const expiry = () => new Date(Date.now() + 3600000).toISOString();
async function fixture() {
  const owner = await freshDatabase(), signer = createLocalEd25519Signer("passport-test-key");
  const agent = await createAgent(owner.accountId, { name: "Synthetic messaging Agent", capabilities: [] });
  await provisionFederationCapabilities(signer);
  await registerFederationAgent(owner, { agentId: agent.agentId, platform: "qualification", capabilities, discovery: "HIDDEN" }, signer);
  const enroll = (expectedVersion = 0, expiresAt = expiry()) => manageMessageEnrollment(owner, agent.agentId, { operation: "issue", expectedVersion, expiresAt }, signer);
  const bindings = { signer, keyWrapper: createLocalRsaKeyWrapper(), issuer: "https://relay.local" };
  return { owner, signer, agent, enroll, bindings };
}
async function issued(f: Awaited<ReturnType<typeof fixture>>) {
  await f.enroll();
  return requireCurrentAgentPassport(f.owner.accountId, f.agent.agentId, f.signer);
}
afterEach(async () => { vi.restoreAllMocks(); await cleanupDatabase(); });

describe("explicit canonical message Passport enrollment", () => {
  it("regresses missing-Passport production enrollment without granting capabilities", async () => {
    const f = await fixture();
    expect(await readMessageEnrollment(f.owner, f.agent.agentId)).toMatchObject({ version: 0, status: "NOT_ENROLLED" });
    await expect(authenticateFederationAgent(f.agent.credential, f.signer)).rejects.toMatchObject({ status: 401 });
    const bundle = await issued(f);
    expect(verifyAgentPassport(bundle, await f.signer.publicKeyPem())).toBe(true);
    expect(bundle.passport).toMatchObject({ issuer: "https://relay.local", agentId: f.agent.agentId, owner: { accountId: f.owner.accountId, principalId: f.owner.principalId }, version: 1, trustTier: "REGISTERED", signingKey: { id: f.signer.keyId, version: f.signer.keyId, purpose: "passport", algorithm: "Ed25519" }, capabilityEligibility: capabilities, policyReferences: [], budgetReferences: [], dataAccess: [] });
    expect(await authenticateFederationAgent(f.agent.credential, f.signer)).toMatchObject({ ownerId: f.owner.accountId, agentId: f.agent.agentId });
    expect(await db().select().from(capabilityGrants)).toHaveLength(0);
    expect(await db().select().from(federationGrants)).toHaveLength(0);
    await expect(authenticateFederationAgent(JSON.stringify(bundle), f.signer)).rejects.toMatchObject({ status: 401 });
  });
  it("denies another owner, an unregistered Agent and caller-supplied authority", async () => {
    const f = await fixture();
    const other = { accountId: await secondAccount(), principalId: id("prn") };
    await db().insert(principals).values({ id: other.principalId, type: "HUMAN", displayName: "Other" });
    await db().insert(accountMemberships).values({ ...other, role: "OWNER" });
    const command = { operation: "issue", expectedVersion: 0, expiresAt: expiry() };
    await expect(manageMessageEnrollment(other, f.agent.agentId, command, f.signer)).rejects.toMatchObject({ status: 404 });
    await expect(readMessageEnrollment(other, f.agent.agentId)).rejects.toMatchObject({ status: 404 });
    const unregistered = await createAgent(f.owner.accountId, { name: "Not registered", capabilities: [] });
    await expect(manageMessageEnrollment(f.owner, unregistered.agentId, command, f.signer)).rejects.toMatchObject({ status: 404 });
    await expect(manageMessageEnrollment(f.owner, f.agent.agentId, { ...command, trustTier: "HIGH_ASSURANCE" }, f.signer)).rejects.toBeDefined();
    await expect(f.enroll(0, "2099-01-01T00:00:00.000Z")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await db().select().from(agentPassports)).toHaveLength(0);
  });
  it.each(["issuer", "owner", "agent", "signature", "keyVersion", "keyId", "payloadHash"])("rejects altered %s and binds supplied Passport to authenticated Agent", async field => {
    const f = await fixture(), bundle = await issued(f), altered = structuredClone(bundle);
    if (field === "issuer") altered.passport.issuer = "https://untrusted.invalid";
    if (field === "owner") altered.passport.owner.accountId = "acct_someone_else";
    if (field === "agent") altered.passport.agentId = "agt_someone_else";
    if (field === "signature") altered.signature = "a".repeat(86);
    if (field === "keyVersion") altered.passport.signingKey!.version = "another-version";
    if (field === "keyId") altered.signingKeyId = "another-key";
    if (field === "payloadHash") altered.payloadHash = "a".repeat(64);
    await expect(executeFederationCommand(f.agent.credential, { operation: "passport.verify", input: altered }, f.bindings)).rejects.toMatchObject({ status: 401 });
    expect(await executeFederationCommand(f.agent.credential, { operation: "passport.verify", input: bundle }, f.bindings)).toMatchObject({ valid: true, agentId: f.agent.agentId });
  });
  it("rejects wrong-Agent Passport despite the same owner", async () => {
    const f = await fixture(), bundle = await issued(f);
    const sibling = await createAgent(f.owner.accountId, { name: "Sibling", capabilities: [] });
    await registerFederationAgent(f.owner, { agentId: sibling.agentId, platform: "qualification", capabilities }, f.signer);
    await manageMessageEnrollment(f.owner, sibling.agentId, { operation: "issue", expectedVersion: 0, expiresAt: expiry() }, f.signer);
    await expect(executeFederationCommand(sibling.credential, { operation: "passport.verify", input: bundle }, f.bindings)).rejects.toMatchObject({ status: 401 });
  });
  it("serializes concurrent enrollment, keeps revoked history, and rejects stale reissue", async () => {
    const f = await fixture();
    const race = await Promise.allSettled([f.enroll(), f.enroll()]);
    expect(race.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const bundle = await requireCurrentAgentPassport(f.owner.accountId, f.agent.agentId, f.signer);
    await revokeAgentPassport({ ...f.owner, agentId: f.agent.agentId, ownerPrincipalId: f.owner.principalId, passportId: bundle.passport.passportId }, f.signer);
    await expect(authenticateFederationAgent(f.agent.credential, f.signer)).rejects.toMatchObject({ status: 401 });
    await f.enroll(1);
    const current = await requireCurrentAgentPassport(f.owner.accountId, f.agent.agentId, f.signer);
    expect(current.passport).toMatchObject({ version: 2, revocationEpoch: 1 });
    await expect(f.enroll(1)).rejects.toMatchObject({ status: 409 });
    await expect(executeFederationCommand(f.agent.credential, { operation: "passport.verify", input: bundle }, f.bindings)).rejects.toMatchObject({ status: 401 });
    expect(await db().select().from(agentPassports)).toHaveLength(2);
  });
  it("denies expiry from signed time without mutating historical payload", async () => {
    const f = await fixture(), bundle = await issued(f);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(bundle.passport.expiresAt));
    await expect(authenticateFederationAgent(f.agent.credential, f.signer)).rejects.toMatchObject({ status: 401 });
    clock.mockRestore();
    expect((await readMessageEnrollment(f.owner, f.agent.agentId)).bundle).toEqual(bundle);
  });
  it("rejects durable row/payload drift", async () => {
    const f = await fixture(), bundle = await issued(f);
    await db().update(agentPassports).set({ payloadHash: "a".repeat(64) }).where(eq(agentPassports.id, bundle.passport.passportId));
    await expect(authenticateFederationAgent(f.agent.credential, f.signer)).rejects.toMatchObject({ status: 401 });
  });
  it("does not let unchecked policy JSON override issuer identity", async () => {
    const f = await fixture(), bundle = await issued(f);
    const { trustTier, capabilityEligibility, policyReferences, budgetReferences, allowedEnvironments, dataAccess, expiresAt } = bundle.passport;
    const policy = { trustTier, capabilityEligibility, policyReferences, budgetReferences, allowedEnvironments, dataAccess, expiresAt, agentId: "agt_other" };
    await expect(issueAgentPassport({ accountId: f.owner.accountId, agentId: f.agent.agentId, ownerPrincipalId: f.owner.principalId, policy }, f.signer)).rejects.toBeDefined();
    expect(await db().select().from(agentPassports)).toHaveLength(1);
  });
  it("rechecks caller Passport at admission after an earlier successful authentication", async () => {
    const f = await fixture(), original = await issued(f);
    const other = { accountId: await secondAccount(), principalId: id("prn") };
    await db().insert(principals).values({ id: other.principalId, type: "HUMAN", displayName: "Other" });
    await db().insert(accountMemberships).values({ ...other, role: "OWNER" });
    const target = await createAgent(other.accountId, { name: "Target", capabilities: [] });
    await registerFederationAgent(other, { agentId: target.agentId, platform: "qualification", capabilities }, f.signer);
    await manageMessageEnrollment(other, target.agentId, { operation: "issue", expectedVersion: 0, expiresAt: expiry() }, f.signer);
    await createFederationGrant(other, { grantorAgentId: target.agentId, granteeOwnerId: f.owner.accountId, granteeAgentId: f.agent.agentId, capability: "message.send", resource: "messages", conditions: { expiresAt: expiry(), rateLimit: { calls: 5, windowSeconds: 60 }, allowedTopics: [], approvalRequired: false } }, f.signer);
    await publishRelaySafetyPolicy({ name: "test-messages", rules: [{ id: "allow", effect: "ALLOW", match: { capability: capabilities[1] }, reasonCode: "TEST_ALLOW" }] }, f.signer);
    await authenticateFederationAgent(f.agent.credential, f.signer);
    await revokeAgentPassport({ ...f.owner, agentId: f.agent.agentId, ownerPrincipalId: f.owner.principalId, passportId: original.passport.passportId }, f.signer);
    await expect(submitFederationRequest(f.agent.credential, { target: `relay://${other.accountId}/${target.agentId}`, capability: "message.send", resource: "messages", idempotencyKey: "revoked-passport", expiresAt: expiry(), payload: { body: "Must be denied" } }, f.bindings)).rejects.toMatchObject({ status: 401 });
  });
  it("serializes signing against owner suspension and denies all subsequent authentication", async () => {
    const f = await fixture();
    let entered!: () => void, release!: () => void;
    const atSign = new Promise<void>(resolve => { entered = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    const original = f.signer.sign.bind(f.signer);
    vi.spyOn(f.signer, "sign").mockImplementationOnce(async material => { entered(); await resume; return original(material); });
    const enrolling = f.enroll();
    await atSign;
    let suspended = false;
    const suspending = suspendPrincipal(f.owner).then(() => { suspended = true; });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(suspended).toBe(false);
    release();
    await enrolling;
    await suspending;
    await expect(authenticateFederationAgent(f.agent.credential, f.signer)).rejects.toMatchObject({ status: 401 });
    await expect(f.enroll(1)).rejects.toMatchObject({ status: 403 });
  });
  it("verifies retained legacy v1 signatures but rejects revoked or relabeled keys", async () => {
    const f = await fixture(), current = await issued(f);
    // Reproduce the pre-upgrade canonical signed v1 format in the disposable DB.
    const passport = structuredClone(current.passport);
    delete passport.signingKey;
    const payloadHash = canonicalHash(passport), signature = await f.signer.sign(payloadHash);
    await db().update(agentPassports).set({ payload: passport, payloadHash, signature }).where(eq(agentPassports.id, passport.passportId));
    expect((await requireCurrentAgentPassport(f.owner.accountId, f.agent.agentId, f.signer)).payloadHash).toBe(payloadHash);
    const revoked = { ...f.signer, verificationKeys: () => [] };
    await expect(requireCurrentAgentPassport(f.owner.accountId, f.agent.agentId, revoked)).rejects.toMatchObject({ status: 401 });
    await db().update(agentPassports).set({ signingKeyId: "different-key" }).where(eq(agentPassports.id, passport.passportId));
    await expect(requireCurrentAgentPassport(f.owner.accountId, f.agent.agentId, f.signer)).rejects.toMatchObject({ status: 401 });
  });

  it("requires a supplied bundle for Passport verification", async () => {
    const f = await fixture(); await issued(f);
    await expect(executeFederationCommand(f.agent.credential, { operation: "passport.verify" }, f.bindings)).rejects.toBeDefined();
    await expect(executeFederationCommand(f.agent.credential, { operation: "passport.verify", input: null }, f.bindings)).rejects.toMatchObject({ status: 401 });
  });

  it("uses the canonical receiving policy definition for outbound message eligibility", async () => {
    const f = await fixture();
    // Production's explicit registry defines the evaluated receiving action.
    await db().delete(capabilityDefinitions).where(eq(capabilityDefinitions.name, "message.send"));
    await f.enroll();
    expect((await requireCurrentAgentPassport(f.owner.accountId, f.agent.agentId, f.signer)).passport.capabilityEligibility).toEqual(capabilities);
    await db().update(capabilityDefinitions).set({ enabled: false }).where(eq(capabilityDefinitions.name, "message.receive"));
    await expect(f.enroll(1)).rejects.toMatchObject({ status: 403 });
  });

});
