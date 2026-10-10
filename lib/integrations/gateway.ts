import { z } from "zod";
import { authenticateAgent } from "@/lib/auth";
import { listAllowedCapabilities } from "@/lib/authorization";
import { canonicalHash } from "@/lib/v2/contracts";
import { assertBinding, IntegrationError, integrationScopeSchema, type IntegrationProviderAdapter, type IntegrationScope } from "./contracts";
import { parseConsumerReadRequest } from "./consumer";
import { IntegrationConnectionStore, readIntegrationConnection } from "./persistence";

/** Restriction projection from a trusted server integration, NEVER an admission receipt.
 * The default source returns null until the Control Plane authenticates this contract.
 * Tests may supply synthetic projections; there is no HTTP input for this object. */
export const discoveryProjectionSchema = z.object({
  scope: integrationScopeSchema, connectionId: z.string(), authorityVersion: z.number().int().positive(),
  ownerPolicyRevision: z.number().int().positive(), relayPolicyRevision: z.string().min(1),
  validUntil: z.string().datetime(), ownerEnabled: z.boolean(), organizationEnabled: z.boolean(),
  harnessIds: z.array(z.string()).max(20),
  tools: z.array(z.object({ slug: z.string(), version: z.string(), schemaHash: z.string(),
    capability: z.string(), requiredScopes: z.array(z.string()).max(100), effect: z.literal("READ") }).strict()).max(10),
}).strict();
export type DiscoveryProjection = z.infer<typeof discoveryProjectionSchema>;
export interface IntegrationPolicySource {
  restrictions(scope: IntegrationScope, connectionId: string): Promise<DiscoveryProjection | null>;
}
export const unavailableIntegrationPolicy: IntegrationPolicySource = { async restrictions() { return null; } };

export class IntegrationGateway {
  constructor(private readonly adapter: IntegrationProviderAdapter, private readonly store: IntegrationConnectionStore,
    private readonly policy: IntegrationPolicySource = unavailableIntegrationPolicy) {}

  private async authenticate(secret: string, scope: IntegrationScope) {
    const authenticated = await authenticateAgent(secret);
    if (!authenticated.ok) throw new IntegrationError(authenticated.code);
    if (authenticated.principal.accountId !== scope.accountId || authenticated.principal.agentId !== scope.agentId) throw new IntegrationError("AUTHENTICATED_SCOPE_MISMATCH");
    return authenticated.principal;
  }

  private async projection(scope: IntegrationScope, connectionId: string, harnessId: string) {
    const value = await this.policy.restrictions(scope, connectionId);
    if (!value) throw new IntegrationError("POLICY_UNAVAILABLE");
    const projection = discoveryProjectionSchema.parse(value);
    if (canonicalHash(projection.scope) !== canonicalHash(scope) || projection.connectionId !== connectionId) throw new IntegrationError("POLICY_SCOPE_MISMATCH");
    if (Date.parse(projection.validUntil) <= Date.now()) throw new IntegrationError("POLICY_STALE");
    if (!projection.ownerEnabled || !projection.organizationEnabled || !projection.harnessIds.includes(harnessId)) throw new IntegrationError("POLICY_DENIED");
    return projection;
  }

  async discover(secret: string, input: { scope: IntegrationScope; connectionId: string; harnessId: string; query: string; limit?: number }) {
    const { scope, connectionId, harnessId } = input;
    z.string().max(200).parse(input.query);
    const limit = z.number().int().min(1).max(10).parse(input.limit ?? 5);
    await this.authenticate(secret, scope);
    const binding = assertBinding(scope, await readIntegrationConnection(scope, connectionId));
    const projection = await this.projection(scope, connectionId, harnessId);
    if (projection.authorityVersion !== binding.authorityVersion) throw new IntegrationError("POLICY_STALE");
    const grants = await listAllowedCapabilities(scope.accountId, scope.agentId);
    // Fetch only explicitly qualified/allowed schemas; never expand the whole toolkit.
    const eligible = projection.tools.filter(tool => grants.some(grant => grant === tool.capability)
      && tool.requiredScopes.every(value => binding.scopes.includes(value))
      && tool.slug.toLowerCase().includes(input.query.trim().toLowerCase())).slice(0, limit);
    const actions = [];
    for (const qualified of eligible) {
      const action = await this.adapter.getAction(qualified.slug);
      if (action.toolkit !== binding.toolkit || action.version !== qualified.version || action.schemaHash !== qualified.schemaHash || action.effect !== "READ") throw new IntegrationError("TOOL_QUALIFICATION_MISMATCH");
      actions.push(action);
    }
    // Discovery is advisory, but don't return data known to have gone stale while fetching.
    await this.authenticate(secret, scope);
    const current = assertBinding(scope, await readIntegrationConnection(scope, connectionId));
    const currentGrants = await listAllowedCapabilities(scope.accountId, scope.agentId);
    if (current.authorityVersion !== binding.authorityVersion || canonicalHash(projection) !== canonicalHash(await this.projection(scope, connectionId, harnessId))
      || eligible.some(tool => !currentGrants.some(grant => grant === tool.capability))) throw new IntegrationError("POLICY_STALE");
    return { actions, executionAvailable: false as const, admission: "CROSS_DATABASE_ORDERING_UNQUALIFIED" as const };
  }

  async requestRead(secret: string, value: unknown) {
    const request = parseConsumerReadRequest(value);
    await this.authenticate(secret, request.scope);
    let code = "CROSS_DATABASE_ORDERING_UNQUALIFIED";
    try {
      const binding = assertBinding(request.scope, await readIntegrationConnection(request.scope, request.connectionId));
      const policy = await this.projection(request.scope, request.connectionId, request.harnessId);
      if (binding.authorityVersion !== request.authorityVersion || policy.authorityVersion !== request.authorityVersion
        || policy.ownerPolicyRevision !== request.ownerPolicyRevision || policy.relayPolicyRevision !== request.relayPolicyRevision) throw new IntegrationError("POLICY_STALE");
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
      code = error.code;
    }
    const receipt = await this.store.recordDenial(request.scope, request.connectionId, request.action.idempotencyKey,
      canonicalHash(request), code);
    // There is intentionally no adapter.executeRead call or injectable allow callback.
    return { schemaVersion: "relay.integration-denial.v1", state: "NOT_DISPATCHED", code: receipt.code,
      actionHash: request.action.canonicalHash, trust: "RELAY_DENIAL_EVIDENCE", retryable: false } as const;
  }
}
