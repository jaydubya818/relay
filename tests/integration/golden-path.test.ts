import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent, revokeCredential, setCapabilityGrant } from "@/lib/agents";
import { connectGitHub } from "@/lib/connections";
import { asc, and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { activities } from "@/lib/db/schema";
import { handleMcp } from "@/lib/mcp";
import { cleanupDatabase, freshDatabase } from "../helpers";

function call(secret: string, name: string, args: Record<string, unknown> = {}) {
  return handleMcp(secret, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
}

describe("Relay V0 golden path", () => {
  let accountId: string;
  beforeEach(async () => {
    accountId = (await freshDatabase()).accountId;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      const body = url.endsWith("/user")
        ? { id: 818, login: "relay-test", name: "Relay Test" }
        : [{ id: 1, name: "relay", full_name: "relay-test/relay", private: true }];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }));
  });
  afterEach(async () => { vi.unstubAllGlobals(); await cleanupDatabase(); });

  it("shares authorized memory across agents while private memory remains isolated", async () => {
    const agentA = await createAgent(accountId, { name: "Claude Test Agent", capabilities: ["memory.read", "memory.write"] });
    const agentB = await createAgent(accountId, { name: "Codex Test Agent", capabilities: ["memory.read"] });
    await call(agentA.credential, "relay_memory_add", { content: "Project Atlas uses Node 24.", type: "FACT", scope: "SHARED" });
    const shared = await call(agentB.credential, "relay_memory_search", { query: "What runtime does Project Atlas use?" });
    expect(JSON.stringify(shared)).toContain("Project Atlas uses Node 24.");
    await call(agentA.credential, "relay_memory_add", { content: "Claude-only launch note.", type: "OTHER", scope: "AGENT_PRIVATE" });
    const privateSearch = await call(agentB.credential, "relay_memory_search", { query: "Claude-only" });
    expect(JSON.stringify(privateSearch)).not.toContain("Claude-only launch note.");
  });

  it("uses one GitHub connection with per-agent authorization and auditable denial", async () => {
    const agentA = await createAgent(accountId, { name: "Claude Test Agent", capabilities: ["github.repo.read"] });
    const agentB = await createAgent(accountId, { name: "Codex Test Agent", capabilities: ["memory.read"] });
    await connectGitHub(accountId, "github_pat_test_token_long_enough");
    expect(JSON.stringify(await call(agentA.credential, "relay_github_repo_list"))).toContain("relay-test/relay");
    await expect(call(agentB.credential, "relay_github_repo_list")).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await setCapabilityGrant(accountId, agentB.agentId, "github.repo.read", "ALLOW");
    expect(JSON.stringify(await call(agentB.credential, "relay_github_repo_list"))).toContain("relay-test/relay");
    const statuses = (await db().select({ status: activities.status }).from(activities).where(and(eq(activities.accountId, accountId), eq(activities.capability, "github.repo.read"))).orderBy(asc(activities.createdAt), asc(activities.id))).map((row) => row.status);
    expect(statuses).toEqual(["SUCCESS", "DENIED", "SUCCESS"]);
  });

  it("revokes a credential immediately without a process restart", async () => {
    const agent = await createAgent(accountId, { name: "Revocation Agent", capabilities: ["memory.read"] });
    await expect(handleMcp(agent.credential, { jsonrpc: "2.0", id: 1, method: "tools/list" })).resolves.toBeDefined();
    await revokeCredential(accountId, agent.agentId);
    await expect(handleMcp(agent.credential, { jsonrpc: "2.0", id: 2, method: "tools/list" })).rejects.toMatchObject({ code: "REVOKED_CREDENTIAL" });
  });
});
