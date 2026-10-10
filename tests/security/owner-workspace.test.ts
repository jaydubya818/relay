import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDatabase, secondAccount, cleanupDatabase } from "../helpers";
import { db } from "@/lib/db";
import { activities, accountMemberships, agents, connections, connectionCredentials, v2Tasks, v2Events, eventRoutes, approvalRequests, policyDecisions } from "@/lib/db/schema";
import { createAgent } from "@/lib/agents";
import { ownerActivity, ownerConnections, ownerDirectory, ownerOperations, ownerRunningTasks, ownerPendingApprovals, ownerRecentCounts, capabilityProvider, validDate } from "@/lib/owner-workspace";

afterEach(cleanupDatabase);
describe("owner workspace read boundaries", () => {
  it("scopes directory, connections, search and counts to the account across pagination", async () => {
    const { accountId } = await freshDatabase(); const other = await secondAccount();
    const own = await createAgent(accountId, { name: "Sofie", capabilities: ["email.search"] });
    const foreign = await createAgent(other, { name: "Private Agent", capabilities: [] });
    await db().insert(activities).values(Array.from({ length: 25 }, (_, i) => ({ id: `local-${i}`, accountId, agentId: own.agentId, sessionId: "session", action: "memory.read", capability: "memory.read", status: "DENIED" as const, durationMs: 1, createdAt: "2026-01-15T12:00:00Z" })));
    await db().insert(activities).values({ id: "foreign", accountId: other, agentId: foreign.agentId, sessionId: "foreign", action: "private", capability: "memory.read", status: "SUCCESS", durationMs: 1 });
    await db().insert(connections).values({ id: "private-connection", accountId: other, provider: "GITHUB", displayName: "Private", status: "CONNECTED" });
    const directory = await ownerDirectory(accountId);
    expect(directory).toHaveLength(1); expect(directory[0].services).toEqual(["GOOGLE"]);
    expect(await ownerConnections(accountId)).toEqual([]);
    const first = await ownerActivity(accountId, { q: "Sofie", from: "2026-01-15", to: "2026-01-15", status: "DENIED" });
    expect(first.total).toBe(25); expect(first.rows).toHaveLength(20);
    const second = await ownerActivity(accountId, { page: "2" }); expect(second.rows).toHaveLength(5);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(25);
    expect((await ownerActivity(accountId, { agent: foreign.agentId })).total).toBe(0);
    expect((await ownerActivity(accountId, { q: "Private" })).total).toBe(0);
    expect((await ownerActivity(accountId, { from: "2026-01-16" })).total).toBe(0);
    expect((await ownerActivity(accountId, { since: "2026-01-15T13:00:00.000Z" })).total).toBe(0);
    expect(await ownerRecentCounts(accountId, "2026-01-15T13:00:00.000Z")).toEqual({ failures: 0, denials: 0 });
    expect((await ownerRecentCounts(accountId, "2026-01-15T11:59:00.000Z")).denials).toBe((await ownerActivity(accountId, { since: "2026-01-15T11:59:00.000Z", status: "DENIED" })).total);
    expect((await ownerActivity(accountId, { page: "Infinity" })).page).toBe(2);
  });
  it("separates missing, expired and stored connection authentication without returning secrets", async () => {
    const { accountId } = await freshDatabase();
    await db().insert(connections).values([{ id: "missing", accountId, provider: "GITHUB", displayName: "Sample", status: "CONNECTED" }, { id: "expired", accountId, provider: "GOOGLE", displayName: "Sample", status: "CONNECTED" }]);
    await db().insert(connectionCredentials).values({ connectionId: "expired", encryptedAccessToken: "SYNTHETIC-DO-NOT-EXPOSE", tokenExpiresAt: "2020-01-01T00:00:00Z" });
    const result = await ownerConnections(accountId);
    expect(result.map((row) => row.state)).toEqual(["REQUIRES_SETUP", "AUTHENTICATION_EXPIRED"]);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC-DO-NOT-EXPOSE");
    await db().update(connectionCredentials).set({ encryptedRefreshToken: "SYNTHETIC-REFRESH-DO-NOT-EXPOSE" }).where(eq(connectionCredentials.connectionId, "expired"));
    const refreshable = await ownerConnections(accountId);
    expect(refreshable.find((item) => item.id === "expired")).toMatchObject({ state: "CONNECTED", authentication: "Refreshable session; validity checked on use" });
    expect(JSON.stringify(refreshable)).not.toContain("SYNTHETIC-REFRESH-DO-NOT-EXPOSE");
  });
  it("does not substitute dashboard OWNER role for canonical V2 membership", async () => {
    const { accountId, userId } = await freshDatabase();
    const user = { accountId, id: userId, role: "OWNER" as const, email: "operator@example.com", name: "Operator" };
    expect(await ownerOperations(user)).toEqual({ running: 0, pending: 0 });
    await db().delete(accountMemberships).where(eq(accountMemberships.accountId, accountId));
    expect(await ownerOperations(user)).toBeNull();
    const other = await secondAccount(); expect(await ownerOperations({ ...user, accountId: other })).toBeNull();
    expect(await db().select().from(agents).where(eq(agents.accountId, accountId))).toEqual([]);
  });
  it("filters operation drill-downs before row limits and preserves canonical membership", async () => {
    const { accountId, userId, principalId } = await freshDatabase();
    const foreignId = await secondAccount();
    const user = { accountId, id: userId, role: "OWNER" as const, email: "operator@example.com", name: "Operator" };
    const old = "2026-01-01T00:00:00.000Z", cutoff = "2026-01-15T00:00:00.000Z", future = "2099-01-01T00:00:00.000Z";
    for (const account of [accountId, foreignId]) {
      const { agentId } = await createAgent(account, { name: "Fixture", capabilities: [] });
      await db().insert(eventRoutes).values({ id: `route-${account}`, accountId: account, name: "Fixture", version: 1, source: "fixture", eventType: "fixture", agentId, createdByPrincipalId: principalId });
      await db().insert(v2Events).values({ id: `event-${account}`, accountId: account, source: "fixture", type: "fixture", occurredAt: old, dedupeKey: "fixture", correlationId: "fixture", schemaVersion: "fixture", classification: "fixture", signatureStatus: "VERIFIED" });
      await db().insert(v2Tasks).values(Array.from({ length: 102 }, (_, index) => ({ id: `task-${account}-${index}`, accountId: account, eventId: `event-${account}`, routeId: `route-${account}`, logicalKey: `fixture-${index}`, agentId, maxAttempts: 1, status: index === 0 ? "RUNNING" as const : "SUCCEEDED" as const, createdAt: index === 0 ? old : cutoff })));
      await db().insert(policyDecisions).values({ id: `policy-${account}`, accountId: account, actionIntentId: "fixture", agentId, outcome: "REQUIRE_APPROVAL", reasonCodes: [], obligations: {}, capabilityDefinitionHash: "fixture", policyBundleHashes: [], materialFacts: {}, evaluationSnapshot: {}, expiresAt: future });
      await db().insert(approvalRequests).values(Array.from({ length: 103 }, (_, index) => ({ id: `approval-${account}-${index}`, accountId: account, agentId, actionIntentId: "fixture", actionHash: "fixture", actionSnapshot: { secret: "DO-NOT-SELECT" }, runtimeClientId: "fixture", taskId: `task-${account}-0`, policyDecisionId: `policy-${account}`, approvalClass: "fixture", riskClass: "low", effectClass: "read", summary: "Fixture", consequence: "Fixture", displayEvidence: {}, allowedScopes: ["once"], assignedPrincipalIds: [], status: index < 2 ? "PENDING" as const : "APPROVED" as const, expiresAt: index === 1 ? old : future, createdAt: index === 0 ? old : cutoff })));
    }
    const counts = await ownerOperations(user, cutoff);
    const tasks = await ownerRunningTasks(user), approvals = await ownerPendingApprovals(user, cutoff);
    expect(counts).toEqual({ running: 1, pending: 1 });
    expect(tasks.map((item) => item.id)).toEqual([`task-${accountId}-0`]);
    expect(approvals.map((item) => item.id)).toEqual([`approval-${accountId}-0`]);
    expect(JSON.stringify(approvals)).not.toContain("DO-NOT-SELECT");
    await expect(ownerRunningTasks({ ...user, accountId: foreignId })).rejects.toMatchObject({ status: 403 });
    await db().delete(accountMemberships).where(eq(accountMemberships.accountId, accountId));
    await expect(ownerPendingApprovals(user, cutoff)).rejects.toMatchObject({ status: 403 });
  });
  it("separates case-insensitive provider history from present readiness and grants", async () => {
    const { accountId } = await freshDatabase();
    const { agentId } = await createAgent(accountId, { name: "History fixture", capabilities: ["github.repo.read"] });
    await db().insert(connections).values({ id: "history-connection", accountId, provider: "GITHUB", displayName: "Fixture", status: "CONNECTED" });
    await db().insert(activities).values(["github", "GITHUB"].map((provider, index) => ({ id: `history-${index}`, accountId, agentId, provider, sessionId: "fixture", capability: "github.repo.read", action: "github.repo.get", status: "SUCCESS" as const, durationMs: 1, createdAt: `2026-01-${index ? "16" : "15"}T12:00:00.000Z` })));
    const [connection] = await ownerConnections(accountId);
    expect(connection.state).toBe("REQUIRES_SETUP");
    expect(Date.parse(connection.lastSuccess!)).toBe(Date.parse("2026-01-16T12:00:00.000Z"));
    expect((await ownerDirectory(accountId))[0].services).toEqual(["GITHUB"]);
    expect((await ownerActivity(accountId, { provider: "GITHUB", status: "SUCCESS" })).total).toBe(2);
  });
  it("rejects malformed dates and maps only established service capability namespaces", () => {
    expect(validDate("2026-02-31")).toBeUndefined(); expect(validDate("not-a-date")).toBeUndefined();
    expect(validDate("2026-01-15")).toBe("2026-01-15");
    expect(capabilityProvider("calendar.event.read")).toBe("GOOGLE"); expect(capabilityProvider("email.search")).toBe("GOOGLE");
    expect(capabilityProvider("future.admin")).toBe("RELAY");
  });
});
