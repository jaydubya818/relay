import { capabilitySchema } from "./contracts";
import { registerCapabilityDefinition } from "@/lib/v2/policy";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";

// Explicit provisioning; registration does not activate account policy or grant authority.
export async function provisionFederationCapabilities(signer: AuditSigner) {
  for (const name of capabilitySchema.options) await registerCapabilityDefinition({
    name, version: "1.0", domain: "federation", description: `Cross-owner ${name}; receiving platform must authorize independently.`,
    effectClass: name === "knowledge.query" ? "read" : "communication", riskClass: "high", resourceType: "federation_resource",
    inputSchema: { type: "object", description: "relay.federation 1.0 envelope" }, outputSchema: { type: "object" },
  }, signer);
}
