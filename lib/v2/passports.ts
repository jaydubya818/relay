import { createPublicKey } from "node:crypto";
import { purposeSigner } from "@/lib/v2/evidence/signing-provider";
import { lockActiveAccount } from "@/lib/account-fence";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, withTransaction, type RelayDatabase } from "@/lib/db";
import { accounts, accountMemberships, principals, agentPassports, agents, capabilityGrants, passportImports } from "@/lib/db/schema";
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

export function relayIssuer() {
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

export const passportPolicySchema = agentPassportSchema.innerType().pick({ trustTier: true, capabilityEligibility: true, policyReferences: true, budgetReferences: true, allowedEnvironments: true, dataAccess: true, expiresAt: true }).strict();

type IssuePassportInput = { accountId: string; agentId: string; ownerPrincipalId: string; policy: PassportPolicy; expectedVersion?: number };

export async function issueAgentPassport(input: IssuePassportInput, signer: AuditSigner) {
  return withTransaction(transaction => issueAgentPassportInTransaction(input, signer, transaction));
}

export async function issueAgentPassportInTransaction(input: IssuePassportInput, signer: AuditSigner, transaction: RelayDatabase, ownerOnly = false) {
  const policy = passportPolicySchema.parse(input.policy);
  await lockActiveAccount(transaction, input.accountId);
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.accountId}:${input.agentId}`}, 0))`);
  await requirePassportOwner(transaction, input.accountId, input.ownerPrincipalId, ownerOnly);
  const [agent] = await transaction.select({ id: agents.id, status: agents.status }).from(agents).where(and(eq(agents.accountId, input.accountId), eq(agents.id, input.agentId))).limit(1);
  if (!agent || !["DRAFT", "ACTIVE"].includes(agent.status)) throw new RelayError("INVALID_INPUT", "Agent not found.", undefined, 404);
  const [previous] = await transaction.select().from(agentPassports).where(and(eq(agentPassports.accountId, input.accountId), eq(agentPassports.agentId, input.agentId))).orderBy(desc(agentPassports.version)).limit(1);
  if (input.expectedVersion !== undefined && input.expectedVersion !== (previous?.version ?? 0)) throw new RelayError("INVALID_INPUT", "Passport version changed; refresh before issuance.", undefined, 409);
  const passportId = id("psp"), version = (previous?.version ?? 0) + 1, revocationEpoch = previous?.revocationEpoch ?? 0;
  const passportSigner = purposeSigner(signer, "passport");
  const passport = agentPassportSchema.parse({ ...policy, schemaVersion: "relay.agent-passport.v1", issuer: relayIssuer(), passportId, agentId: input.agentId, owner: { accountId: input.accountId, principalId: input.ownerPrincipalId }, version, validFrom: now(), revocationEpoch,
    signingKey: { id: passportSigner.keyId, version: passportSigner.keyVersion ?? passportSigner.keyId, purpose: "passport", algorithm: "Ed25519" } });
  const payloadHash = canonicalHash(passport), signature = await passportSigner.sign(payloadHash);
  await transaction.update(agentPassports).set({ status: "SUPERSEDED", revokedAt: now() }).where(and(eq(agentPassports.accountId, input.accountId), eq(agentPassports.agentId, input.agentId), eq(agentPassports.status, "ACTIVE")));
  await transaction.insert(agentPassports).values({ id: passportId, accountId: input.accountId, agentId: input.agentId, version, trustTier: passport.trustTier, revocationEpoch, payload: passport, payloadHash, signature, signingKeyId: passportSigner.keyId, validFrom: passport.validFrom, expiresAt: passport.expiresAt });
  await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.ownerPrincipalId, agentId: input.agentId, eventType: "passport.issued", outcome: "SUCCESS", details: { passportId, version, trustTier: passport.trustTier, payloadHash } }, signer);
  return { passport, payloadHash, signature, signingKeyId: passportSigner.keyId } satisfies SignedAgentPassport;
}

