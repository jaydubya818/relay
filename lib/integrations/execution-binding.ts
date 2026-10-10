import { capabilityLeaseClaimsSchema, canonicalHash, type CapabilityLeaseClaims } from "@/lib/v2/contracts";
import { parseConsumerReadRequest, type ConsumerReadRequest } from "./consumer";
import { assertBinding, IntegrationError, type IntegrationBinding, type IntegrationScope } from "./contracts";

/** Canonical records supplied by a future authenticated receiving transaction.
 * This is an integrity check, NOT a lease verifier, policy decision or admission grant.
 * The gateway remains unconditionally closed; only synthetic transport tests call it. */
export type ExecutionBindingContext = { request: ConsumerReadRequest; lease: CapabilityLeaseClaims };

export function bindExecution(scope: IntegrationScope, connection: IntegrationBinding, slug: string,
  args: Record<string, unknown>, context: ExecutionBindingContext) {
  const binding = assertBinding(scope, connection);
  const request = parseConsumerReadRequest(context.request);
  const lease = capabilityLeaseClaimsSchema.parse(context.lease);
  const action = request.action;
  const now = Math.floor(Date.now() / 1000);
  if (canonicalHash(request.scope) !== canonicalHash(scope) || request.connectionId !== binding.connectionId
    || request.toolkit !== binding.toolkit || request.authorityVersion !== binding.authorityVersion || request.tool !== slug
    || canonicalHash(action.parameters) !== canonicalHash(args) || lease.accountId !== scope.accountId || lease.sub !== scope.agentId
    || lease.runtimeClientId !== action.runtimeClientId || lease.taskId !== action.taskId || lease.workloadId !== action.workloadId
    || lease.actionHash !== action.canonicalHash || canonicalHash(lease.resource) !== canonicalHash(action.resource)
    || canonicalHash(lease.capability) !== canonicalHash(action.capability) || lease.policyRevision !== request.relayPolicyRevision
    || lease.effectClass !== "read" || !lease.onlineRequired || lease.nbf > now || lease.exp <= now
    || Date.parse(request.expiresAt) > lease.exp * 1000) throw new IntegrationError("EXECUTION_BINDING_MISMATCH");
  // Binds every canonical authorization/approval/lease field, including delegation.
  // Provider identities stay server-side; evidence exposes only their digest.
  return { request, lease, digest: canonicalHash({ provider: "composio", binding, request, lease }) };
}
