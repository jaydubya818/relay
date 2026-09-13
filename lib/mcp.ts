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
  relay_sandbox_create: {
    capability: "sandbox.create", action: "sandbox.create", provider: "SANDBOX",
    description: "Create an isolated Relay sandbox owned by this Agent.",
    inputSchema: { type: "object", properties: { ttlSeconds: { type: "number" }, timeoutMs: { type: "number" }, cpuLimit: { type: "number" }, memoryMb: { type: "number" }, maxOutputBytes: { type: "number" }, network: { type: "string", enum: ["NONE", "OPEN"] } } },
  },
  relay_sandbox_exec: {
    capability: "sandbox.exec", action: "sandbox.exec", provider: "SANDBOX",
    description: "Execute a bounded command in an authorized Relay sandbox.",
    inputSchema: { type: "object", required: ["sandboxId", "command"], properties: { sandboxId: { type: "string" }, command: { type: "string" } } },
  },
  relay_sandbox_file_read: {
    capability: "sandbox.file.read", action: "sandbox.file.read", provider: "SANDBOX",
    description: "Read a file from an authorized Relay sandbox.",
    inputSchema: { type: "object", required: ["sandboxId", "path"], properties: { sandboxId: { type: "string" }, path: { type: "string" } } },
  },
  relay_sandbox_file_write: {
    capability: "sandbox.file.write", action: "sandbox.file.write", provider: "SANDBOX",
    description: "Write a file in an authorized Relay sandbox.",
    inputSchema: { type: "object", required: ["sandboxId", "path", "content"], properties: { sandboxId: { type: "string" }, path: { type: "string" }, content: { type: "string" } } },
  },
  relay_sandbox_file_list: {
    capability: "sandbox.file.list", action: "sandbox.file.list", provider: "SANDBOX",
    description: "List files in an authorized Relay sandbox.",
    inputSchema: { type: "object", required: ["sandboxId"], properties: { sandboxId: { type: "string" }, path: { type: "string" } } },
  },
  relay_sandbox_destroy: {
    capability: "sandbox.destroy", action: "sandbox.destroy", provider: "SANDBOX",
    description: "Destroy an authorized Relay sandbox.",
    inputSchema: { type: "object", required: ["sandboxId"], properties: { sandboxId: { type: "string" } } },
  },
  relay_browser_create: {
    capability: "browser.create", action: "browser.create", provider: "BROWSER",
    description: "Create an isolated Relay browser session owned by this Agent.",
    inputSchema: { type: "object", properties: { ttlSeconds: { type: "number" }, operationTimeoutMs: { type: "number" }, maxExtractChars: { type: "number" }, network: { type: "string", enum: ["PUBLIC_ONLY", "OPEN"] } } },
  },
  relay_browser_navigate: {
    capability: "browser.navigate", action: "browser.navigate", provider: "BROWSER",
    description: "Navigate an authorized Relay browser session.",
    inputSchema: { type: "object", required: ["browserSessionId", "url"], properties: { browserSessionId: { type: "string" }, url: { type: "string" } } },
  },
  relay_browser_click: {
    capability: "browser.click", action: "browser.click", provider: "BROWSER",
    description: "Click an element in an authorized Relay browser session.",
    inputSchema: { type: "object", required: ["browserSessionId", "selector"], properties: { browserSessionId: { type: "string" }, selector: { type: "string" } } },
  },
  relay_browser_type: {
    capability: "browser.type", action: "browser.type", provider: "BROWSER",
    description: "Type into an element in an authorized Relay browser session.",
    inputSchema: { type: "object", required: ["browserSessionId", "selector", "text"], properties: { browserSessionId: { type: "string" }, selector: { type: "string" }, text: { type: "string" } } },
  },
  relay_browser_extract: {
    capability: "browser.extract", action: "browser.extract", provider: "BROWSER",
    description: "Extract bounded text from an authorized Relay browser session.",
    inputSchema: { type: "object", required: ["browserSessionId"], properties: { browserSessionId: { type: "string" }, selector: { type: "string" } } },
  },
  relay_browser_screenshot: {
    capability: "browser.screenshot", action: "browser.screenshot", provider: "BROWSER",
    description: "Capture a PNG screenshot of an authorized Relay browser session.",
    inputSchema: { type: "object", required: ["browserSessionId"], properties: { browserSessionId: { type: "string" } } },
  },
  relay_browser_close: {
    capability: "browser.close", action: "browser.close", provider: "BROWSER",
    description: "Close an authorized Relay browser session.",
    inputSchema: { type: "object", required: ["browserSessionId"], properties: { browserSessionId: { type: "string" } } },
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
  relay_sandbox_create: z.object({
    ttlSeconds: z.number().int().min(60).max(86_400).optional(), timeoutMs: z.number().int().min(100).max(120_000).optional(),
    cpuLimit: z.number().positive().max(4).optional(), memoryMb: z.number().int().min(64).max(4096).optional(),
    maxOutputBytes: z.number().int().min(1024).max(1024 * 1024).optional(), network: z.enum(["NONE", "OPEN"]).optional(),
  }),
  relay_sandbox_exec: z.object({ sandboxId: z.string().min(1).max(100), command: z.string().trim().min(1).max(10_000) }),
  relay_sandbox_file_read: z.object({ sandboxId: z.string().min(1).max(100), path: z.string().min(1).max(500) }),
  relay_sandbox_file_write: z.object({ sandboxId: z.string().min(1).max(100), path: z.string().min(1).max(500), content: z.string().max(1024 * 1024) }),
  relay_sandbox_file_list: z.object({ sandboxId: z.string().min(1).max(100), path: z.string().max(500).default("") }),
  relay_sandbox_destroy: z.object({ sandboxId: z.string().min(1).max(100) }),
  relay_browser_create: z.object({ ttlSeconds: z.number().int().min(60).max(86_400).optional(), operationTimeoutMs: z.number().int().min(500).max(60_000).optional(), maxExtractChars: z.number().int().min(1_000).max(500_000).optional(), network: z.enum(["PUBLIC_ONLY", "OPEN"]).optional() }),
  relay_browser_navigate: z.object({ browserSessionId: z.string().min(1).max(100), url: z.string().url().max(2_000) }),
  relay_browser_click: z.object({ browserSessionId: z.string().min(1).max(100), selector: z.string().min(1).max(1_000) }),
  relay_browser_type: z.object({ browserSessionId: z.string().min(1).max(100), selector: z.string().min(1).max(1_000), text: z.string().max(100_000) }),
  relay_browser_extract: z.object({ browserSessionId: z.string().min(1).max(100), selector: z.string().min(1).max(1_000).optional() }),
  relay_browser_screenshot: z.object({ browserSessionId: z.string().min(1).max(100) }),
  relay_browser_close: z.object({ browserSessionId: z.string().min(1).max(100) }),
};

export async function handleMcp(secret: string, request: McpRequest, requestId: string = randomUUID()) {
  const auth = await authenticateAgent(secret);
  if (!auth.ok) {
    if (auth.principal) {
      await recordActivity({ accountId: auth.principal.accountId, agentId: auth.principal.agentId, sessionId: requestId, capability: "agent.authenticate", action: request.method ?? "unknown", status: "DENIED", durationMs: 0 });
    }
    throw new RelayError(auth.code, auth.code === "REVOKED_CREDENTIAL" ? "This Relay credential has been revoked." : "Relay agent credential is invalid.", undefined, 401);
  }
  checkAgentRateLimit(auth.principal.credentialId);

  if (request.method === "initialize") {
    return { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: true } }, serverInfo: { name: "relay", version: "0.1.0" } };
  }
  if (request.method === "ping") return {};
  if (request.method === "tools/list") {
    const allowed = new Set(await listAllowedCapabilities(auth.principal.accountId, auth.principal.agentId));
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