async function requirePassportOwner(transaction: RelayDatabase, accountId: string, principalId: string, ownerOnly = false) {
  const [membership] = await transaction.select({ role: accountMemberships.role }).from(accountMemberships).innerJoin(principals, eq(principals.id, accountMemberships.principalId))
    .where(and(eq(accountMemberships.accountId, accountId), eq(accountMemberships.principalId, principalId), eq(accountMemberships.status, "ACTIVE"), eq(principals.status, "ACTIVE"))).limit(1);
  if (!membership || !(ownerOnly ? ["OWNER"] : ["OWNER", "ADMIN"]).includes(membership.role)) throw new RelayError("CAPABILITY_DENIED", "Active owner membership required.", undefined, 403);
}

/** Current signed identity/eligibility, never a capability grant or bearer credential. */
export async function requireCurrentAgentPassport(accountId: string, agentId: string, signer: AuditSigner, transaction: RelayDatabase = db(), supplied?: unknown) {
  const unavailable = (): never => { throw new RelayError("INVALID_CREDENTIAL", "Current Agent Passport is unavailable.", undefined, 401); };
  const [identity] = await transaction.select({ status: agents.status }).from(agents).innerJoin(accounts, and(eq(accounts.id, agents.accountId), isNull(accounts.retiredAt))).where(and(eq(agents.id, agentId), eq(agents.accountId, accountId))).limit(1);
  if (!identity || !["DRAFT", "ACTIVE"].includes(identity.status)) return unavailable();
  const [row] = await transaction.select().from(agentPassports).where(and(eq(agentPassports.accountId, accountId), eq(agentPassports.agentId, agentId))).orderBy(desc(agentPassports.version)).limit(1);
  if (!row || row.status !== "ACTIVE" || row.revokedAt) return unavailable();
  const parsed = signedAgentPassportSchema.safeParse({ passport: row.payload, payloadHash: row.payloadHash, signature: row.signature, signingKeyId: row.signingKeyId });
  if (!parsed.success) return unavailable();
  const bundle = parsed.data, p = bundle.passport, timestamp = Date.now();
  if (p.issuer !== relayIssuer() || p.owner.accountId !== accountId || p.agentId !== agentId || p.passportId !== row.id || p.version !== row.version || p.revocationEpoch !== row.revocationEpoch || p.trustTier !== row.trustTier || Date.parse(p.validFrom) > timestamp || Date.parse(p.expiresAt) <= timestamp || Date.parse(p.validFrom) !== Date.parse(row.validFrom) || Date.parse(p.expiresAt) !== Date.parse(row.expiresAt)) return unavailable();
  const scoped = purposeSigner(signer, "passport");
  const keys = scoped.verificationKeys?.() ?? [{ keyId: scoped.keyId, keyVersion: scoped.keyVersion ?? scoped.keyId, algorithm: "Ed25519" as const, publicKeyPem: await scoped.publicKeyPem() }];
  const key = keys.find(key => key.keyId === bundle.signingKeyId);
  if (key && ((key.activatedAt && Date.parse(p.validFrom) < Date.parse(key.activatedAt)) || (key.retiredAt && Date.parse(p.validFrom) >= Date.parse(key.retiredAt)))) return unavailable();
  if (!key || !verifyAgentPassport(bundle, key.publicKeyPem)) return unavailable();
  if (p.signingKey) {
    if (p.signingKey.id !== key.keyId || p.signingKey.version !== (key.keyVersion ?? key.keyId)) return unavailable();
  } else {
    // Historical v1 signatures predate signed key metadata. Accept only an
    // unambiguous immutable registry key; never relabel a shared public key.
    const fingerprint = (pem: string) => createPublicKey(pem).export({ type: "spki", format: "der" }).toString("hex");
    if (keys.filter(candidate => fingerprint(candidate.publicKeyPem) === fingerprint(key.publicKeyPem)).length !== 1) return unavailable();
  }
  try { await requirePassportOwner(transaction, accountId, p.owner.principalId); } catch { return unavailable(); }
  if (supplied !== undefined) {
    const claimed = signedAgentPassportSchema.safeParse(supplied);
    if (!claimed.success || canonicalHash(claimed.data) !== canonicalHash(bundle)) return unavailable();
  }
  return bundle;
}

