import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgent, setCapabilityGrant } from "@/lib/agents";
import { handleMcp } from "@/lib/mcp";
import { cleanupDatabase, freshDatabase } from "../helpers";

describe("MCP tool projection", () => {
  let accountId: string;
  beforeEach(() => { accountId = freshDatabase().accountId; });
  afterEach(cleanupDatabase);

  it("only projects tools backed by allowed grants", async () => {
    const agent = createAgent(accountId, { name: "Scoped Agent", capabilities: ["memory.read"] });
    const first = await handleMcp(agent.credential, { jsonrpc: "2.0", id: 1, method: "tools/list" }) as any;
    expect(first.tools.map((tool: any) => tool.name)).toEqual(["relay_memory_search", "relay_memory_get", "relay_memory_list"]);
    setCapabilityGrant(accountId, agent.agentId, "github.repo.read", "ALLOW");
    const second = await handleMcp(agent.credential, { jsonrpc: "2.0", id: 2, method: "tools/list" }) as any;
    expect(second.tools.map((tool: any) => tool.name)).toContain("relay_github_repo_list");
  });
});
