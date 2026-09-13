import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { capabilityGrants } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import type { AgentPrincipal, CapabilityName } from "@/lib/types";

export async function listAllowedCapabilities(accountId: string, agentId: string): Promise<CapabilityName[]> {
  const rows = await db().select({ capability: capabilityGrants.capability }).from(capabilityGrants).where(and(eq(capabilityGrants.accountId, accountId), eq(capabilityGrants.agentId, agentId), eq(capabilityGrants.effect, "ALLOW"))).orderBy(asc(capabilityGrants.capability));
  return rows.map((row) => row.capability as CapabilityName);
}

export async function authorize(principal: AgentPrincipal, capability: CapabilityName) {
  const [grant] = await db().select({ effect: capabilityGrants.effect }).from(capabilityGrants).where(and(eq(capabilityGrants.accountId, principal.accountId), eq(capabilityGrants.agentId, principal.agentId), eq(capabilityGrants.capability, capability))).limit(1);
  if (grant?.effect !== "ALLOW") {
    throw new RelayError("CAPABILITY_DENIED", `This Relay agent is not permitted to use ${capability}.`, capability, 403);
  }
}