export async function revokeAgentPassport(input: { accountId: string; agentId: string; ownerPrincipalId: string; passportId: string }, signer: AuditSigner, ownerOnly = false) {
  return withTransaction(async transaction => {
    await lockActiveAccount(transaction, input.accountId);
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.accountId}:${input.agentId}`}, 0))`);
    await requirePassportOwner(transaction, input.accountId, input.ownerPrincipalId, ownerOnly);
    const [current] = await transaction.select().from(agentPassports).where(and(eq(agentPassports.accountId, input.accountId), eq(agentPassports.agentId, input.agentId))).orderBy(desc(agentPassports.version)).limit(1);
    if (!current || current.id !== input.passportId) throw new RelayError("INVALID_INPUT", "Current Passport not found.", undefined, 404);
    if (current.status === "REVOKED") return { revoked: true, version: current.version };
    if (current.status !== "ACTIVE") throw new RelayError("INVALID_INPUT", "Passport is not active.", undefined, 409);
    await transaction.update(agentPassports).set({ status: "REVOKED", revokedAt: now(), revocationEpoch: current.revocationEpoch + 1 }).where(eq(agentPassports.id, current.id));
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.ownerPrincipalId, agentId: input.agentId, eventType: "passport.revoked", outcome: "SUCCESS", details: { passportId: current.id, version: current.version, revocationEpoch: current.revocationEpoch + 1 } }, signer);
    return { revoked: true, version: current.version };
  });
}

export async function exportAgentPassport(accountId: string, agentId: string) {
  const [row] = await db().select().from(agentPassports).where(and(eq(agentPassports.accountId, accountId), eq(agentPassports.agentId, agentId), eq(agentPassports.status, "ACTIVE"))).orderBy(desc(agentPassports.version)).limit(1);
  if (!row) throw new RelayError("INVALID_INPUT", "Active Passport not found.", undefined, 404);
  return signedAgentPassportSchema.parse({ passport: row.payload, payloadHash: row.payloadHash, signature: row.signature, signingKeyId: row.signingKeyId });
}

export function verifyAgentPassport(bundle: SignedAgentPassport, publicKeyPem: string) {
  const parsed = signedAgentPassportSchema.safeParse(bundle);
  if (!parsed.success || (parsed.data.passport.signingKey && parsed.data.passport.signingKey.id !== parsed.data.signingKeyId) || canonicalHash(parsed.data.passport) !== parsed.data.payloadHash) return false;
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
  await withTransaction(async transaction => {
    await lockActiveAccount(transaction, input.accountId);
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.accountId}:${input.agentId}`}, 0))`);
    await requirePassportOwner(transaction, input.accountId, input.actorPrincipalId);
    let passport: SignedAgentPassport;
    try { passport = await requireCurrentAgentPassport(input.accountId, input.agentId, signer, transaction); }
    catch { throw new RelayError("CAPABILITY_DENIED", "A current active Passport is required.", undefined, 403); }
    const updated = await transaction.update(agents).set({ status: "ACTIVE", updatedAt: now() }).where(and(eq(agents.accountId, input.accountId), eq(agents.id, input.agentId), eq(agents.status, "DRAFT"))).returning({ id: agents.id });
    if (!updated.length) throw new RelayError("INVALID_INPUT", "Draft Agent not found.", undefined, 404);
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.actorPrincipalId, agentId: input.agentId, eventType: "agent.activated", outcome: "SUCCESS", details: { passportId: passport.passport.passportId } }, signer);
  });
}

export async function downgradeAgentTrust(input: { accountId: string; agentId: string; actorPrincipalId: string; trustTier: TrustTier }, signer: AuditSigner, revoker: { revokeIncompatibleWork(input: { accountId: string; agentId: string; maximumTrustTier: TrustTier; revocationEpoch: number }): Promise<void> }) {
  await requireMembership({ accountId: input.accountId, principalId: input.actorPrincipalId, allowedRoles: ["OWNER", "ADMIN"] });
  const result = await withTransaction(async (transaction) => {
    await lockActiveAccount(transaction, input.accountId);
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.accountId}:${input.agentId}`}, 0))`);
    await requirePassportOwner(transaction, input.accountId, input.actorPrincipalId);
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
