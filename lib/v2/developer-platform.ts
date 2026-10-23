import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, withTransaction } from "@/lib/db";
import { controlOutbox, runtimeClients, taskCommands, v2Tasks } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { actionIntentSchema, canonicalHash, type ActionIntent } from "@/lib/v2/contracts";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { redactForEvidence } from "@/lib/v2/evidence/redaction";
import { authorizeLeaseCall, type LeaseKeyResolver } from "@/lib/v2/leases";
import { authenticateRuntimeClient } from "@/lib/v2/runtime-clients";

export const V2_API_VERSION = "2026-09-13";
export const MCP_MODERN_VERSION = "2026-07-28";
export const MCP_LEGACY_VERSIONS = ["2025-11-25", "2025-06-18"] as const;

export const runtimeActionResultSchema = z.object({
  schemaVersion: z.literal("relay.runtime-action-result.v1"),
  commandId: z.string().regex(/^cmd_/),
  taskId: z.string().regex(/^tsk_/),
  actionIntentId: z.string().regex(/^act_/),
  state: z.enum(["QUEUED", "PROCESSING", "COMPLETED", "CANCELLED", "DEAD_LETTERED"]),
  durable: z.literal(true),
  idempotentReplay: z.boolean(),
}).strict();

export interface DeveloperAccessTokenVerifier {
  verify(input: { token: string; expectedResource: string }): Promise<{
    accountId: string;
    runtimeClientId: string;
    audience: string;
    expiresAt: string;
  }>;
}

export async function authenticateDeveloperClient(input: {
  accountId: string;
  credential: string;
  expectedResource: string;
  oauthVerifier?: DeveloperAccessTokenVerifier;
}) {
  if (!input.accountId) throw new RelayError("INVALID_CREDENTIAL", "Relay account context is required.", undefined, 401);
  if (input.credential.startsWith("rrtc_")) {
    return {
      accountId: input.accountId,
      ...await authenticateRuntimeClient(input.accountId, input.credential),
      authentication: "runtime_credential" as const,
    };
  }
  if (!input.oauthVerifier) throw new RelayError("INVALID_CREDENTIAL", "OAuth access token verification is not configured.", undefined, 401);
  const claims = await input.oauthVerifier.verify({ token: input.credential, expectedResource: input.expectedResource });
  if (claims.accountId !== input.accountId || claims.audience !== input.expectedResource || Date.parse(claims.expiresAt) <= Date.now()) {
    throw new RelayError("INVALID_CREDENTIAL", "OAuth token tenant, resource, or expiry is invalid.", undefined, 401);
  }
  const [runtime] = await db().select({ id: runtimeClients.id }).from(runtimeClients).where(and(
    eq(runtimeClients.accountId, claims.accountId),
    eq(runtimeClients.id, claims.runtimeClientId),
    isNull(runtimeClients.revokedAt),
  )).limit(1);
  if (!runtime) throw new RelayError("INVALID_CREDENTIAL", "OAuth runtime registration is unavailable or revoked.", undefined, 401);
  return {
    accountId: claims.accountId,
    runtimeClientId: claims.runtimeClientId,
    verificationStatus: "VERIFIED" as const,
    selfDeclaredProduct: "oauth-client",
    verifiedProduct: null,
    authentication: "oauth" as const,
  };
}

type RuntimeActionCommandPayload = {
  schemaVersion: "relay.runtime-action-command.v1";
  runtimeClientId: string;
  actionIntentId: string;
  actionCanonicalHash: string;
  redactedAction: unknown;
  leaseId: string;
  submittedAt: string;
};

function commandState(status: string) {
  return status === "PENDING" ? "QUEUED" : status;
}

