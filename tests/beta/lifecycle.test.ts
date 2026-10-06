import { issueAgentPassport } from "@/lib/v2/passports";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentCredentials, agents, auditRecords, betaInvites, controlOutbox, federationGrants, memories, principals, runtimeClients, userSessions, users } from "@/lib/db/schema";
import { authenticateAgent, createAccountOwner, createSession, issueBetaInvite, lookupBetaInvite, parseSession, revokeBetaInvite } from "@/lib/auth";
import { createAgent, issueCredential, updateAgentStatus } from "@/lib/agents";
import { touchAgentSession } from "@/lib/agent-sessions";
import { addMemory, listMemories } from "@/lib/memory";
import { hashSecret } from "@/lib/crypto";
import { id } from "@/lib/ids";
import { planDisposableBetaRetirement, retireDisposableBetaAccount } from "@/lib/beta-account-retirement";
import { createLocalEd25519Signer } from "@/lib/v2/evidence/crypto";
import { listAuditRecords, verifyAuditRecords } from "@/lib/v2/evidence/audit";
import { authenticateFederationAgent } from "@/lib/v2/federation/service";
import { createFederationGrant, registerFederationAgent } from "@/lib/v2/federation/registry";
import { publishOutboxBatch } from "@/lib/v2/orchestration";
import { registerRuntimeClient } from "@/lib/v2/runtime-clients";
import { createRunnerEnrollment } from "@/lib/v2/runners";
import { createServicePrincipal } from "@/lib/v2/identity";
import { cleanupDatabase, freshDatabase } from "../helpers";

async function inviter() {
  const owner = await freshDatabase();
  process.env.RELAY_ADMIN_EMAIL = "operator@example.com";
  return { owner, user: { id: owner.userId, accountId: owner.accountId, email: "operator@example.com", name: "Operator", role: "OWNER" as const } };
}
async function disposable(email: string) {
  const { owner, user } = await inviter();
  const invite = await issueBetaInvite(user, email);
  const tester = await createAccountOwner({ accountName: "Disposable qualification", name: "Tester", email, password: "correct-horse-battery-staple", inviteToken: invite.token });
  return { owner, user, invite, tester };
}

