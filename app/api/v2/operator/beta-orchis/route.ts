import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, withTransaction } from "@/lib/db";
import { accountMemberships, federationGrants, principals, users } from "@/lib/db/schema";
import { id } from "@/lib/ids";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import { withQualificationSigningAuthority } from "@/lib/v2/evidence/qualification-admission";
import { federationBindings } from "@/lib/v2/federation/api";
import { grantSchema } from "@/lib/v2/federation/contracts";
import { lockOwners, ownedAgent, requireOwner } from "@/lib/v2/federation/registry";

// Temporary, exact-scope beta recovery. Remove this route and its secret after pairing.
const accountId = "acct_13752e44f3dd4bd689dabc188b9a9c33";
const agentId = "agt_6a5b98071bbb45508a233e22c80f7edd";
const peerAccountId = "acct_0f41b9a5e8a84d68b1a66c26fabd266e";
const peerAgentId = "agt_3d5bf7115d4c4e86a4afc00794c1543b";
const resource = `relay://${accountId}/${agentId}`;
const recoveryDeadline = Date.parse("2026-09-27T01:30:00Z");

export async function POST(request: Request) {
  const configuredToken = process.env.RELAY_BETA_ORCHIS_PAIRING_TOKEN;
  const suppliedToken = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!configuredToken || !suppliedToken || Date.now() >= recoveryDeadline ||
      !timingSafeEqual(createHash("sha256").update(suppliedToken).digest(), createHash("sha256").update(configuredToken).digest())) {
    return Response.json({ code: "INVALID_CREDENTIAL" }, { status: 401 });
  }

  const owners = await db().select({ principalId: principals.id })
    .from(users)
    .innerJoin(principals, eq(principals.userId, users.id))
    .innerJoin(accountMemberships, and(eq(accountMemberships.principalId, principals.id), eq(accountMemberships.accountId, users.accountId)))
    .where(and(eq(users.accountId, accountId), eq(users.role, "OWNER"), eq(principals.status, "ACTIVE"), eq(accountMemberships.status, "ACTIVE"), eq(accountMemberships.role, "OWNER")));
  if (owners.length !== 1) return Response.json({ code: "OWNER_UNAVAILABLE" }, { status: 409 });
  const actor = { accountId, principalId: owners[0]!.principalId };
  await requireOwner(actor);

  const operationId = "beta-orchis-sofie-message-2026-09-26";
  const { signer } = federationBindings();
  const grant = grantSchema.parse({
    grantorAgentId: agentId,
    granteeOwnerId: peerAccountId,
    granteeAgentId: peerAgentId,
    capability: "message.send",
    resource,
    conditions: {
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      rateLimit: { calls: 10, windowSeconds: 3600 },
      allowedTopics: [],
      approvalRequired: false,
    },
  });
  const result = await withQualificationSigningAuthority({ rootOperation: operationId, requestId: operationId, accountId, agentId: null, operation: "grant" }, () =>
    withTransaction(async (transaction) => {
      await lockOwners(transaction, [accountId, peerAccountId]);
      await ownedAgent(transaction, accountId, agentId);
      await ownedAgent(transaction, peerAccountId, peerAgentId);
      const existing = await transaction.select().from(federationGrants).where(and(
        eq(federationGrants.ownerId, accountId),
        eq(federationGrants.granteeOwnerId, peerAccountId),
        eq(federationGrants.capability, "message.send"),
        eq(federationGrants.resource, resource),
        eq(federationGrants.status, "ACTIVE"),
      ));
      const exact = existing.find(({ document }) => {
        const saved = grantSchema.parse(document);
        return saved.grantorAgentId === agentId && saved.granteeAgentId === peerAgentId &&
          saved.conditions.expiresAt && Date.parse(saved.conditions.expiresAt) > Date.now();
      });
      if (exact) return { grantId: exact.id, created: false };

      const grantId = id("fgr");
      await transaction.insert(federationGrants).values({ id: grantId, ownerId: accountId, granteeOwnerId: peerAccountId, capability: "message.send", resource, document: grant });
      await appendAuditRecordInTransaction(transaction, {
        accountId, actorPrincipalId: actor.principalId, eventType: "federation.grant.created", outcome: "SUCCESS",
        details: { grantId, granteeOwnerId: peerAccountId, granteeAgentId: peerAgentId, capability: "message.send", resource, operationId },
      }, signer);
      return { grantId, created: true };
    }),
  );
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
