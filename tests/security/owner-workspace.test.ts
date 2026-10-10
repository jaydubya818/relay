import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDatabase, secondAccount, cleanupDatabase } from "../helpers";
import { db } from "@/lib/db";
import { activities, accountMemberships, agents, connections, connectionCredentials } from "@/lib/db/schema";
import { createAgent } from "@/lib/agents";
import { ownerActivity, ownerConnections, ownerDirectory, ownerOperations, ownerRecentCounts, capabilityProvider, validDate } from "@/lib/owner-workspace";

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
  it("rejects malformed dates and maps only established service capability namespaces", () => {
    expect(validDate("2026-02-31")).toBeUndefined(); expect(validDate("not-a-date")).toBeUndefined();
    expect(validDate("2026-01-15")).toBe("2026-01-15");
    expect(capabilityProvider("calendar.event.read")).toBe("GOOGLE"); expect(capabilityProvider("email.search")).toBe("GOOGLE");
    expect(capabilityProvider("future.admin")).toBe("RELAY");
  });
});
