import { lockActiveAccount } from "@/lib/account-fence";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, withTransaction } from "@/lib/db";
import { agents, agentPassports, capabilityDefinitions, federationAgents } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { issueAgentPassportInTransaction, revokeAgentPassport } from "@/lib/v2/passports";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { requireMembership } from "@/lib/v2/identity";
import { registrationSchema } from "./contracts";

const commandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("issue"), expectedVersion: z.number().int().nonnegative(), expiresAt: z.string().datetime({ offset: true }) }).strict(),
  z.object({ operation: z.literal("revoke"), passportId: z.string().min(1).max(255) }).strict(),
]);
type Owner = { accountId: string; principalId: string };

export async function readMessageEnrollment(owner: Owner, agentId: string) {
  await requireMembership({ ...owner, allowedRoles: ["OWNER"] });
  const [agent] = await db().select({ id: agents.id }).from(agents).where(and(eq(agents.accountId, owner.accountId), eq(agents.id, agentId))).limit(1);
  if (!agent) throw new RelayError("INVALID_INPUT", "Agent not found.", undefined, 404);
  const [row] = await db().select().from(agentPassports).where(and(eq(agentPassports.accountId, owner.accountId), eq(agentPassports.agentId, agentId))).orderBy(desc(agentPassports.version)).limit(1);
  return row ? { version: row.version, status: row.status, bundle: { passport: row.payload, payloadHash: row.payloadHash, signature: row.signature, signingKeyId: row.signingKeyId } } : { version: 0, status: "NOT_ENROLLED", bundle: null };
}

/** Explicit owner enrollment for messages only. Never creates a grant or policy allow. */
export async function manageMessageEnrollment(owner: Owner, agentId: string, value: unknown, signer: AuditSigner) {
  await requireMembership({ ...owner, allowedRoles: ["OWNER"] });
  const command = commandSchema.parse(value);
  if (command.operation === "revoke") return revokeAgentPassport({ ...owner, ownerPrincipalId: owner.principalId, agentId, passportId: command.passportId }, signer, true);
  return withTransaction(async transaction => {
    await lockActiveAccount(transaction, owner.accountId);
    const lifetime = Date.parse(command.expiresAt) - Date.now();
    if (lifetime < 1000 || lifetime > 24 * 60 * 60 * 1000) throw new RelayError("INVALID_INPUT", "Choose an expiry within 24 hours.");
    const [registered] = await transaction.select({ registration: federationAgents.registration }).from(federationAgents).innerJoin(agents, and(eq(agents.id, federationAgents.agentId), eq(agents.accountId, federationAgents.ownerId)))
      .where(and(eq(federationAgents.ownerId, owner.accountId), eq(federationAgents.agentId, agentId), eq(agents.status, "ACTIVE"))).limit(1);
    if (!registered) throw new RelayError("INVALID_INPUT", "Owned registered Agent not found.", undefined, 404);
    const declared = registrationSchema.parse(registered.registration).capabilities.map(c => c.name);
    const capabilityEligibility = ["message.send", "message.receive"].filter(name => declared.includes(name as "message.send" | "message.receive")).map(name => ({ name, version: "1.0" }));
    if (!capabilityEligibility.length) throw new RelayError("CAPABILITY_DENIED", "Declare a message capability before enrollment.", undefined, 403);
    // Federation evaluates message.send as message.receive at the recipient.
    // Outbound permission remains an explicit peer/resource grant.
    const policyCapabilities = [...new Set(capabilityEligibility.map(capability => capability.name === "message.send" ? "message.receive" : capability.name))];
    for (const capability of policyCapabilities) {
      const [definition] = await transaction.select({ id: capabilityDefinitions.id }).from(capabilityDefinitions).where(and(eq(capabilityDefinitions.name, capability), eq(capabilityDefinitions.version, "1.0"), eq(capabilityDefinitions.enabled, true))).limit(1);
      if (!definition) throw new RelayError("CAPABILITY_DENIED", "Message capability is unavailable.", undefined, 403);
    }
    return issueAgentPassportInTransaction({ ...owner, ownerPrincipalId: owner.principalId, agentId, expectedVersion: command.expectedVersion, policy: {
      trustTier: "REGISTERED", capabilityEligibility, policyReferences: [], budgetReferences: [], allowedEnvironments: { providerIds: [], minimumAssurance: "registered" }, dataAccess: [], expiresAt: command.expiresAt,
    } }, signer, transaction, true);
  });
}
