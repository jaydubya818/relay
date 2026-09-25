import { z } from "zod";
import { RelayError } from "@/lib/errors";
import { executeFederationCommand } from "./api";
import { authenticateFederationAgent } from "./service";
import type { FederationBindings } from "./transport";
const tools = [
  ["relay_discover_agents", "discover"], ["relay_query_knowledge", "knowledge.query"], ["relay_send_message", "message.send"],
  ["relay_request_work", "work.request"], ["relay_share_artifact", "artifact.share"], ["relay_get_request", "get"], ["relay_respond", "respond"], ["relay_poll_inbox", "poll"], ["relay_acknowledge_result", "acknowledge"],
] as const;
const string = { type: "string" };
const stringArray = { type: "array", items: string };
const payloadSchemas: Record<string, object> = {
  "knowledge.query": { type: "object", required: ["mode", "query", "requestedTypes", "topics", "maxRecords"], properties: { mode: { enum: ["RECORD_RETRIEVAL", "ANSWER_QUERY"] }, query: { type: "string", maxLength: 4000 }, requestedTypes: stringArray, topics: stringArray, maxRecords: { type: "integer", minimum: 1, maximum: 50 } }, additionalProperties: false },
  "message.send": { type: "object", required: ["body"], properties: { body: { type: "string", maxLength: 16000 }, subject: string, replyTo: string }, additionalProperties: false },
  "work.request": { type: "object", required: ["category", "task", "expectedOutput", "budget", "deadline", "context"], properties: { category: { enum: ["research", "analysis", "summarization", "artifact_generation"] }, task: string, expectedOutput: string, deadline: string, context: { ...stringArray, description: "Completed artifact-share request IDs between these Agents." }, budget: { type: "object", required: ["runtimeSeconds", "cost", "modelSteps", "delegatedWorkers"], properties: { runtimeSeconds: { type: "integer", minimum: 1, maximum: 3600 }, cost: string, modelSteps: { type: "integer", minimum: 1, maximum: 100 }, delegatedWorkers: { const: 0 } }, additionalProperties: false } }, additionalProperties: false },
  "artifact.share": { type: "object", required: ["reference", "name", "type", "size", "checksum", "visibility", "expiresAt", "retrieval"], properties: { reference: string, name: string, type: string, size: { type: "integer", minimum: 1, maximum: 10485760 }, checksum: string, visibility: { enum: ["SHARED", "UNLISTED", "PUBLIC"] }, expiresAt: string, retrieval: { type: "object", required: ["url", "audience", "expiresAt"], properties: { url: string, audience: string, expiresAt: string }, additionalProperties: false } }, additionalProperties: false },
};
function toolSchema(operation: string) {
  if (operation.includes(".")) return { type: "object", required: ["target", "resource", "idempotencyKey", "expiresAt", "payload"], properties: { target: string, resource: string, idempotencyKey: string, expiresAt: string, conversationId: string, payload: payloadSchemas[operation] }, additionalProperties: false };
  if (operation === "poll") return { type: "object", properties: {}, additionalProperties: false };
  if (operation === "discover") return { type: "object", properties: { topic: string, after: string }, additionalProperties: false };
  if (operation === "respond") return { type: "object", required: ["requestId", "input"], properties: { requestId: string, input: { type: "object", required: ["status"], properties: { status: { enum: ["ACCEPTED", "REJECTED", "REQUIRE_APPROVAL", "RUNNING", "COMPLETED"] }, result: { type: "object", description: "Protocol response defined in the Relay federation 1.0 contract. No hidden reasoning." } }, additionalProperties: false } }, additionalProperties: false };
  return { type: "object", required: ["requestId"], properties: { requestId: string }, additionalProperties: false };
}
export async function handleFederationMcp(secret: string, value: unknown, bindings: FederationBindings) {
  await authenticateFederationAgent(secret);
  const request = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number()]).optional(), method: z.string(), params: z.unknown().optional() }).strict().parse(value);
  if (request.method === "notifications/initialized" && request.id === undefined) return null;
  if (request.id === undefined) throw new RelayError("INVALID_INPUT", "An RPC request ID is required.");
  try {
    let result: unknown;
    if (request.method === "initialize") {
      const params = z.object({ protocolVersion: z.string() }).passthrough().parse(request.params);
      result = { protocolVersion: ["2025-11-25", "2025-06-18"].includes(params.protocolVersion) ? params.protocolVersion : "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "relay-federation", version: "1.0" } };
    } else if (request.method === "ping") result = {};
    else if (request.method === "tools/list") result = { tools: tools.map(([name, operation]) => ({ name, description: `Federation ${operation}; receiving platform authorization is required.`, inputSchema: toolSchema(operation) })) };
    else if (request.method === "tools/call") {
      const params = z.object({ name: z.string(), arguments: z.record(z.unknown()).default({}) }).strict().parse(request.params);
      const tool = tools.find(([name]) => name === params.name);
      if (!tool) throw new RelayError("INVALID_INPUT", "Unknown federation tool.");
      const operation = tool[1];
      const command = operation.includes(".") ? { operation: "submit", input: { ...params.arguments, capability: operation } }
        : operation === "discover" ? { operation, input: params.arguments } : { ...params.arguments, operation };
      const outcome = await executeFederationCommand(secret, command, bindings);
      result = { content: [{ type: "text", text: JSON.stringify(outcome) }], structuredContent: outcome, isError: false };
    } else return { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Unsupported federation MCP method." } };
    return { jsonrpc: "2.0", id: request.id, result };
  } catch (error) {
    if (error instanceof z.ZodError) return { jsonrpc: "2.0", id: request.id, error: { code: -32602, message: "Invalid federation arguments." } };
    if (error instanceof RelayError) return { jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: error.message }], isError: true } };
    throw error;
  }
}
