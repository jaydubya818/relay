import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTransaction, type RelayDatabase } from "@/lib/db";
import { agents, federationAgents, federationGrants, federationRelationships, publicationVersions, publishedViews } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { requireMembership } from "@/lib/v2/identity";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { availabilitySchema, grantSchema, publicationStatusSchema, registrationSchema, viewSchema, type PublishedView } from "./contracts";

export type OwnerActor = { accountId: string; principalId: string };
export function denied(): never { throw new RelayError("CAPABILITY_DENIED", "Federation resource or authority is unavailable.", undefined, 403); }
export async function lockOwners(transaction: RelayDatabase, owners: string[]) {
  for (const owner of [...new Set(owners)].sort()) await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`federation:${owner}`}, 0))`);
}
export async function requireOwner(actor: OwnerActor) { return requireMembership({ ...actor, allowedRoles: ["OWNER"] }); }
export async function ownedAgent(transaction: RelayDatabase, accountId: string, agentId: string) {
  const [agent] = await transaction.select().from(agents).where(and(eq(agents.accountId, accountId), eq(agents.id, agentId), eq(agents.status, "ACTIVE"))).limit(1);
  if (!agent) denied();
  return agent;
}
export async function registerFederationAgent(actor: OwnerActor, value: unknown, signer: AuditSigner) {
  await requireOwner(actor);
  const registration = registrationSchema.parse(value);
  return withTransaction(async (transaction) => {
    await lockOwners(transaction, [actor.accountId]);
    await ownedAgent(transaction, actor.accountId, registration.agentId);
    const [existing] = await transaction.select().from(federationAgents).where(eq(federationAgents.agentId, registration.agentId));
    if (existing?.availability === "REVOKED") denied();
    if (existing && registrationSchema.parse(existing.registration).platform !== registration.platform) throw new RelayError("INVALID_INPUT", "Platform replacement requires a new Agent identity; revoke the old Agent explicitly.");
    const address = `relay://${actor.accountId}/${registration.agentId}`;
    if (registration.primary) await transaction.update(federationAgents).set({ primary: false }).where(eq(federationAgents.ownerId, actor.accountId));
    await transaction.insert(federationAgents).values({ agentId: registration.agentId, ownerId: actor.accountId, address, registration, primary: registration.primary }).onConflictDoUpdate({ target: federationAgents.agentId, set: { registration, primary: registration.primary, updatedAt: now() } });
    await appendAuditRecordInTransaction(transaction, { accountId: actor.accountId, actorPrincipalId: actor.principalId, agentId: registration.agentId, eventType: "federation.agent.registered", outcome: "SUCCESS", details: { address } }, signer);
    return { agentId: registration.agentId, ownerId: actor.accountId, address };
  });
}
export async function setAvailability(actor: OwnerActor, agentId: string, value: unknown, signer: AuditSigner) {
  await requireOwner(actor);
  const availability = availabilitySchema.parse(value);
  return withTransaction(async (transaction) => {
    await lockOwners(transaction, [actor.accountId]);
    const [current] = await transaction.select().from(federationAgents).where(and(eq(federationAgents.ownerId, actor.accountId), eq(federationAgents.agentId, agentId)));
    if (!current || current.availability === "REVOKED") denied();
    await transaction.update(federationAgents).set({ availability, primary: availability === "REVOKED" ? false : current.primary, updatedAt: now() }).where(eq(federationAgents.agentId, agentId));
    await appendAuditRecordInTransaction(transaction, { accountId: actor.accountId, actorPrincipalId: actor.principalId, agentId, eventType: "federation.agent.availability", outcome: availability }, signer);
  });
}
export async function publishView(actor: OwnerActor, value: unknown, signer: AuditSigner) {
  await requireOwner(actor);
  const document = viewSchema.parse(value);
  if (Date.parse(document.expiresAt) <= Date.now()) throw new RelayError("INVALID_INPUT", "Publication expiry must be in the future.");
  return withTransaction(async (transaction) => {
    await lockOwners(transaction, [actor.accountId]);
    await ownedAgent(transaction, actor.accountId, document.publisherAgentId);
    const [registered] = await transaction.select().from(federationAgents).where(and(eq(federationAgents.ownerId, actor.accountId), eq(federationAgents.agentId, document.publisherAgentId)));
    if (!registered || registered.availability === "REVOKED") denied();
    const viewId = document.id ?? id("view");
    const [previous] = await transaction.select().from(publishedViews).where(eq(publishedViews.id, viewId));
    if (previous && (previous.ownerId !== actor.accountId || previous.publisherAgentId !== document.publisherAgentId || previous.status === "REVOKED")) denied();
    if ((previous?.version ?? 0) !== document.expectedVersion) throw new RelayError("INVALID_INPUT", "Publication version changed; refresh before publishing.", undefined, 409);
    const version = document.expectedVersion + 1;
    await transaction.insert(publishedViews).values({ id: viewId, ownerId: actor.accountId, publisherAgentId: document.publisherAgentId, version, document }).onConflictDoUpdate({ target: publishedViews.id, set: { document, version, updatedAt: now() } });
    await transaction.insert(publicationVersions).values({ viewId, version, ownerId: actor.accountId, document, publisherPrincipalId: actor.principalId });
    await appendAuditRecordInTransaction(transaction, { accountId: actor.accountId, actorPrincipalId: actor.principalId, eventType: "federation.publication.version", outcome: "SUCCESS", details: { viewId, version, count: document.entries.length, visibility: document.visibility } }, signer);
    return { viewId, version };
  });
}
export async function setPublicationStatus(actor: OwnerActor, viewId: string, value: unknown, signer: AuditSigner) {
  await requireOwner(actor);
  const status = publicationStatusSchema.parse(value);
  return withTransaction(async (transaction) => {
    await lockOwners(transaction, [actor.accountId]);
    const [view] = await transaction.select().from(publishedViews).where(and(eq(publishedViews.id, viewId), eq(publishedViews.ownerId, actor.accountId)));
    if (!view || view.status === "REVOKED") denied();
    await transaction.update(publishedViews).set({ status, updatedAt: now() }).where(eq(publishedViews.id, viewId));
    await appendAuditRecordInTransaction(transaction, { accountId: actor.accountId, actorPrincipalId: actor.principalId, eventType: "federation.publication.status", outcome: status, details: { viewId, version: view.version } }, signer);
  });
}
export async function invalidatePublicationReference(actor: OwnerActor, reference: string, signer: AuditSigner) {
  await requireOwner(actor);
  return withTransaction(async (transaction) => {
    await lockOwners(transaction, [actor.accountId]);
    const views = await transaction.select().from(publishedViews).where(eq(publishedViews.ownerId, actor.accountId));
    for (const view of views) {
      const document = viewSchema.parse(view.document);
      if (!document.entries.some((entry) => entry.reference === reference)) continue;
      const updated: PublishedView = { ...document, entries: document.entries.filter((entry) => entry.reference !== reference), expectedVersion: view.version };
      const version = view.version + 1;
      await transaction.update(publishedViews).set({ document: updated, version, updatedAt: now() }).where(eq(publishedViews.id, view.id));
      // Historical metadata keeps reference identities only, never the deleted content.
      await transaction.insert(publicationVersions).values({ viewId: view.id, version, ownerId: actor.accountId, document: updated, publisherPrincipalId: actor.principalId });
    }
    await appendAuditRecordInTransaction(transaction, { accountId: actor.accountId, actorPrincipalId: actor.principalId, eventType: "federation.reference.invalidated", outcome: "SUCCESS", details: { reference } }, signer);
  });
}
export async function createFederationGrant(actor: OwnerActor, value: unknown, signer: AuditSigner) {
  await requireOwner(actor);
  const document = grantSchema.parse(value);
  if (document.granteeOwnerId === actor.accountId || Date.parse(document.conditions.expiresAt) <= Date.now()) throw new RelayError("INVALID_INPUT", "A cross-owner grant with future expiry is required.");
  return withTransaction(async (transaction) => {
    await lockOwners(transaction, [actor.accountId, document.granteeOwnerId]);
    if (document.grantorAgentId) await ownedAgent(transaction, actor.accountId, document.grantorAgentId);
    if (document.granteeAgentId) await ownedAgent(transaction, document.granteeOwnerId, document.granteeAgentId);
    const grantId = id("fgr");
    await transaction.insert(federationGrants).values({ id: grantId, ownerId: actor.accountId, granteeOwnerId: document.granteeOwnerId, capability: document.capability, resource: document.resource, document });
    await appendAuditRecordInTransaction(transaction, { accountId: actor.accountId, actorPrincipalId: actor.principalId, eventType: "federation.grant.created", outcome: "SUCCESS", details: { grantId, granteeOwnerId: document.granteeOwnerId, granteeAgentId: document.granteeAgentId ?? null, capability: document.capability, resource: document.resource } }, signer);
    return { grantId };
  });
}
export async function revokeFederationGrant(actor: OwnerActor, grantId: string, signer: AuditSigner) {
  await requireOwner(actor);
  return withTransaction(async (transaction) => {
    await lockOwners(transaction, [actor.accountId]);
    const rows = await transaction.update(federationGrants).set({ status: "REVOKED", updatedAt: now() }).where(and(eq(federationGrants.id, grantId), eq(federationGrants.ownerId, actor.accountId))).returning({ id: federationGrants.id });
    if (!rows.length) denied();
    await appendAuditRecordInTransaction(transaction, { accountId: actor.accountId, actorPrincipalId: actor.principalId, eventType: "federation.grant.revoked", outcome: "SUCCESS", details: { grantId } }, signer);
  });
}
export async function setRelationship(actor: OwnerActor, subject: string, value: unknown, signer: AuditSigner) {
  await requireOwner(actor);
  const trust = z.enum(["UNKNOWN", "CONTACT", "TRUSTED", "BLOCKED"]).parse(value);
  z.string().regex(/^(acct|agt)_[a-zA-Z0-9]{8,}$/).parse(subject);
  return withTransaction(async (transaction) => {
    await lockOwners(transaction, [actor.accountId]);
    await transaction.insert(federationRelationships).values({ ownerId: actor.accountId, subject, trust }).onConflictDoUpdate({ target: [federationRelationships.ownerId, federationRelationships.subject], set: { trust, updatedAt: now() } });
    await appendAuditRecordInTransaction(transaction, { accountId: actor.accountId, actorPrincipalId: actor.principalId, eventType: "federation.relationship.changed", outcome: trust, details: { subject } }, signer);
  });
}
export async function assertNotBlocked(transaction: RelayDatabase, caller: { ownerId: string; agentId: string }, target: { ownerId: string; agentId: string }) {
  for (const [owner, other] of [[caller, target], [target, caller]]) {
    const rows = await transaction.select().from(federationRelationships).where(and(eq(federationRelationships.ownerId, owner.ownerId), inArray(federationRelationships.subject, [other.ownerId, other.agentId]), eq(federationRelationships.trust, "BLOCKED")));
    if (rows.length) denied();
  }
}