describe("disposable Relay beta lifecycle on PostgreSQL", () => {
  afterEach(async () => { delete process.env.RELAY_ADMIN_EMAIL; delete process.env.RELAY_BETA_INVITER_EMAILS; await cleanupDatabase(); });

  it("revokes a pending invitation once and denies lookup, acceptance, and replay", async () => {
    const { user } = await inviter();
    const invite = await issueBetaInvite(user, "pending@example.com");
    const [row] = await db().select().from(betaInvites).where(eq(betaInvites.tokenHash, hashSecret(invite.token)));
    expect(await lookupBetaInvite(invite.token)).toMatchObject({ email: "pending@example.com" });
    const first = await revokeBetaInvite(user, row.id);
    const replay = await revokeBetaInvite(user, row.id);
    expect(first).toMatchObject({ status: "REVOKED", idempotentReplay: false, revokedByUserId: user.id });
    expect(replay).toMatchObject({ status: "REVOKED", idempotentReplay: true, revokedAt: first.revokedAt });
    expect(await lookupBetaInvite(invite.token)).toBeNull();
    await expect(createAccountOwner({ accountName: "Blocked", name: "Tester", email: "pending@example.com", password: "correct-horse-battery-staple", inviteToken: invite.token })).rejects.toMatchObject({ status: 403 });
  });

  it("serializes acceptance against revocation with one winner", async () => {
    const { user } = await inviter();
    const invite = await issueBetaInvite(user, "race@example.com");
    const [row] = await db().select().from(betaInvites).where(eq(betaInvites.tokenHash, hashSecret(invite.token)));
    const results = await Promise.allSettled([
      createAccountOwner({ accountName: "Race Tester", name: "Tester", email: "race@example.com", password: "correct-horse-battery-staple", inviteToken: invite.token }),
      revokeBetaInvite(user, row.id),
    ]);
    const [final] = await db().select().from(betaInvites).where(eq(betaInvites.id, row.id));
    expect(Boolean(final.consumedAt) !== Boolean(final.revokedAt)).toBe(true);
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
  });

  it("rejects invitation administration and retirement by another owner or an agent", async () => {
    const { user, tester } = await disposable("authority@example.com");
    const invite = await issueBetaInvite(user, "unused@example.com");
    const [row] = await db().select().from(betaInvites).where(eq(betaInvites.tokenHash, hashSecret(invite.token)));
    const otherOwner = { ...tester, role: "OWNER" as const };
    await expect(revokeBetaInvite(otherOwner, row.id)).rejects.toMatchObject({ status: 403 });
    await expect(revokeBetaInvite({ ...user, role: "MEMBER" as const }, row.id)).rejects.toMatchObject({ status: 403 });
    await expect(retireDisposableBetaAccount({ accountId: tester.accountId, ownerUserId: user.id,
      signer: createLocalEd25519Signer() })).rejects.toMatchObject({ status: 403 });
    expect(await lookupBetaInvite(invite.token)).not.toBeNull();
  });

  it("retires an invited account, fences authority, scrubs private memory, and keeps signed history", async () => {
    const { tester, owner } = await disposable("retire@example.com");
    const signer = createLocalEd25519Signer();
    const session = await createSession(tester);
    const agent = await createAgent(tester.accountId, { name: "Ava", capabilities: [] });
    const [principal] = await db().select({ id: principals.id }).from(principals)
      .innerJoin(users, eq(users.id, principals.userId)).where(eq(users.accountId, tester.accountId));
    const principalId = principal.id;
    await issueAgentPassport({ accountId: tester.accountId, agentId: agent.agentId, ownerPrincipalId: principalId, policy: { trustTier: "REGISTERED", capabilityEligibility: [], policyReferences: [], budgetReferences: [], allowedEnvironments: { providerIds: [], minimumAssurance: "registered" }, dataAccess: [], expiresAt: new Date(Date.now() + 3600000).toISOString() } }, signer);
    await registerFederationAgent({ accountId: tester.accountId, principalId }, { agentId: agent.agentId, platform: "qualification", capabilities: [{ name: "message.send", version: "1.0" }], discovery: "PUBLIC", publicName: "Ava" }, signer);
    await db().insert(memories).values({ id: id("mem"), accountId: tester.accountId, createdByAgentId: agent.agentId, scope: "AGENT_PRIVATE", type: "FACT", content: "private-canary", source: "test" });
    await db().insert(memories).values({ id: id("mem"), accountId: tester.accountId, createdByAgentId: agent.agentId, scope: "AGENT_PRIVATE", type: "FACT", content: "forgotten-private-canary", source: "test", forgottenAt: new Date().toISOString() });
    await db().insert(federationGrants).values({ id: id("fgr"), ownerId: tester.accountId, granteeOwnerId: owner.accountId, capability: "message.send", resource: "inbox", document: {} });
    expect(await parseSession(session)).toMatchObject({ accountId: tester.accountId });
    expect(await authenticateFederationAgent(agent.credential, signer)).toMatchObject({ ownerId: tester.accountId });
    const plan = await planDisposableBetaRetirement(tester.accountId);
    expect(plan).toMatchObject({ state: "ACTIVE", agents: 1, activeGrants: 1, privateDataObjects: 2, unsupportedResources: 0, policy: "RETIRE_ONLY" });
    const before = await listAuditRecords(tester.accountId);
    const retireInput = { accountId: tester.accountId, ownerUserId: tester.id, signer };
    const results = await Promise.all([retireDisposableBetaAccount(retireInput), retireDisposableBetaAccount(retireInput)]);
    expect(results.map((result) => result.idempotentReplay).sort()).toEqual([false, true]);
    expect(await parseSession(session)).toBeNull();
    await expect(authenticateFederationAgent(agent.credential, signer)).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
    expect(await db().select().from(userSessions).where(and(eq(userSessions.accountId, tester.accountId), isNull(userSessions.revokedAt)))).toHaveLength(0);
    expect(await db().select().from(agentCredentials).where(and(eq(agentCredentials.accountId, tester.accountId), isNull(agentCredentials.revokedAt)))).toHaveLength(0);
    expect(await db().select().from(federationGrants).where(and(eq(federationGrants.ownerId, tester.accountId), eq(federationGrants.status, "ACTIVE")))).toHaveLength(0);
    const scrubbed = await db().select().from(memories).where(eq(memories.accountId, tester.accountId));
    expect(scrubbed).toHaveLength(2);
    expect(scrubbed.every((memory) => memory.content === "" && memory.forgottenAt !== null)).toBe(true);
    const history = await listAuditRecords(tester.accountId);
    expect(history).toHaveLength(before.length + 1);
    expect(history.at(-1)?.eventType).toBe("beta.account.retired");
    expect(await verifyAuditRecords(history, signer)).toBe(true);
    expect(await db().select().from(auditRecords).where(eq(auditRecords.accountId, tester.accountId))).toHaveLength(history.length);
    expect((await db().select().from(agents).where(eq(agents.accountId, tester.accountId)))[0].status).toBe("DISABLED");
    await expect(registerRuntimeClient({ accountId: tester.accountId, actorPrincipalId: principalId,
      displayName: "Late runtime", selfDeclaredProduct: "qualification" }, signer)).rejects.toMatchObject({ status: 403 });
    await expect(createRunnerEnrollment({ accountId: tester.accountId, principalId, runnerName: "Late runner" }, signer)).rejects.toMatchObject({ status: 403 });
    await expect(createServicePrincipal({ accountId: tester.accountId, displayName: "Late service", role: "OPERATOR" })).rejects.toMatchObject({ status: 403 });
  });

  it("serializes retirement against grant creation and cancels queued outbox work", async () => {
    const { tester, owner } = await disposable("race-retirement@example.com");
    const signer = createLocalEd25519Signer();
    await db().insert(controlOutbox).values({ id: id("obx"), accountId: tester.accountId, aggregateType: "federation_request", aggregateId: "qualification", type: "federation.request.accepted", payload: { requestId: "qualification" }, idempotencyKey: "retire-race" });
    const grant = { granteeOwnerId: tester.accountId, capability: "message.send", resource: "inbox", conditions: { expiresAt: new Date(Date.now() + 3600000).toISOString(), rateLimit: { calls: 10, windowSeconds: 3600 }, allowedTopics: [], approvalRequired: false } };
    await Promise.allSettled([
      retireDisposableBetaAccount({ accountId: tester.accountId, ownerUserId: tester.id, signer }),
      createFederationGrant({ accountId: owner.accountId, principalId: owner.principalId }, grant, signer),
    ]);
    const finalPlan = await planDisposableBetaRetirement(tester.accountId);
    expect(finalPlan).toMatchObject({ state: "RETIRED", activeGrants: 0 });
    const published: string[] = [];
    expect(await publishOutboxBatch({ publish: async (message) => { published.push(message.id); } })).toBe(0);
    expect(published).toEqual([]);
    const [outbox] = await db().select().from(controlOutbox).where(eq(controlOutbox.accountId, tester.accountId));
    expect(outbox.cancelledAt).not.toBeNull();
  });

  it("keeps sessions, credentials, invitations, and memory at zero across retirement races", async () => {
    const { tester } = await disposable("fenced@example.com");
    const signer = createLocalEd25519Signer();
    const agent = await createAgent(tester.accountId, { name: "Ava", capabilities: [] });
    const auth = await authenticateAgent(agent.credential);
    if (!auth.ok) throw new Error("Test Agent did not authenticate");
    process.env.RELAY_BETA_INVITER_EMAILS = tester.email;
    const retiring = retireDisposableBetaAccount({ accountId: tester.accountId, ownerUserId: tester.id, signer });
    await Promise.allSettled([
      retiring,
      createSession(tester),
      touchAgentSession(auth.principal),
      issueCredential(tester.accountId, agent.agentId, "Racing credential"),
      issueBetaInvite(tester, "racing-invite@example.com"),
      addMemory(auth.principal, { content: "private race canary", type: "FACT", scope: "AGENT_PRIVATE" }),
      updateAgentStatus(tester.accountId, agent.agentId, "ACTIVE"),
    ]);
    expect((await retiring).state).toBe("RETIRED");
    const plan = await planDisposableBetaRetirement(tester.accountId);
    expect(plan).toMatchObject({ state: "RETIRED", activeSessions: 0, activeCredentials: 0,
      pendingInvites: 0, privateDataObjects: 0 });
    await expect(createSession(tester)).rejects.toMatchObject({ status: 403 });
    await expect(touchAgentSession(auth.principal)).rejects.toMatchObject({ status: 403 });
    await expect(issueCredential(tester.accountId, agent.agentId, "Late credential")).rejects.toMatchObject({ status: 403 });
    await expect(issueBetaInvite(tester, "late-invite@example.com")).rejects.toMatchObject({ status: 403 });
    await expect(addMemory(auth.principal, { content: "late private canary", type: "FACT", scope: "AGENT_PRIVATE" })).rejects.toMatchObject({ status: 403 });
    await expect(updateAgentStatus(tester.accountId, agent.agentId, "ACTIVE")).rejects.toMatchObject({ status: 403 });
    expect(await listMemories(auth.principal)).toEqual([]);
  });

  it("blocks terminal retirement while a runtime client still has authority", async () => {
    const { tester } = await disposable("runtime-client@example.com");
    const clientId = id("rtc");
    await db().insert(runtimeClients).values({ id: clientId, accountId: tester.accountId,
      displayName: "Qualification runtime", selfDeclaredProduct: "local-test",
      secretHash: hashSecret("local-runtime-secret"), prefix: "local-runtime" });
    expect((await planDisposableBetaRetirement(tester.accountId)).unsupportedResources).toBeGreaterThan(0);
    await expect(retireDisposableBetaAccount({ accountId: tester.accountId, ownerUserId: tester.id,
      signer: createLocalEd25519Signer() })).rejects.toMatchObject({ status: 409 });
    await db().update(runtimeClients).set({ revokedAt: new Date().toISOString() }).where(eq(runtimeClients.id, clientId));
    const retired = await retireDisposableBetaAccount({ accountId: tester.accountId, ownerUserId: tester.id,
      signer: createLocalEd25519Signer() });
    expect(retired.state).toBe("RETIRED");
  });
});
