import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, withTransaction } from "@/lib/db";
import { agentPassports, agents, capabilityGrants, passportImports } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { canonicalHash } from "@/lib/v2/contracts";
import { agentPassportSchema, signedAgentPassportSchema, type AgentPassport, type SignedAgentPassport } from "@/lib/v2/contracts/schemas";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import { verifyAuditSignature, type AuditSigner } from "@/lib/v2/evidence/crypto";
import { requireMembership } from "@/lib/v2/identity";

const TRUST_RANK = { UNVERIFIED: 0, REGISTERED: 1, VERIFIED: 2, HIGH_ASSURANCE: 3 } as const;
type TrustTier = keyof typeof TRUST_RANK;

export type PassportPolicy = Pick<AgentPassport, "trustTier" | "capabilityEligibility" | "policyReferences" | "budgetReferences" | "allowedEnvironments" | "dataAccess" | "expiresAt">;

export interface PassportIssuerRegistry {
  publicKeyForIssuer(issuer: string, signingKeyId: string): Promise<string | undefined>;
}

function relayIssuer() {
  const issuer = process.env.RELAY_ISSUER_URL;
  if (issuer) return new URL(issuer).toString().replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") throw new Error("RELAY_ISSUER_URL is required in production.");
  return "https://relay.local";
}

export async function createV2Agent(input: { accountId: string; ownerPrincipalId: string; name: string; description?: string }, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.ownerPrincipalId, allowedRoles: ["OWNER", "ADMIN"] });
  const agentId = id("agt");
  const timestamp = now();
  await withTransaction(async (transaction) => {
    await transaction.insert(agents).values({ id: agentId, accountId: input.accountId, name: input.name.trim(), description: input.description?.trim() ?? "", status: "DRAFT", createdAt: timestamp, updatedAt: timestamp });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.ownerPrincipalId, agentId, eventType: "agent.created", outcome: "SUCCESS", occurredAt: timestamp }, signer);
  });
  return { agentId, status: "DRAFT" as const };
}

export async function issueAgentPassport(input: { accountId: string; agentId: string; ownerPrincipalId: string; policy: PassportPolicy }, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.ownerPrincipalId, allowedRoles: ["OWNER", "ADMIN"] });
  return await withTransaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.accountId}:${input.agentId}`}, 0))`);
    const [agent] = await transaction.select({ id: agents.id }).from(agents).where(and(eq(agents.accountId, input.accountId), eq(agents.id, input.agentId))).limit(1);
    if (!agent) throw new RelayError("INVALID_INPUT", "Agent not found.", undefined, 404);
    const [previous] = await transaction.select().from(agentPassports).where(and(eq(agentPassports.accountId, input.accountId), eq(agentPassports.agentId, input.agentId), eq(agentPassports.status, "ACTIVE"))).orderBy(desc(agentPassports.version)).limit(1);
    const passportId = id("psp");
    const version = (previous?.version ?? 0) + 1;
    const revocationEpoch = previous?.revocationEpoch ?? 0;
    const passport = agentPassportSchema.parse({ schemaVersion: "relay.agent-passport.v1", issuer: relayIssuer(), passportId, agentId: input.agentId, owner: { accountId: input.accountId, principalId: input.ownerPrincipalId }, version, ...input.policy, validFrom: now(), revocationEpoch });
    const payloadHash = canonicalHash(passport);
    const signature = await signer.sign(payloadHash);
    if (previous) await transaction.update(agentPassports).set({ status: "SUPERSEDED", revokedAt: now() }).where(and(eq(agentPassports.accountId, input.accountId), eq(agentPassports.id, previous.id)));
    await transaction.insert(agentPassports).values({ id: passportId, accountId: input.accountId, agentId: input.agentId, version, trustTier: passport.trustTier, revocationEpoch, payload: passport, payloadHash, signature, signingKeyId: signer.keyId, validFrom: passport.validFrom, expiresAt: passport.expiresAt });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.ownerPrincipalId, agentId: input.agentId, eventType: "passport.issued", outcome: "SUCCESS", details: { passportId, version, trustTier: passport.trustTier, payloadHash } }, signer);
    return { passport, payloadHash, signature, signingKeyId: signer.keyId } satisfies SignedAgentPassport;
  });
}

export async function exportAgentPassport(accountId: string, agentId: string) {
  const [row] = await db().select().from(agentPassports).where(and(eq(agentPassports.accountId, accountId), eq(agentPassports.agentId, agentId), eq(agentPassports.status, "ACTIVE"))).orderBy(desc(agentPassports.version)).limit(1);
  if (!row) throw new RelayError("INVALID_INPUT", "Active Passport not found.", undefined, 404);
  return signedAgentPassportSchema.parse({ passport: row.payload, payloadHash: row.payloadHash, signature: row.signature, signingKeyId: row.signingKeyId });
}

export function verifyAgentPassport(bundle: SignedAgentPassport, publicKeyPem: string) {
  const parsed = signedAgentPassportSchema.safeParse(bundle);
  if (!parsed.success || canonicalHash(parsed.data.passport) !== parsed.data.payloadHash) return false;
  return verifyAuditSignature(publicKeyPem, parsed.data.payloadHash, parsed.data.signature);
}

