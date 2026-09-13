import { db } from "@/lib/db";
import { RelayError } from "@/lib/errors";
import type { AgentPrincipal, CapabilityName } from "@/lib/types";

export function listAllowedCapabilities(agentId: string): CapabilityName[] {
  return (db().prepare("SELECT capability FROM capability_grants WHERE agent_id = ? AND effect = 'ALLOW' ORDER BY capability").all(agentId) as Array<{ capability: CapabilityName }>).map((row) => row.capability);
}

export function authorize(principal: AgentPrincipal, capability: CapabilityName) {
  const grant = db().prepare("SELECT effect FROM capability_grants WHERE account_id = ? AND agent_id = ? AND capability = ?").get(principal.accountId, principal.agentId, capability) as { effect: "ALLOW" | "DENY" } | undefined;
  if (grant?.effect !== "ALLOW") {
    throw new RelayError("CAPABILITY_DENIED", `This Relay agent is not permitted to use ${capability}.`, capability, 403);
  }
}
