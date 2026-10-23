/**
 * Sofie (MyEve) → Relay tool-execution contract.
 *
 * MyEve's RelayClient posts Bearer rly_ credentials to /api/v2/federation.
 * Real tool execution for the MyEve beta uses HTTPS /mcp with the same
 * credential. This suite is local only: no hosted MyEve, production Relay,
 * paid providers, or Deep Agent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as mcpGet, POST as mcpPost } from "@/app/mcp/route";
import { POST as federationPost } from "@/app/api/v2/federation/route";
import { POST as v2McpPost } from "@/app/api/v2/mcp/route";
import { createAgent, rotateCredential, revokeCredential, setCapabilityGrant } from "@/lib/agents";
import { authenticateAgent } from "@/lib/auth";
import { connectGitHub } from "@/lib/connections";
import { db } from "@/lib/db";
import { accountMemberships, principals } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { requireRuntimeActionsEnabled, runtimeActionsEnabled } from "@/lib/v2/deployment";
import { createLocalEd25519Signer, createLocalRsaKeyWrapper } from "@/lib/v2/evidence/crypto";
import { provisionFederationCapabilities } from "@/lib/v2/federation/capabilities";
import { capabilitySchema } from "@/lib/v2/federation/contracts";
import { registerFederationAgent } from "@/lib/v2/federation/registry";
import { issueAgentPassport } from "@/lib/v2/passports";
import { configureV2PlatformBindings } from "@/lib/v2/platform-bindings";
import { publishRelaySafetyPolicy } from "@/lib/v2/policy";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

type RpcErrorData = { code?: string; capability?: string; message?: string };
type RpcBody = {
  jsonrpc?: string;
  id?: unknown;
  result?: { tools?: Array<{ name: string }>; content?: Array<{ text: string }>; protocolVersion?: string };
  error?: { code: number; message: string; data?: RpcErrorData };
};

function mcpRequest(secret: string | undefined, body: object) {
  const headers = new Headers({ "content-type": "application/json", origin: "https://relay.test" });
  if (secret !== undefined) headers.set("authorization", `Bearer ${secret}`);
  return new Request("https://relay.test/mcp", { method: "POST", headers, body: JSON.stringify(body) });
}

async function mcpRpc(secret: string | undefined, method: string, params?: unknown, rpcId: number = 1) {
  const response = await mcpPost(mcpRequest(secret, { jsonrpc: "2.0", id: rpcId, method, ...(params === undefined ? {} : { params }) }));
  return { status: response.status, rpc: await response.json() as RpcBody, requestId: response.headers.get("x-request-id") };
}

function resultPayload(rpc: RpcBody) {
  const text = rpc.result?.content?.[0]?.text;
  expect(text).toEqual(expect.any(String));
  return JSON.parse(text as string);
}

function errorData(rpc: RpcBody) {
  expect(rpc.error?.data).toEqual(expect.any(Object));
  return rpc.error!.data!;
}

describe("Sofie → Relay MCP tool execution", () => {
  let accountId: string;

  beforeEach(async () => {
    accountId = (await freshDatabase()).accountId;
    resetRateLimitsForTests();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    resetRateLimitsForTests();
    await cleanupDatabase();
  });

  it("authenticates Sofie over /mcp, advertises granted tools, and returns an executable result", async () => {
    const discovery = await mcpGet();
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toMatchObject({ name: "Relay MCP", endpoint: "/mcp" });

    const missing = await mcpRpc(undefined, "tools/list");
    expect(missing.status).toBe(401);
    expect(errorData(missing.rpc)).toMatchObject({ code: "INVALID_CREDENTIAL" });

    const invalid = await mcpRpc("rly_not-a-real-credential", "initialize", { protocolVersion: "2025-06-18" });
    expect(invalid.status).toBe(401);
    expect(errorData(invalid.rpc)).toMatchObject({ code: "INVALID_CREDENTIAL" });
    expect(JSON.stringify(invalid.rpc)).not.toContain("rly_not-a-real-credential");

    const sofie = await createAgent(accountId, { name: "Sofie", capabilities: ["memory.read", "memory.write"] });
    const identity = await authenticateAgent(sofie.credential);
    expect(identity).toMatchObject({ ok: true, principal: { accountId, agentId: sofie.agentId, agentName: "Sofie" } });

    const handshake = await mcpRpc(sofie.credential, "initialize", { protocolVersion: "2025-06-18" });
    expect(handshake.status).toBe(200);
    expect(handshake.rpc.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "relay" } });
    expect((await mcpRpc(sofie.credential, "ping", undefined, 2)).status).toBe(200);
    expect((await mcpRpc(sofie.credential, "ping", undefined, 2)).status).toBe(200);

    const advertised = await mcpRpc(sofie.credential, "tools/list");
    const names = (advertised.rpc.result?.tools ?? []).map((tool) => tool.name).sort();
    expect(names).toEqual(["relay_memory_add", "relay_memory_get", "relay_memory_list", "relay_memory_search"]);
    expect(names.some((name) => name.startsWith("relay_factory_") || name.startsWith("relay_sandbox_") || /deep.?agent/i.test(name))).toBe(false);

    const stored = resultPayload((await mcpRpc(sofie.credential, "tools/call", {
      name: "relay_memory_add",
      arguments: { content: "Sofie may recall that Relay memory is owner-scoped.", type: "FACT", scope: "SHARED" },
    })).rpc);
    expect(stored).toMatchObject({ content: "Sofie may recall that Relay memory is owner-scoped.", scope: "SHARED" });

    const listed = resultPayload((await mcpRpc(sofie.credential, "tools/call", {
      name: "relay_memory_list",
      arguments: { limit: 10 },
    })).rpc);
    expect(JSON.stringify(listed)).toContain("Relay memory is owner-scoped");

    const firstSearch = await mcpRpc(sofie.credential, "tools/call", { name: "relay_memory_search", arguments: { query: "owner-scoped" } });
    const retriedSearch = await mcpRpc(sofie.credential, "tools/call", { name: "relay_memory_search", arguments: { query: "owner-scoped" } });
    expect(JSON.stringify(resultPayload(firstSearch.rpc))).toContain("Relay memory is owner-scoped");
    expect(JSON.stringify(resultPayload(retriedSearch.rpc))).toContain("Relay memory is owner-scoped");
    expect(firstSearch.requestId).toEqual(expect.any(String));
  });

  it("denies ungranted tools, isolates owners, and reconnects after rotation", async () => {
    const sofie = await createAgent(accountId, { name: "Sofie", capabilities: ["memory.read", "memory.write"] });
    const githubDenied = await mcpRpc(sofie.credential, "tools/call", { name: "relay_github_repo_list", arguments: {} });
    expect(githubDenied.status).toBe(200);
    expect(errorData(githubDenied.rpc)).toMatchObject({ code: "CAPABILITY_DENIED", capability: "github.repo.read" });

    const factoryDenied = await mcpRpc(sofie.credential, "tools/call", {
      name: "relay_factory_workorder_create",
      arguments: {
        idempotencyKey: "sofie-factory-1",
        title: "Should not create",
        description: "Ungranted factory write",
        kind: "feature",
        acceptanceCriteria: ["none"],
        allowedPaths: ["docs/"],
      },
    });
    expect(errorData(factoryDenied.rpc)).toMatchObject({ code: "CAPABILITY_DENIED", capability: "factory.workorder.create" });

    const invalidArgs = await mcpRpc(sofie.credential, "tools/call", { name: "relay_memory_add", arguments: { content: "" } });
    expect(errorData(invalidArgs.rpc)).toMatchObject({ code: "INVALID_INPUT" });

    await setCapabilityGrant(accountId, sofie.agentId, "github.repo.read", "ALLOW");
    const advertised = await mcpRpc(sofie.credential, "tools/list");
    expect((advertised.rpc.result?.tools ?? []).map((tool) => tool.name)).toContain("relay_github_repo_list");
    const disconnected = await mcpRpc(sofie.credential, "tools/call", { name: "relay_github_repo_list", arguments: {} });
    expect(errorData(disconnected.rpc)).toMatchObject({ code: "CONNECTION_REQUIRED" });

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/user")) return Response.json({ id: 818, login: "relay-sofie", name: "Sofie GitHub" });
      if (url.includes("/user/repos")) return Response.json([{ id: 1, full_name: "relay-test/sofie" }]);
      throw new Error(`Unexpected URL ${url}`);
    }));
    await connectGitHub(accountId, "github_pat_sofie_test_token_long_enough");
    const repos = resultPayload((await mcpRpc(sofie.credential, "tools/call", { name: "relay_github_repo_list", arguments: {} })).rpc);
    expect(JSON.stringify(repos)).toContain("relay-test/sofie");
    expect(JSON.stringify(repos)).not.toContain("github_pat_sofie_test_token_long_enough");

    const otherAccount = await secondAccount();
    const peer = await createAgent(otherAccount, { name: "Peer", capabilities: ["memory.read", "memory.write", "github.repo.read"] });
    const sofieMemory = resultPayload((await mcpRpc(sofie.credential, "tools/call", {
      name: "relay_memory_add",
      arguments: { content: "Sofie-private owner fact.", type: "FACT", scope: "SHARED" },
    })).rpc);
    const peerSearch = resultPayload((await mcpRpc(peer.credential, "tools/call", {
      name: "relay_memory_search",
      arguments: { query: "Sofie-private" },
    })).rpc);
    expect(JSON.stringify(peerSearch)).not.toContain("Sofie-private owner fact.");
    const peerGet = await mcpRpc(peer.credential, "tools/call", { name: "relay_memory_get", arguments: { id: sofieMemory.id } });
    expect(errorData(peerGet.rpc).code).toBe("INVALID_INPUT");
    const peerGithub = await mcpRpc(peer.credential, "tools/call", { name: "relay_github_repo_list", arguments: {} });
    expect(errorData(peerGithub.rpc)).toMatchObject({ code: "CONNECTION_REQUIRED" });

    const rotated = await rotateCredential(accountId, sofie.agentId);
    const stale = await mcpRpc(sofie.credential, "tools/list");
    expect(stale.status).toBe(401);
    expect(errorData(stale.rpc)).toMatchObject({ code: "REVOKED_CREDENTIAL" });
    const recovered = resultPayload((await mcpRpc(rotated.secret, "tools/call", {
      name: "relay_memory_search",
      arguments: { query: "Sofie-private" },
    })).rpc);
    expect(JSON.stringify(recovered)).toContain("Sofie-private owner fact.");

    await revokeCredential(accountId, sofie.agentId);
    const revoked = await mcpRpc(rotated.secret, "tools/list");
    expect(revoked.status).toBe(401);
    expect(errorData(revoked.rpc)).toMatchObject({ code: "REVOKED_CREDENTIAL" });
  });

  it("keeps paid V2 runtime actions closed even if the enable flag is set", async () => {
    expect(runtimeActionsEnabled({
      RELAY_DEPLOYMENT_MODE: "private-preview",
      RELAY_V2_ACTIONS_ENABLED: "true",
    })).toBe(false);
    expect(() => requireRuntimeActionsEnabled({
      RELAY_DEPLOYMENT_MODE: "private-preview",
      RELAY_V2_ACTIONS_ENABLED: "true",
    })).toThrow(/runtime actions are disabled/);
    expect(runtimeActionsEnabled({
      RELAY_DEPLOYMENT_MODE: "limited-beta",
      RELAY_V2_ACTIONS_ENABLED: "false",
    })).toBe(false);

    const sofie = await createAgent(accountId, { name: "Sofie", capabilities: ["memory.read"] });
    const v2Call = await v2McpPost(new Request("https://relay.test/api/v2/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${sofie.credential}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "relay_action_submit", arguments: {} } }),
    }));
    expect(v2Call.status).toBe(200);
    const body = await v2Call.json() as RpcBody;
    expect(errorData(body)).toMatchObject({ code: "CAPABILITY_DENIED" });
    expect(body.error?.message).toMatch(/runtime actions are disabled/);
  });

  it("does not advertise a Deep Agent tool after factory grants", async () => {
    const sofie = await createAgent(accountId, {
      name: "Sofie",
      capabilities: ["memory.read", "memory.write", "github.repo.read", "factory.workorder.create", "factory.workorder.read"],
    });
    await setCapabilityGrant(accountId, sofie.agentId, "factory.workorder.read", "ALLOW");
    const advertised = await mcpRpc(sofie.credential, "tools/list");
    expect((advertised.rpc.result?.tools ?? []).map((tool) => tool.name).join(" ")).not.toMatch(/deep.?agent/i);
  });
});

describe("Sofie → Relay MyEve federation client", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupDatabase();
  });

  it("refuses the MyEve federation path while V2 actions stay closed", async () => {
    vi.stubEnv("RELAY_DEPLOYMENT_MODE", "private-preview");
    vi.stubEnv("RELAY_V2_ACTIONS_ENABLED", "true");
    vi.stubEnv("RELAY_FEDERATION_ENABLED", "true");
    const response = await federationPost(new Request("https://relay.test/api/v2/federation", {
      method: "POST",
      headers: { authorization: "Bearer rly_synthetic", "content-type": "application/json", origin: "https://relay.test" },
      body: JSON.stringify({ operation: "discover", input: {} }),
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "CAPABILITY_DENIED" });
  });

  it("authenticates Sofie identity, discovers peers, and reconnects after rotation", async () => {
    const jay = await freshDatabase();
    const sarah = { accountId: await secondAccount(), principalId: id("prn") };
    await db().insert(principals).values({ id: sarah.principalId, type: "HUMAN", displayName: "Sarah" });
    await db().insert(accountMemberships).values({ accountId: sarah.accountId, principalId: sarah.principalId, role: "OWNER" });
    const bindings = { signer: createLocalEd25519Signer(), keyWrapper: createLocalRsaKeyWrapper(), issuer: "https://relay.test" };
    await provisionFederationCapabilities(bindings.signer);
    await publishRelaySafetyPolicy({
      name: "sofie-client-policy",
      rules: capabilitySchema.options.map((name, index) => ({
        id: `allow-sofie-${index}`,
        effect: "ALLOW",
        match: { capability: { name, version: "1.0" } },
        reasonCode: "TEST_POLICY_ALLOW",
      })),
    }, bindings.signer);
    const sofie = await createAgent(jay.accountId, { name: "Sofie", capabilities: [] });
    const ava = await createAgent(sarah.accountId, { name: "Ava", capabilities: [] });
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    for (const [owner, agent] of [[jay, sofie], [sarah, ava]] as const) {
      await issueAgentPassport({
        accountId: owner.accountId,
        ownerPrincipalId: owner.principalId,
        agentId: agent.agentId,
        policy: {
          trustTier: "REGISTERED",
          capabilityEligibility: capabilitySchema.options.map((name) => ({ name, version: "1.0" })),
          policyReferences: [],
          budgetReferences: [],
          allowedEnvironments: { providerIds: [], minimumAssurance: "registered" },
          dataAccess: [],
          expiresAt,
        },
      }, bindings.signer);
      await registerFederationAgent(owner, {
        agentId: agent.agentId,
        platform: "independent-test-platform",
        capabilities: capabilitySchema.options.map((name) => ({ name, version: "1.0" })),
        discovery: "PUBLIC",
        publicName: agent === sofie ? "Sofie" : "Ava",
      }, bindings.signer);
    }

    vi.stubEnv("RELAY_DEPLOYMENT_MODE", "local");
    vi.stubEnv("RELAY_V2_ACTIONS_ENABLED", "true");
    vi.stubEnv("RELAY_FEDERATION_ENABLED", "true");
    configureV2PlatformBindings({
      signer: bindings.signer,
      keyResolver: { publicKeyForKeyId: async () => undefined },
      federation: { keyWrapper: bindings.keyWrapper, issuer: bindings.issuer },
    });

    const command = async (secret: string, body: object) => {
      const response = await federationPost(new Request("https://relay.test/api/v2/federation", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", origin: "https://relay.test" },
        body: JSON.stringify(body),
      }));
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };

    const unauthenticated = await command("rly_not-a-real-credential", { operation: "discover", input: {} });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body).toMatchObject({ code: "INVALID_CREDENTIAL" });

    const discovered = await command(sofie.credential, { operation: "discover", input: {} });
    expect(discovered.status).toBe(200);
    expect(JSON.stringify(discovered.body)).toContain("Sofie");
    expect(JSON.stringify(discovered.body)).toContain("Ava");
    expect(discovered.body).toMatchObject({ next: null });

    const denied = await command(sofie.credential, {
      operation: "submit",
      input: {
        target: `relay://${sarah.accountId}/${ava.agentId}`,
        resource: "inbox",
        capability: "message.send",
        idempotencyKey: "sofie-ungranted-1",
        expiresAt,
        payload: { body: "Should not send" },
      },
    });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: "CAPABILITY_DENIED" });

    const rotated = await rotateCredential(jay.accountId, sofie.agentId);
    const stale = await command(sofie.credential, { operation: "discover", input: {} });
    expect(stale.status).toBe(401);
    const reconnect = await command(rotated.secret, { operation: "discover", input: {} });
    expect(reconnect.status).toBe(200);
    expect(JSON.stringify(reconnect.body)).toContain("Ava");

    await revokeCredential(jay.accountId, sofie.agentId);
    const revoked = await command(rotated.secret, { operation: "discover", input: {} });
    expect(revoked.status).toBe(401);
  });
});