export async function importAgentPassport(input: { accountId: string; importerPrincipalId: string; name: string; bundle: SignedAgentPassport }, issuerRegistry: PassportIssuerRegistry, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.importerPrincipalId, allowedRoles: ["OWNER", "ADMIN"] });
  const bundle = signedAgentPassportSchema.parse(input.bundle);
  const issuerPublicKeyPem = await issuerRegistry.publicKeyForIssuer(bundle.passport.issuer, bundle.signingKeyId);
  if (!issuerPublicKeyPem || !verifyAgentPassport(bundle, issuerPublicKeyPem)) throw new RelayError("INVALID_CREDENTIAL", "Passport issuer or signature is invalid.", undefined, 401);
  const draftAgentId = id("agt");
  await withTransaction(async (transaction) => {
    await transaction.insert(agents).values({ id: draftAgentId, accountId: input.accountId, name: input.name.trim(), description: `Imported from ${bundle.passport.issuer}`, status: "DRAFT", createdAt: now(), updatedAt: now() });
    await transaction.insert(passportImports).values({ id: id("pim"), accountId: input.accountId, draftAgentId, sourceIssuer: bundle.passport.issuer, sourcePassportId: bundle.passport.passportId, sourcePayloadHash: bundle.payloadHash, sourceBundle: bundle, signatureVerified: true });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.importerPrincipalId, agentId: draftAgentId, eventType: "passport.imported", outcome: "SUCCESS", details: { sourceIssuer: bundle.passport.issuer, sourcePassportId: bundle.passport.passportId, authorityGranted: false } }, signer);
  });
  return { agentId: draftAgentId, status: "DRAFT" as const, authorityGranted: false };
}

export async function activateV2Agent(input: { accountId: string; agentId: string; actorPrincipalId: string }, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.actorPrincipalId, allowedRoles: ["OWNER", "ADMIN"] });
  const [passport] = await db().select({ id: agentPassports.id, expiresAt: agentPassports.expiresAt }).from(agentPassports).where(and(eq(agentPassports.accountId, input.accountId), eq(agentPassports.agentId, input.agentId), eq(agentPassports.status, "ACTIVE"), isNull(agentPassports.revokedAt))).orderBy(desc(agentPassports.version)).limit(1);
  if (!passport || Date.parse(passport.expiresAt) <= Date.now()) throw new RelayError("CAPABILITY_DENIED", "A current active Passport is required.", undefined, 403);
  await withTransaction(async (transaction) => {
    const updated = await transaction.update(agents).set({ status: "ACTIVE", updatedAt: now() }).where(and(eq(agents.accountId, input.accountId), eq(agents.id, input.agentId), eq(agents.status, "DRAFT"))).returning({ id: agents.id });
    if (!updated.length) throw new RelayError("INVALID_INPUT", "Draft Agent not found.", undefined, 404);
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.actorPrincipalId, agentId: input.agentId, eventType: "agent.activated", outcome: "SUCCESS", details: { passportId: passport.id } }, signer);
  });
}

export async function downgradeAgentTrust(input: { accountId: string; agentId: string; actorPrincipalId: string; trustTier: TrustTier }, signer: AuditSigner, revoker: { revokeIncompatibleWork(input: { accountId: string; agentId: string; maximumTrustTier: TrustTier; revocationEpoch: number }): Promise<void> }) {
  await requireMembership({ accountId: input.accountId, principalId: input.actorPrincipalId, allowedRoles: ["OWNER", "ADMIN"] });
  const result = await withTransaction(async (transaction) => {
    const [current] = await transaction.select().from(agentPassports).where(and(eq(agentPassports.accountId, input.accountId), eq(agentPassports.agentId, input.agentId), eq(agentPassports.status, "ACTIVE"))).orderBy(desc(agentPassports.version)).limit(1);
    if (!current) throw new RelayError("INVALID_INPUT", "Active Passport not found.", undefined, 404);
    if (TRUST_RANK[input.trustTier] >= TRUST_RANK[current.trustTier]) throw new RelayError("INVALID_INPUT", "New tier is not a trust downgrade.");
    const revocationEpoch = current.revocationEpoch + 1;
    await transaction.update(agentPassports).set({ trustTier: input.trustTier, revocationEpoch, status: "REVOKED", revokedAt: now() }).where(and(eq(agentPassports.accountId, input.accountId), eq(agentPassports.id, current.id)));
    await transaction.update(agents).set({ status: "DRAFT", updatedAt: now() }).where(and(eq(agents.accountId, input.accountId), eq(agents.id, input.agentId)));
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.actorPrincipalId, agentId: input.agentId, eventType: "passport.trust_downgraded", outcome: "SUCCESS", details: { from: current.trustTier, to: input.trustTier, revocationEpoch } }, signer);
    return { revocationEpoch };
  });
  await revoker.revokeIncompatibleWork({ accountId: input.accountId, agentId: input.agentId, maximumTrustTier: input.trustTier, revocationEpoch: result.revocationEpoch });
  return result;
}

export async function countAgentGrants(accountId: string, agentId: string) {
  return (await db().select({ id: capabilityGrants.id }).from(capabilityGrants).where(and(eq(capabilityGrants.accountId, accountId), eq(capabilityGrants.agentId, agentId)))).length;
}