export async function submitDurableRuntimeAction(input: {
  accountId: string;
  runtimeCredential: string;
  expectedResource: string;
  action: ActionIntent;
  leaseToken: string;
  expectedAudience: string;
  workloadId: string;
  idempotencyKey: string;
  oauthVerifier?: DeveloperAccessTokenVerifier;
}, signer: AuditSigner, resolver: LeaseKeyResolver) {
  const client = await authenticateDeveloperClient({
    accountId: input.accountId,
    credential: input.runtimeCredential,
    expectedResource: input.expectedResource,
    oauthVerifier: input.oauthVerifier,
  });
  const action = actionIntentSchema.parse(input.action);
  if (
    action.accountId !== input.accountId
    || action.runtimeClientId !== client.runtimeClientId
    || canonicalHash({ capability: action.capability, resource: action.resource, parameters: action.parameters }) !== action.canonicalHash
  ) throw new RelayError("CAPABILITY_DENIED", "Runtime action identity or canonical binding is invalid.", undefined, 403);
  if (!input.idempotencyKey || input.idempotencyKey.length > 255) throw new RelayError("INVALID_INPUT", "A bounded idempotency key is required.");

  const durableKey = `runtime-action:${client.runtimeClientId}:${input.idempotencyKey}`;
  return await withTransaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`runtime-action:${input.accountId}:${durableKey}`}, 0))`);
    const [existing] = await transaction.select().from(taskCommands).where(and(
      eq(taskCommands.accountId, input.accountId),
      eq(taskCommands.idempotencyKey, durableKey),
    )).limit(1);
    if (existing) {
      const payload = existing.payload as RuntimeActionCommandPayload;
      if (payload.actionCanonicalHash !== action.canonicalHash) {
        throw new RelayError("INVALID_INPUT", "Runtime action idempotency key was reused with a different action.", undefined, 409);
      }
      return runtimeActionResultSchema.parse({
        schemaVersion: "relay.runtime-action-result.v1",
        commandId: existing.id,
        taskId: existing.taskId,
        actionIntentId: payload.actionIntentId,
        state: commandState(existing.status),
        durable: true,
        idempotentReplay: true,
      });
    }

    const [task] = await transaction.select().from(v2Tasks).where(and(
      eq(v2Tasks.accountId, input.accountId),
      eq(v2Tasks.id, action.taskId),
      eq(v2Tasks.agentId, action.agentId),
      inArray(v2Tasks.status, ["QUEUED", "STARTING", "RUNNING", "PAUSED", "WAITING_APPROVAL"]),
    )).limit(1);
    if (!task) throw new RelayError("CAPABILITY_DENIED", "Runtime action task is unavailable.", undefined, 403);

    const authority = await authorizeLeaseCall({
      token: input.leaseToken,
      expectedAccountId: input.accountId,
      expectedAudience: input.expectedAudience,
      expectedWorkloadId: input.workloadId,
      action,
      callId: `runtime:${client.runtimeClientId}:${input.idempotencyKey}`,
      online: true,
    }, resolver, signer);
    const commandId = id("cmd");
    const submittedAt = now();
    const payload: RuntimeActionCommandPayload = {
      schemaVersion: "relay.runtime-action-command.v1",
      runtimeClientId: client.runtimeClientId,
      actionIntentId: action.id,
      actionCanonicalHash: action.canonicalHash,
      redactedAction: redactForEvidence(action),
      leaseId: authority.leaseId,
      submittedAt,
    };
    await transaction.insert(taskCommands).values({
      id: commandId,
      accountId: input.accountId,
      taskId: task.id,
      kind: "EXECUTE_ACTION",
      idempotencyKey: durableKey,
      payload,
    });
    await transaction.insert(controlOutbox).values({
      id: id("out"),
      accountId: input.accountId,
      aggregateType: "task_command",
      aggregateId: commandId,
      type: "task.command.ready",
      payload: { commandId, taskId: task.id, actionIntentId: action.id },
      idempotencyKey: `runtime-action-ready:${commandId}`,
    });
    await appendAuditRecordInTransaction(transaction, {
      accountId: input.accountId,
      agentId: action.agentId,
      runtimeClientId: action.runtimeClientId,
      taskId: action.taskId,
      actionIntentId: action.id,
      leaseId: authority.leaseId,
      eventType: "runtime.action.accepted",
      outcome: "QUEUED",
      details: { commandId, apiVersion: V2_API_VERSION, authentication: client.authentication },
    }, signer);
    return runtimeActionResultSchema.parse({
      schemaVersion: "relay.runtime-action-result.v1",
      commandId,
      taskId: task.id,
      actionIntentId: action.id,
      state: "QUEUED",
      durable: true,
      idempotentReplay: false,
    });
  });
}

export async function getDurableRuntimeAction(input: {
  accountId: string;
  runtimeCredential: string;
  expectedResource: string;
  taskId: string;
  commandId: string;
  oauthVerifier?: DeveloperAccessTokenVerifier;
}) {
  const client = await authenticateDeveloperClient({
    accountId: input.accountId,
    credential: input.runtimeCredential,
    expectedResource: input.expectedResource,
    oauthVerifier: input.oauthVerifier,
  });
  const [command] = await db().select().from(taskCommands).where(and(
    eq(taskCommands.accountId, input.accountId),
    eq(taskCommands.id, input.commandId),
    eq(taskCommands.taskId, input.taskId),
  )).limit(1);
  const payload = command?.payload as RuntimeActionCommandPayload | undefined;
  if (!command || payload?.runtimeClientId !== client.runtimeClientId || !payload.actionIntentId) {
    throw new RelayError("INVALID_INPUT", "Runtime action not found.", undefined, 404);
  }
  return runtimeActionResultSchema.parse({
    schemaVersion: "relay.runtime-action-result.v1",
    commandId: command.id,
    taskId: command.taskId,
    actionIntentId: payload.actionIntentId,
    state: commandState(command.status),
    durable: true,
    idempotentReplay: true,
  });
}

export type V2McpRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown };
export interface V2McpContext {
  accountId: string;
  runtimeCredential: string;
  expectedResource: string;
  leaseToken: string;
  expectedAudience: string;
  workloadId: string;
  protocolVersion?: string;
  oauthVerifier?: DeveloperAccessTokenVerifier;
}

const submitTool = {
  name: "relay_action_submit",
  title: "Submit Relay action",
  description: "Durably submit one canonical Relay V2 action under its workload-bound capability lease.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["action", "idempotencyKey"],
    properties: {
      action: { type: "object" },
      idempotencyKey: { type: "string", minLength: 8, maxLength: 255 },
    },
  },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "commandId", "taskId", "actionIntentId", "state", "durable", "idempotentReplay"],
  },
} as const;

export async function handleV2Mcp(request: V2McpRequest, context: V2McpContext, signer: AuditSigner, resolver: LeaseKeyResolver) {
  if (request.jsonrpc !== "2.0") throw new RelayError("INVALID_INPUT", "MCP requires JSON-RPC 2.0.");
  if (request.method === "server/discover") {
    return {
      protocolVersions: [MCP_MODERN_VERSION, ...MCP_LEGACY_VERSIONS],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "relay-v2", version: V2_API_VERSION },
      stateless: true,
    };
  }
  if (request.method === "initialize") {
    const requested = z.object({ protocolVersion: z.string() }).passthrough().parse(request.params).protocolVersion;
    const selected = (MCP_LEGACY_VERSIONS as readonly string[]).includes(requested) ? requested : MCP_LEGACY_VERSIONS[0];
    return { protocolVersion: selected, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "relay-v2", version: V2_API_VERSION } };
  }
  const version = context.protocolVersion ?? MCP_LEGACY_VERSIONS[0];
  if (version !== MCP_MODERN_VERSION && !(MCP_LEGACY_VERSIONS as readonly string[]).includes(version)) {
    throw new RelayError("INVALID_INPUT", "Unsupported MCP protocol version.", undefined, 400);
  }
  await authenticateDeveloperClient({
    accountId: context.accountId,
    credential: context.runtimeCredential,
    expectedResource: context.expectedResource,
    oauthVerifier: context.oauthVerifier,
  });
  if (request.method === "ping") return {};
  if (request.method === "tools/list") {
    return { tools: [submitTool], ...(version === MCP_MODERN_VERSION ? { ttlMs: 60_000, cacheScope: "private" } : {}) };
  }
  if (request.method === "tools/call") {
    const params = z.object({
      name: z.literal("relay_action_submit"),
      arguments: z.object({ action: actionIntentSchema, idempotencyKey: z.string().min(8).max(255) }).strict(),
    }).passthrough().parse(request.params);
    const result = await submitDurableRuntimeAction({
      accountId: context.accountId,
      runtimeCredential: context.runtimeCredential,
      expectedResource: context.expectedResource,
      action: params.arguments.action,
      leaseToken: context.leaseToken,
      expectedAudience: context.expectedAudience,
      workloadId: context.workloadId,
      idempotencyKey: params.arguments.idempotencyKey,
      oauthVerifier: context.oauthVerifier,
    }, signer, resolver);
    return {
      content: [{ type: "text", text: `Relay durably queued action ${result.actionIntentId} as ${result.commandId}.` }],
      structuredContent: result,
      isError: false,
    };
  }
  throw new RelayError("INVALID_INPUT", `Unsupported MCP method: ${request.method ?? "missing"}.`);
}

export function protectedResourceMetadata(resource: string, authorizationServers: string[]) {
  const canonical = new URL(resource).toString();
  return {
    resource: canonical,
    authorization_servers: authorizationServers.map((server) => new URL(server).toString()),
    bearer_methods_supported: ["header"],
    resource_documentation: `${canonical.replace(/\/$/, "")}/docs/v2`,
  };
}
