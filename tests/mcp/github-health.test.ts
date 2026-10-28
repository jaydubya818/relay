import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent, revokeCredential, setCapabilityGrant } from "@/lib/agents";
import { connectGitHub } from "@/lib/connections";
import { executeCapability } from "@/lib/executor";
import { handleMcp } from "@/lib/mcp";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

const args = { owner: "example", repo: "dashboard" };
function call(credential: string, name = "relay_github_run_list", input: Record<string, unknown> = args) {
  return handleMcp(credential, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: input } });
}
async function names(credential: string) {
  const result = await handleMcp(credential, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  return (result as { tools: { name: string; inputSchema: Record<string, unknown> }[] }).tools;
}

describe("GitHub health MCP authorization", () => {
  let accountId: string;
  let fetch: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    accountId = (await freshDatabase()).accountId;
    fetch = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/user") ? { id: 1, login: "synthetic" } : { total_count: 0, workflow_runs: [] }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
  });
  afterEach(async () => { vi.unstubAllGlobals(); await cleanupDatabase(); });

  it("does not expand an existing repository grant", async () => {
    const agent = await createAgent(accountId, { name: "Existing reader", capabilities: ["github.repo.read"] });
    expect((await names(agent.credential)).map((tool) => tool.name)).toEqual(["relay_github_repo_list", "relay_github_repo_get"]);
    for (const name of ["relay_github_branch_list", "relay_github_branch_get", "relay_github_workflow_list", "relay_github_run_list", "relay_github_run_get", "relay_github_deployment_list", "relay_github_deployment_status_list"]) {
      const input = { ...args, ...(name.endsWith("branch_get") ? { branch: "main" } : {}), ...(name.endsWith("status_list") ? { deploymentId: "1" } : {}), ...(name.endsWith("run_get") ? { runId: "42" } : {}) };
      await expect(call(agent.credential, name, input)).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("advertises only separately granted families with bounded input schemas", async () => {
    const agent = await createAgent(accountId, { name: "Actions reader", capabilities: ["github.actions.read"] });
    const tools = await names(agent.credential);
    expect(tools.map((tool) => tool.name)).toEqual(["relay_github_workflow_list", "relay_github_run_list", "relay_github_run_get"]);
    expect(tools[1].inputSchema).toMatchObject({ type: "object", required: ["owner", "repo"], additionalProperties: false, properties: { page: { maximum: 5 }, perPage: { maximum: 100 } } });
    await setCapabilityGrant(accountId, agent.agentId, "github.branch.read", "ALLOW");
    expect((await names(agent.credential)).map((tool) => tool.name)).toContain("relay_github_branch_get");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the authenticated account connection and enforces grant revocation on the next call", async () => {
    const agent = await createAgent(accountId, { name: "Reader", capabilities: ["github.actions.read"] });
    await connectGitHub(accountId, "synthetic-owner-token"); fetch.mockClear();
    const result = await call(agent.credential);
    expect(JSON.parse((result as { content: { text: string }[] }).content[0].text)).toMatchObject({ items: [], hasMore: false });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/actions/runs?"), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer synthetic-owner-token" }) }));
    fetch.mockClear();
    await setCapabilityGrant(accountId, agent.agentId, "github.actions.read", "DENY");
    expect(await names(agent.credential)).toEqual([]);
    await expect(call(agent.credential)).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not borrow another account's GitHub connection", async () => {
    await connectGitHub(accountId, "synthetic-other-owner-token");
    const peer = await createAgent(await secondAccount(), { name: "Peer", capabilities: ["github.actions.read"] }); fetch.mockClear();
    await expect(call(peer.credential)).rejects.toMatchObject({ code: "CONNECTION_REQUIRED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects mismatched direct executor actions before fetching credentials", async () => {
    const agent = await createAgent(accountId, { name: "Repo only", capabilities: ["github.repo.read"] });
    await expect(executeCapability({ principal: { accountId, agentId: agent.agentId, agentName: "Repo only", credentialId: "synthetic" }, capability: "github.repo.read", action: "github.run.list", sessionId: "synthetic-session", arguments: args })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects caller identity overrides and out-of-bounds pages at MCP input", async () => {
    const agent = await createAgent(accountId, { name: "Reader", capabilities: ["github.actions.read"] });
    for (const input of [{ ...args, accountId: "foreign" }, { ...args, page: 6 }, { ...args, url: "https://untrusted.invalid" }]) {
      await expect(call(agent.credential, undefined, input)).rejects.toMatchObject({ code: "INVALID_INPUT", capability: "github.actions.read" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a revoked Agent credential before GitHub reads", async () => {
    const agent = await createAgent(accountId, { name: "Reader", capabilities: ["github.actions.read"] });
    await revokeCredential(accountId, agent.agentId);
    await expect(call(agent.credential)).rejects.toMatchObject({ code: "REVOKED_CREDENTIAL" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves a current run attempt through the authorized account and then denies revocation", async () => {
    fetch.mockImplementation(async (url: string) => new Response(JSON.stringify(url.endsWith("/user") ? { id: 1, login: "synthetic" } :
      { id: 42, run_attempt: 2, head_sha: "a".repeat(40), repository: { id: 9001, full_name: "example/dashboard" } }), { headers: { "content-type": "application/json" } }));
    const agent = await createAgent(accountId, { name: "Run detail reader", capabilities: ["github.actions.read"] });
    await connectGitHub(accountId, "synthetic-owner-token"); fetch.mockClear();
    const result = await call(agent.credential, "relay_github_run_get", { ...args, runId: "42" });
    expect(JSON.parse((result as { content: { text: string }[] }).content[0].text)).toMatchObject({ id: 42, run_attempt: 2 });
    expect(fetch).toHaveBeenCalledWith("https://api.github.com/repos/example/dashboard/actions/runs/42", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer synthetic-owner-token" }) }));
    await setCapabilityGrant(accountId, agent.agentId, "github.actions.read", "DENY"); fetch.mockClear();
    await expect(call(agent.credential, "relay_github_run_get", { ...args, runId: "42" })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not borrow another account's connection or accept identity overrides for run detail", async () => {
    await connectGitHub(accountId, "synthetic-other-owner-token");
    const peer = await createAgent(await secondAccount(), { name: "Peer detail reader", capabilities: ["github.actions.read"] }); fetch.mockClear();
    await expect(call(peer.credential, "relay_github_run_get", { ...args, runId: "42" })).rejects.toMatchObject({ code: "CONNECTION_REQUIRED" });
    await expect(call(peer.credential, "relay_github_run_get", { ...args, runId: "42", accountId })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
