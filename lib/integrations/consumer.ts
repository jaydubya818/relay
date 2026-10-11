import { z } from "zod";
import { actionIntentSchema, canonicalHash } from "@/lib/v2/contracts";
import { IntegrationError, integrationScopeSchema, toolkitSchema } from "./contracts";

const identity = z.string().min(1).max(255);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);

/** Proposed authenticated consumer payload. Parsing checks syntax/binding, never grants authority.
 * Runtime credential and online lease stay in existing Relay authentication headers. */
export const consumerReadRequestSchema = z.object({
  schemaVersion: z.literal("relay.integration-read.v1"),
  scope: integrationScopeSchema,
  connectionId: identity,
  toolkit: toolkitSchema,
  tool: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  toolVersion: z.string().regex(/^\d{8}_\d+$/),
  toolSchemaHash: digest,
  authorityVersion: z.number().int().positive(),
  ownerPolicyRevision: z.number().int().positive(),
  relayPolicyRevision: identity,
  harnessId: identity,
  effect: z.literal("READ"),
  targetResource: identity,
  expiresAt: z.string().datetime(),
  action: actionIntentSchema,
}).strict();
export type ConsumerReadRequest = z.infer<typeof consumerReadRequestSchema>;

/** Material placed inside canonical ActionIntent.resource so existing action hashing
 * and approval comparison cover the complete external tool binding. */
export function consumerResource(input: Omit<ConsumerReadRequest, "action">, idempotencyKey: string) {
  return { type: "integration_tool", ids: [input.connectionId, input.targetResource], attributes: {
    ...input.scope, connectionId: input.connectionId, provider: "composio", toolkit: input.toolkit,
    tool: input.tool, toolVersion: input.toolVersion, toolSchemaHash: input.toolSchemaHash,
    authorityVersion: input.authorityVersion, ownerPolicyRevision: input.ownerPolicyRevision,
    relayPolicyRevision: input.relayPolicyRevision, harnessId: input.harnessId,
    effect: input.effect, expiresAt: input.expiresAt, idempotencyKey,
  } };
}

export function parseConsumerReadRequest(value: unknown): ConsumerReadRequest {
  const request = consumerReadRequestSchema.parse(value);
  const { action } = request;
  if (action.accountId !== request.scope.accountId || action.agentId !== request.scope.agentId
    || canonicalHash(action.resource) !== canonicalHash(consumerResource(request, action.idempotencyKey))
    || canonicalHash({ capability: action.capability, resource: action.resource, parameters: action.parameters }) !== action.canonicalHash) {
    throw new IntegrationError("ACTION_BINDING_MISMATCH");
  }
  if (Date.parse(request.expiresAt) <= Date.now()) throw new IntegrationError("REQUEST_EXPIRED");
  return request;
}
