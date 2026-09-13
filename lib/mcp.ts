import { randomUUID } from "node:crypto";
import { z } from "zod";
import { recordActivity } from "@/lib/activity";
import { authenticateAgent } from "@/lib/auth";
import { listAllowedCapabilities } from "@/lib/authorization";
import { RelayError } from "@/lib/errors";
import { executeCapability } from "@/lib/executor";
import { checkAgentRateLimit } from "@/lib/rate-limit";
import type { CapabilityName } from "@/lib/types";

type McpRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };

const toolDefinitions = {
  relay_memory_add: {
    capability: "memory.write",
    action: "memory.add",
    description: "Store durable Relay memory.",
    inputSchema: { type: "object", required: ["content"], properties: { content: { type: "string" }, type: { type: "string", enum: ["FACT", "PREFERENCE", "PROJECT", "DECISION", "OTHER"] }, scope: { type: "string", enum: ["SHARED", "AGENT_PRIVATE"] } } },
  },
  relay_memory_search: {
    capability: "memory.read",
    action: "memory.search",
    description: "Search authorized shared and private Relay memory.",
    inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" }, type: { type: "string" }, scope: { type: "string" }, limit: { type: "number" } } },
  },
  relay_memory_get: {
    capability: "memory.read",
    action: "memory.get",
    description: "Get one authorized Relay memory.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  relay_memory_list: {
    capability: "memory.read",
    action: "memory.list",
    description: "List authorized Relay memories.",
    inputSchema: { type: "object", properties: { type: { type: "string" }, scope: { type: "string" }, limit: { type: "number" } } },
  },
  relay_github_repo_list: {
    capability: "github.repo.read",
    action: "github.repo.list",
    provider: "GITHUB",
    description: "List repositories for the connected account-level GitHub connection.",
    inputSchema: { type: "object", properties: {} },
  },
  relay_github_repo_get: {
    capability: "github.repo.read",
    action: "github.repo.get",
    provider: "GITHUB",
    description: "Read a repository through the account-level GitHub connection.",
    inputSchema: { type: "object", required: ["owner", "repo"], properties: { owner: { type: "string" }, repo: { type: "string" } } },
  },
} as const;

export type RelayToolName = keyof typeof toolDefinitions;

const toolInputSchemas: Record<RelayToolName, z.ZodTypeAny> = {
  relay_memory_add: z.object({
    content: z.string().trim().min(1).max(10_000),
    type: z.enum(["FACT", "PREFERENCE", "PROJECT", "DECISION", "OTHER"]).default("OTHER"),
    scope: z.enum(["SHARED", "AGENT_PRIVATE"]).default("SHARED"),
  }),
  relay_memory_search: z.object({
    query: z.string().trim().min(1).max(1_000),
    type: z.enum(["FACT", "PREFERENCE", "PROJECT", "DECISION", "OTHER"]).optional(),
    scope: z.enum(["SHARED", "AGENT_PRIVATE"]).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  relay_memory_get: z.object({ id: z.string().min(1).max(100) }),
  relay_memory_list: z.object({
    type: z.enum(["FACT", "PREFERENCE", "PROJECT", "DECISION", "OTHER"]).optional(),
    scope: z.enum(["SHARED", "AGENT_PRIVATE"]).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  relay_github_repo_list: z.object({}),
  relay_github_repo_get: z.object({ owner: z.string().trim().min(1).max(100), repo: z.string().trim().min(1).max(100) }),
};

export async function handleMcp(secret: string, request: McpRequest, requestId: string = randomUUID()) {
  const auth = authenticateAgent(secret);
  if (!auth.ok) {
    if (auth.principal) {
      recordActivity({ accountId: auth.principal.accountId, agentId: auth.principal.agentId, sessionId: requestId, capability: "agent.authenticate", action: request.method ?? "unknown", status: "DENIED", durationMs: 0 });
    }
    throw new RelayError(auth.code, auth.code === "REVOKED_CREDENTIAL" ? "This Relay credential has been revoked." : "Relay agent credential is invalid.", undefined, 401);
  }
  checkAgentRateLimit(auth.principal.credentialId);

  if (request.method === "initialize") {
    return { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: true } }, serverInfo: { name: "relay", version: "0.1.0" } };
  }
  if (request.method === "ping") return {};
  if (request.method === "tools/list") {
    const allowed = new Set(listAllowedCapabilities(auth.principal.agentId));
    return {
      tools: Object.entries(toolDefinitions)
        .filter(([, definition]) => allowed.has(definition.capability as CapabilityName))
        .map(([name, definition]) => ({ name, description: definition.description, inputSchema: definition.inputSchema })),
    };
  }
  if (request.method === "tools/call") {
    const name = request.params?.name as RelayToolName;
    const definition = toolDefinitions[name];
    if (!definition) throw new RelayError("INVALID_INPUT", "Unknown Relay MCP tool.");
    const parsedArguments = toolInputSchemas[name].safeParse(request.params?.arguments ?? {});
    if (!parsedArguments.success) throw new RelayError("INVALID_INPUT", "Tool arguments are invalid.", definition.capability);
    const result = await executeCapability({
      principal: auth.principal,
      capability: definition.capability,
      action: definition.action,
      provider: "provider" in definition ? definition.provider : undefined,
      sessionId: requestId,
      arguments: parsedArguments.data,
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
  throw new RelayError("INVALID_INPUT", `Unsupported MCP method: ${request.method ?? "missing"}.`);
}
