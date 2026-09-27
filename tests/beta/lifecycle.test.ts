import { afterEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentCredentials, agents, auditRecords, betaInvites, controlOutbox, federationGrants, memories, principals, userSessions, users } from "@/lib/db/schema";
import { createAccountOwner, createSession, issueBetaInvite, lookupBetaInvite, parseSession, revokeBetaInvite } from "@/lib/auth";
import { createAgent } from "@/lib/agents";
import { hashSecret } from "@/lib/crypto";
import { id } from "@/lib/ids";
import { planDisposableBetaRetirement, retireDisposableBetaAccount } from "@/lib/beta-account-retirement";
import { createLocalEd25519Signer } from "@/lib/v2/evidence/crypto";
import { listAuditRecords, verifyAuditRecords } from "@/lib/v2/evidence/audit";
import { authenticateFederationAgent } from "@/lib/v2/federation/service";
import { createFederationGrant, registerFederationAgent } from "@/lib/v2/federation/registry";
import { publishOutboxBatch } from "@/lib/v2/orchestration";
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
  afterEach(async () => { delete process.env.RELAY_ADMIN_EMAIL; await cleanupDatabase(); });

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

  it("retires an invited account, fences authority, scrubs private memory, and keeps signed history", async () => {
    const { tester, owner } = await disposable("retire@example.com");
    const signer = createLocalEd25519Signer();
    const session = await createSession(tester);
    const agent = await createAgent(tester.accountId, { name: "Ava", capabilities: [] });
    const [principal] = await db().select({ id: principals.id }).from(principals)
      .innerJoin(users, eq(users.id, principals.userId)).where(eq(users.accountId, tester.accountId));
    const principalId = principal.id;
    await registerFederationAgent({ accountId: tester.accountId, principalId }, { agentId: agent.agentId, platform: "qualification", capabilities: [{ name: "message.send", version: "1.0" }], discovery: "PUBLIC", publicName: "Ava" }, signer);
    await db().insert(memories).values({ id: id("mem"), accountId: tester.accountId, createdByAgentId: agent.agentId, scope: "AGENT_PRIVATE", type: "FACT", content: "private-canary", source: "test" });
    await db().insert(federationGrants).values({ id: id("fgr"), ownerId: tester.accountId, granteeOwnerId: owner.accountId, capability: "message.send", resource: "inbox", document: {} });
    expect(await parseSession(session)).toMatchObject({ accountId: tester.accountId });
    expect(await authenticateFederationAgent(agent.credential)).toMatchObject({ ownerId: tester.accountId });
    const plan = await planDisposableBetaRetirement(tester.accountId);
    expect(plan).toMatchObject({ state: "ACTIVE", agents: 1, activeGrants: 1, privateDataObjects: 1, unsupportedResources: 0, policy: "RETIRE_ONLY" });
    const before = await listAuditRecords(tester.accountId);
    const retireInput = { accountId: tester.accountId, ownerUserId: tester.id, signer };
    const results = await Promise.all([retireDisposableBetaAccount(retireInput), retireDisposableBetaAccount(retireInput)]);
    expect(results.map((result) => result.idempotentReplay).sort()).toEqual([false, true]);
    expect(await parseSession(session)).toBeNull();
    await expect(authenticateFederationAgent(agent.credential)).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
    expect(await db().select().from(userSessions).where(and(eq(userSessions.accountId, tester.accountId), isNull(userSessions.revokedAt)))).toHaveLength(0);
    expect(await db().select().from(agentCredentials).where(and(eq(agentCredentials.accountId, tester.accountId), isNull(agentCredentials.revokedAt)))).toHaveLength(0);
    expect(await db().select().from(federationGrants).where(and(eq(federationGrants.ownerId, tester.accountId), eq(federationGrants.status, "ACTIVE")))).toHaveLength(0);
    const [memory] = await db().select().from(memories).where(eq(memories.accountId, tester.accountId));
    expect(memory).toMatchObject({ content: "" });
    expect(memory.forgottenAt).not.toBeNull();
    const history = await listAuditRecords(tester.accountId);
    expect(history).toHaveLength(before.length + 1);
    expect(history.at(-1)?.eventType).toBe("beta.account.retired");
    expect(await verifyAuditRecords(history, signer)).toBe(true);
    expect(await db().select().from(auditRecords).where(eq(auditRecords.accountId, tester.accountId))).toHaveLength(history.length);
    expect((await db().select().from(agents).where(eq(agents.accountId, tester.accountId)))[0].status).toBe("DISABLED");
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
});
