import { z } from "zod";
import { canonicalHash } from "@/lib/v2/contracts";

const identity = z.string().trim().min(1).max(255);
export const integrationScopeSchema = z.object({
  accountId: identity, ownerPrincipalId: identity, installationId: identity, agentId: identity,
}).strict();
export type IntegrationScope = z.infer<typeof integrationScopeSchema>;
export const toolkitSchema = z.enum(["github", "gmail", "googlecalendar", "slack"]);
export type Toolkit = z.infer<typeof toolkitSchema>;
export const effectSchema = z.enum(["READ", "PRIVATE_WRITE", "EXTERNAL_WRITE", "FINANCIAL", "DESTRUCTIVE"]);

/** Metadata extension of a canonical Relay connection, never an OAuth token store. */
export const integrationBindingSchema = integrationScopeSchema.extend({
  connectionId: identity, provider: z.literal("composio"), toolkit: toolkitSchema,
  providerUserId: identity, connectedAccountId: identity, authConfigId: identity,
  custody: z.literal("COMPOSIO"), scopes: z.array(identity).max(100),
  authorityVersion: z.number().int().positive(),
  status: z.enum(["REQUIRES_SETUP", "CONNECTED", "EXPIRED", "DISABLED", "REVOKED", "ERROR"]),
  expiresAt: z.string().datetime().nullable(), revokedAt: z.string().datetime().nullable(),
}).strict();
export type IntegrationBinding = z.infer<typeof integrationBindingSchema>;

/** Opaque external namespace: no email address or human-readable identity sent to Composio. */
export function providerUserId(scope: IntegrationScope) {
  return `relay_${canonicalHash(integrationScopeSchema.parse(scope)).slice(7)}`;
}

export function assertBindingIdentity(scopeInput: IntegrationScope, input: IntegrationBinding) {
  const scope = integrationScopeSchema.parse(scopeInput);
  const binding = integrationBindingSchema.parse(input);
  for (const key of ["accountId", "ownerPrincipalId", "installationId", "agentId"] as const) {
    if (scope[key] !== binding[key]) throw new IntegrationError("SCOPE_MISMATCH");
  }
  if (binding.providerUserId !== providerUserId(scope)) throw new IntegrationError("SCOPE_MISMATCH");
  return binding;
}

export function assertBinding(scopeInput: IntegrationScope, input: IntegrationBinding) {
  const binding = assertBindingIdentity(scopeInput, input);
  if (binding.revokedAt || binding.status === "REVOKED") throw new IntegrationError("CONNECTION_REVOKED");
  if (binding.status !== "CONNECTED" || (binding.expiresAt && Date.parse(binding.expiresAt) <= Date.now())) {
    throw new IntegrationError("CONNECTION_UNAVAILABLE");
  }
  return binding;
}

export class IntegrationError extends Error {
  constructor(readonly code: string, readonly outcome: "NOT_DISPATCHED" | "UNKNOWN" = "NOT_DISPATCHED", readonly retryAfterMs?: number) {
    // Provider exception messages, causes, response bodies and headers may contain credentials.
    super(`Integration request failed: ${code}.`);
    this.name = "IntegrationError";
  }
}

export type IntegrationAction = {
  toolkit: Toolkit; slug: string; version: string; schemaHash: string;
  effect: "READ"; description: string; inputSchema: Record<string, unknown>;
};
export type IntegrationResult = {
  state: "SUCCEEDED" | "REJECTED" | "UNKNOWN";
  trust: "UNTRUSTED_EXTERNAL_DATA";
  data?: unknown;
  evidence: { provider: "composio"; adapterVersion: string; scopeDigest: string; connectionId: string; authorityVersion: number; tool: string; version: string; schemaHash: string; argumentDigest: string; resultDigest?: string; errorCode?: string; durationMs: number };
};

/** Internal provider port. Only canonical Relay admission may call execution or lifecycle methods. */
export interface IntegrationProviderAdapter {
  readonly provider: string;
  readonly version: string;
  discoverIntegrations(): Promise<Array<{ slug: Toolkit; name: string; authSchemes: string[] }>>;
  listActions(toolkit: Toolkit, query: string, limit?: number): Promise<IntegrationAction[]>;
  getAction(slug: string): Promise<IntegrationAction>;
  connectionStatus(scope: IntegrationScope, binding: IntegrationBinding): Promise<{ connectedAccountId: string; status: string; disabled: boolean }>;
  initiateConnection(scope: IntegrationScope, toolkit: Toolkit, authConfigId: string, callbackUrl: string): Promise<{ requestId: string; redirectUrl: string }>;
  executeRead(scope: IntegrationScope, binding: IntegrationBinding, slug: string, args: Record<string, unknown>): Promise<IntegrationResult>;
  revoke(scope: IntegrationScope, binding: IntegrationBinding): Promise<{ providerRevocation: "CONFIRMED" | "PENDING" }>;
}
