import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "@/lib/agents";
import { db } from "@/lib/db";
import { activities, agentSessions } from "@/lib/db/schema";
import { handleMcp } from "@/lib/mcp";
import { cleanupDatabase, freshDatabase } from "../helpers";

describe("durable Agent sessions", () => {
  afterEach(cleanupDatabase);

  it("reuses a credential/runtime session and correlates capability activity", async () => {
    const { accountId } = await freshDatabase();
    const agent = await createAgent(accountId, { name: "Worker", capabilities: ["memory.read"] });
    const request = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "relay_memory_list", arguments: {} } };
    await handleMcp(agent.credential, request);
    await handleMcp(agent.credential, request);
    const sessions = await db().select().from(agentSessions).where(eq(agentSessions.agentId, agent.agentId));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ accountId, agentId: agent.agentId, runtime: "mcp", status: "ACTIVE" });
    const calls = await db().select({ sessionId: activities.sessionId }).from(activities).where(eq(activities.agentId, agent.agentId));
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.sessionId === sessions[0].id)).toBe(true);
  });
});
