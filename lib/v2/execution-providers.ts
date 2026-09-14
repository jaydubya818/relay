import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, withTransaction } from "@/lib/db";
import { agentPassports, capabilityLeases, executionAttempts, executionPlacements, executionProviderDefinitions, policyDecisions, providerCircuitStates, v2Tasks } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { agentPassportSchema, canonicalHash, capabilityLeaseClaimsSchema } from "@/lib/v2/contracts";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import { verifyAuditSignature, type AuditSigner } from "@/lib/v2/evidence/crypto";
import { redactForEvidence } from "@/lib/v2/evidence/redaction";

const featureSchema = z.enum(["browser.visual", "shell", "files", "live_observation", "pause", "takeover", "persistent", "private_network", "network_policy", "secret_broker"]);
const assuranceSchema = z.enum(["registered", "attested", "managed-equivalent"]);
const classificationSchema = z.enum(["public", "internal", "confidential", "restricted"]);
const isolationSchema = z.enum(["process", "container", "microvm", "vm", "dedicated"]);
const persistenceSchema = z.enum(["ephemeral", "persistent"]);
const decimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/);

export const executionProviderManifestSchema = z.object({
  schemaVersion: z.literal("relay.execution-provider.v1"), providerKey: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/), version: z.string().regex(/^\d+\.\d+$/),
  kind: z.enum(["relay_managed", "browser_service", "sandbox_service", "cloud_vm", "customer_runner", "private_gateway"]),
  features: z.array(featureSchema).min(1), assurance: assuranceSchema, regions: z.array(z.string().min(1).max(64)).min(1),
  isolationModes: z.array(isolationSchema).min(1), persistenceModes: z.array(persistenceSchema).min(1), maximumClassification: classificationSchema,
  evidenceTypes: z.array(z.enum(["relay_observed", "provider_signed", "runner_reported"])).min(1), meteringDimensions: z.array(z.enum(["TOKENS", "MODEL_SPEND", "CONNECTOR_CALLS", "COMPUTE_SECONDS", "COMPUTER_SECONDS", "PURCHASE_AMOUNT"])),
  supportsPrivateNetwork: z.boolean(), supportsIdempotentCreate: z.boolean(), maximumSessionSeconds: z.number().int().positive().max(604_800),
}).strict();

export const executionRequirementsSchema = z.object({
  requiredFeatures: z.array(featureSchema).min(1), minimumAssurance: assuranceSchema, allowedProviderIds: z.array(z.string().min(1)).optional(),
  allowedRegions: z.array(z.string().min(1)).min(1), isolationMode: isolationSchema, persistence: persistenceSchema,
  classification: classificationSchema, requiresPrivateNetwork: z.boolean().default(false), maximumSessionSeconds: z.number().int().positive(),
  quoteCurrency: z.string().regex(/^[A-Z]{3}$/), maximumQuotedAmount: decimalSchema.optional(),
}).strict();

export type ExecutionProviderManifest = z.infer<typeof executionProviderManifestSchema>;
export type ExecutionRequirements = z.infer<typeof executionRequirementsSchema>;
export type ProviderQuote = { amount: string; currency: string; validUntil: string };
export type ProviderHealth = { available: boolean; warmCapacity: number; latencyMs: number; reliabilityBps: number; observedAt: string };
const providerQuoteSchema = z.object({ amount: decimalSchema, currency: z.string().regex(/^[A-Z]{3}$/), validUntil: z.string().datetime({ offset: true }) }).strict();
const providerHealthSchema = z.object({ available: z.boolean(), warmCapacity: z.number().int().min(0), latencyMs: z.number().nonnegative(), reliabilityBps: z.number().int().min(0).max(10_000), observedAt: z.string().datetime({ offset: true }) }).strict();
export type ExecutionSpec = { accountId: string; taskId: string; actionIntentId: string; leaseId: string; region: string; isolationMode: z.infer<typeof isolationSchema>; persistence: z.infer<typeof persistenceSchema>; maximumSessionSeconds: number; credentialHandles: string[] };

export interface ExecutionProviderAdapter {
  readonly providerKey: string;
  readonly version: string;
  health(): Promise<ProviderHealth>;
  quote(requirements: ExecutionRequirements): Promise<ProviderQuote>;
  prepareExecution(input: ExecutionSpec & { idempotencyKey: string }): Promise<{ providerSessionId: string; receipt: Record<string, unknown> }>;
  control(input: { providerSessionId: string; command: "pause" | "resume" | "terminate" | "takeover" }): Promise<Record<string, unknown>>;
  observe(input: { providerSessionId: string }): Promise<{ liveUrl?: string; screenshot?: Uint8Array }>;
  collectEvidence(input: { providerSessionId: string }): Promise<Array<Record<string, unknown>>>;
  collectMeters(input: { providerSessionId: string }): Promise<Array<{ dimension: string; amount: string; sourceId: string }>>;
  terminate(input: { providerSessionId: string }): Promise<Record<string, unknown>>;
  reconcile(input: { idempotencyKey: string; providerSessionId?: string }): Promise<{ status: "NOT_FOUND" | "ACCEPTED" | "TERMINATED" | "UNKNOWN"; receipt?: Record<string, unknown> }>;
}
export interface ProviderManifestKeyResolver { publicKeyForKeyId(keyId: string): Promise<string | undefined>; }

export class ProviderDispatchError extends Error {
  constructor(message: string, public readonly phase: "PRE_EFFECT" | "POSSIBLY_COMMITTED", public readonly errorClass = "ProviderDispatchError") { super(message); this.name = "ProviderDispatchError"; }
}

export class ExecutionProviderRegistry {
  private readonly adapters = new Map<string, ExecutionProviderAdapter>();
  register(adapter: ExecutionProviderAdapter) { this.adapters.set(`${adapter.providerKey}@${adapter.version}`, adapter); }
  resolve(providerKey: string, version: string) { return this.adapters.get(`${providerKey}@${version}`); }
}

export function qualifyExecutionProvider(manifestInput: unknown, adapter: ExecutionProviderAdapter) {
  const manifest = executionProviderManifestSchema.parse(manifestInput);
  const failures: string[] = [];
  if (adapter.providerKey !== manifest.providerKey || adapter.version !== manifest.version) failures.push("adapter identity does not match manifest");
  for (const method of ["health", "quote", "prepareExecution", "control", "observe", "collectEvidence", "collectMeters", "terminate", "reconcile"] as const) if (typeof adapter[method] !== "function") failures.push(`missing ${method}`);
  if (manifest.features.includes("private_network") !== manifest.supportsPrivateNetwork) failures.push("private-network feature flag is inconsistent");
  if (manifest.persistenceModes.includes("persistent") && !manifest.features.includes("persistent")) failures.push("persistent mode requires persistent feature");
  return { qualified: failures.length === 0, failures, manifest };
}

export async function publishExecutionProvider(manifestInput: unknown, adapter: ExecutionProviderAdapter, signer: AuditSigner) {
  const qualification = qualifyExecutionProvider(manifestInput, adapter);
  if (!qualification.qualified) throw new RelayError("INVALID_INPUT", `Provider conformance failed: ${qualification.failures.join("; ")}`);
  const manifestHash = canonicalHash(qualification.manifest);
  const signature = await signer.sign(manifestHash);
  const providerDefinitionId = id("pvd");
  await withTransaction(async (transaction) => {
    await transaction.insert(executionProviderDefinitions).values({ id: providerDefinitionId, providerKey: qualification.manifest.providerKey, version: qualification.manifest.version, manifest: qualification.manifest, manifestHash, signature, signingKeyId: signer.keyId });
    await transaction.insert(providerCircuitStates).values({ providerDefinitionId });
  });
  return { providerDefinitionId, manifestHash, signature };
}

const ASSURANCE = { registered: 0, attested: 1, "managed-equivalent": 2 } as const;
const CLASSIFICATION = { public: 0, internal: 1, confidential: 2, restricted: 3 } as const;
const SCALE = 1_000_000_000n;
function decimalUnits(value: string) { const [whole, fraction = ""] = value.split("."); return BigInt(whole!) * SCALE + BigInt(fraction.padEnd(9, "0")); }

function hardConstraintFailures(manifest: ExecutionProviderManifest, requirements: ExecutionRequirements, allowedProviderIds: string[]) {
  const failures: string[] = [];
  if (!allowedProviderIds.includes(manifest.providerKey)) failures.push("provider_not_allowed");
  if (requirements.requiredFeatures.some((feature) => !manifest.features.includes(feature))) failures.push("missing_feature");
  if (ASSURANCE[manifest.assurance] < ASSURANCE[requirements.minimumAssurance]) failures.push("assurance_insufficient");
  if (!manifest.regions.some((region) => requirements.allowedRegions.includes(region))) failures.push("region_unavailable");
  if (!manifest.isolationModes.includes(requirements.isolationMode)) failures.push("isolation_unsupported");
  if (!manifest.persistenceModes.includes(requirements.persistence)) failures.push("persistence_unsupported");
  if (CLASSIFICATION[manifest.maximumClassification] < CLASSIFICATION[requirements.classification]) failures.push("classification_unsupported");
  if (requirements.requiresPrivateNetwork && !manifest.supportsPrivateNetwork) failures.push("private_network_unavailable");
  if (requirements.maximumSessionSeconds > manifest.maximumSessionSeconds) failures.push("duration_unsupported");
  return failures;
}

type Candidate = { definition: typeof executionProviderDefinitions.$inferSelect; manifest: ExecutionProviderManifest; adapter: ExecutionProviderAdapter; health: ProviderHealth; quote: ProviderQuote; region: string };

function compareCandidates(left: Candidate, right: Candidate) {
  if (left.health.warmCapacity !== right.health.warmCapacity) return right.health.warmCapacity - left.health.warmCapacity;
  if (left.health.reliabilityBps !== right.health.reliabilityBps) return right.health.reliabilityBps - left.health.reliabilityBps;
  if (left.health.latencyMs !== right.health.latencyMs) return left.health.latencyMs - right.health.latencyMs;
  const cost = decimalUnits(left.quote.amount) - decimalUnits(right.quote.amount);
  if (cost !== 0n) return cost < 0n ? -1 : 1;
  return left.manifest.providerKey.localeCompare(right.manifest.providerKey);
}

export async function scheduleExecution(input: { accountId: string; taskId: string; actionIntentId: string; leaseId: string; requirements: ExecutionRequirements }, registry: ExecutionProviderRegistry, signer: AuditSigner, keyResolver: ProviderManifestKeyResolver) {
  const requirements = executionRequirementsSchema.parse(input.requirements);
  const [existing] = await db().select().from(executionPlacements).where(and(eq(executionPlacements.accountId, input.accountId), eq(executionPlacements.taskId, input.taskId), eq(executionPlacements.actionIntentId, input.actionIntentId))).limit(1);
  if (existing) {
    const existingDecision = existing.decision as { requestedRequirementsHash?: string };
    if (existing.leaseId !== input.leaseId || existingDecision.requestedRequirementsHash !== canonicalHash(requirements)) throw new RelayError("INVALID_INPUT", "Execution placement idempotency key was reused with different authority or requirements.", undefined, 409);
    const [definition] = await db().select().from(executionProviderDefinitions).where(eq(executionProviderDefinitions.id, existing.providerDefinitionId)).limit(1);
    return { placementId: existing.id, selectedProviderKey: definition?.providerKey, decision: existing.decision, idempotentReplay: true };
  }
  const timestamp = now();
  const [[leaseBinding], [task]] = await Promise.all([
    db().select({ lease: capabilityLeases }).from(capabilityLeases).innerJoin(policyDecisions, and(eq(policyDecisions.id, capabilityLeases.policyDecisionId), eq(policyDecisions.accountId, capabilityLeases.accountId))).where(and(eq(capabilityLeases.accountId, input.accountId), eq(capabilityLeases.id, input.leaseId), eq(capabilityLeases.taskId, input.taskId), eq(policyDecisions.actionIntentId, input.actionIntentId), eq(capabilityLeases.status, "ACTIVE"), gt(capabilityLeases.expiresAt, timestamp), isNull(capabilityLeases.revokedAt))).limit(1),
    db().select().from(v2Tasks).where(and(eq(v2Tasks.accountId, input.accountId), eq(v2Tasks.id, input.taskId), inArray(v2Tasks.status, ["RUNNING", "PAUSED", "WAITING_APPROVAL"]))).limit(1),
  ]);
  const lease = leaseBinding?.lease;
  if (!lease || !task || lease.agentId !== task.agentId) throw new RelayError("CAPABILITY_DENIED", "Active same-account task and action-bound capability lease are required.", undefined, 403);
  const [passportRow] = await db().select().from(agentPassports).where(and(eq(agentPassports.accountId, input.accountId), eq(agentPassports.agentId, task.agentId), eq(agentPassports.status, "ACTIVE"), gt(agentPassports.expiresAt, timestamp))).orderBy(desc(agentPassports.version)).limit(1);
  if (!passportRow) throw new RelayError("CAPABILITY_DENIED", "Active same-account Agent Passport is required.", undefined, 403);
  const claims = capabilityLeaseClaimsSchema.parse(lease.claims);
  const passport = agentPassportSchema.parse(passportRow.payload);
  const minimumAssurance = [requirements.minimumAssurance, claims.environment.minimumAssurance, passport.allowedEnvironments.minimumAssurance].sort((left, right) => ASSURANCE[right] - ASSURANCE[left])[0]!;
  const requestedProviderIds = requirements.allowedProviderIds ?? passport.allowedEnvironments.providerIds;
  const allowedProviderIds = requestedProviderIds.filter((providerId) => passport.allowedEnvironments.providerIds.includes(providerId));
  const effectiveRequirements = { ...requirements, minimumAssurance, allowedProviderIds };
  const rows = await db().select({ definition: executionProviderDefinitions, circuit: providerCircuitStates }).from(executionProviderDefinitions).innerJoin(providerCircuitStates, eq(providerCircuitStates.providerDefinitionId, executionProviderDefinitions.id)).where(and(eq(executionProviderDefinitions.status, "ACTIVE"), or(eq(providerCircuitStates.status, "CLOSED"), and(eq(providerCircuitStates.status, "OPEN"), lteNullable(providerCircuitStates.openedUntil, timestamp)), eq(providerCircuitStates.status, "HALF_OPEN"))));
  const excluded: Array<{ providerDefinitionId: string; reasons: string[] }> = [];
  const candidates: Candidate[] = [];
  for (const row of rows) {
    const manifest = executionProviderManifestSchema.parse(row.definition.manifest);
    const failures = hardConstraintFailures(manifest, effectiveRequirements, allowedProviderIds);
    const manifestPublicKey = await keyResolver.publicKeyForKeyId(row.definition.signingKeyId);
    if (canonicalHash(manifest) !== row.definition.manifestHash || !manifestPublicKey || !verifyAuditSignature(manifestPublicKey, row.definition.manifestHash, row.definition.signature)) failures.push("manifest_integrity_invalid");
    const adapter = registry.resolve(manifest.providerKey, manifest.version);
    if (!adapter) failures.push("adapter_unavailable");
    if (failures.length) { excluded.push({ providerDefinitionId: row.definition.id, reasons: failures }); continue; }
    try {
      const [rawHealth, rawQuote] = await Promise.all([adapter!.health(), adapter!.quote(effectiveRequirements)]);
      const health = providerHealthSchema.parse(rawHealth);
      const quote = providerQuoteSchema.parse(rawQuote);
      if (!health.available || Date.parse(health.observedAt) < Date.now() - 60_000) failures.push("health_unavailable");
      if (quote.currency !== requirements.quoteCurrency || Date.parse(quote.validUntil) <= Date.now()) failures.push("quote_invalid");
      if (requirements.maximumQuotedAmount && decimalUnits(quote.amount) > decimalUnits(requirements.maximumQuotedAmount)) failures.push("quote_above_limit");
      if (failures.length) excluded.push({ providerDefinitionId: row.definition.id, reasons: failures });
      else candidates.push({ definition: row.definition, manifest, adapter: adapter!, health, quote, region: manifest.regions.find((region) => requirements.allowedRegions.includes(region))! });
    } catch { excluded.push({ providerDefinitionId: row.definition.id, reasons: ["quote_or_health_failed"] }); }
  }
  candidates.sort(compareCandidates);
  if (!candidates.length) throw new RelayError("PROVIDER_ERROR", "No execution provider satisfies all hard constraints.", undefined, 503);
  const selected = candidates[0]!;
  const placementId = id("plc");
  const decision = { selectedProviderDefinitionId: selected.definition.id, eligibleProviderDefinitionIds: candidates.map((candidate) => candidate.definition.id), excluded, requestedRequirementsHash: canonicalHash(requirements), evaluatedAt: timestamp, algorithm: "hard-filter-then-deterministic-score-v1" };
  await withTransaction(async (transaction) => {
    await transaction.insert(executionPlacements).values({ id: placementId, accountId: input.accountId, taskId: input.taskId, actionIntentId: input.actionIntentId, leaseId: input.leaseId, providerDefinitionId: selected.definition.id, requirements: effectiveRequirements, decision, quote: selected.quote });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, agentId: task.agentId, taskId: task.id, actionIntentId: input.actionIntentId, leaseId: lease.id, eventType: "execution.scheduled", outcome: "SUCCESS", details: { placementId, providerKey: selected.manifest.providerKey, providerDefinitionId: selected.definition.id, manifestHash: selected.definition.manifestHash, decision } }, signer);
  });
  return { placementId, selectedProviderKey: selected.manifest.providerKey, decision, idempotentReplay: false };
}

// Drizzle's nullable timestamp comparison needs an explicit non-null guard.
function lteNullable(column: typeof providerCircuitStates.openedUntil, value: string) { return and(sql`${column} IS NOT NULL`, sql`${column} <= ${value}`)!; }

async function recordProviderFailure(providerDefinitionId: string) {
  await db().update(providerCircuitStates).set({ consecutiveFailures: sql`${providerCircuitStates.consecutiveFailures} + 1`, status: sql`CASE WHEN ${providerCircuitStates.consecutiveFailures} + 1 >= 3 THEN 'OPEN'::provider_circuit_status ELSE ${providerCircuitStates.status} END`, openedUntil: sql`CASE WHEN ${providerCircuitStates.consecutiveFailures} + 1 >= 3 THEN now() + interval '60 seconds' ELSE ${providerCircuitStates.openedUntil} END`, updatedAt: now() }).where(eq(providerCircuitStates.providerDefinitionId, providerDefinitionId));
}

async function recordProviderSuccess(providerDefinitionId: string) {
  await db().update(providerCircuitStates).set({ consecutiveFailures: 0, status: "CLOSED", openedUntil: null, updatedAt: now() }).where(eq(providerCircuitStates.providerDefinitionId, providerDefinitionId));
}

export async function reportExecutionProviderOutcome(providerDefinitionId: string, outcome: "SUCCESS" | "FAILURE") {
  const [definition] = await db().select({ id: executionProviderDefinitions.id }).from(executionProviderDefinitions).where(eq(executionProviderDefinitions.id, providerDefinitionId)).limit(1);
  if (!definition) throw new RelayError("INVALID_INPUT", "Execution provider definition not found.", undefined, 404);
  if (outcome === "SUCCESS") await recordProviderSuccess(providerDefinitionId); else await recordProviderFailure(providerDefinitionId);
}

export async function startScheduledExecution(input: { accountId: string; placementId: string; credentialHandles?: string[] }, registry: ExecutionProviderRegistry, signer: AuditSigner, keyResolver: ProviderManifestKeyResolver) {
  const [placement] = await db().select().from(executionPlacements).where(and(eq(executionPlacements.accountId, input.accountId), eq(executionPlacements.id, input.placementId), eq(executionPlacements.status, "SCHEDULED"))).limit(1);
  if (!placement) throw new RelayError("INVALID_INPUT", "Scheduled execution placement not found.", undefined, 404);
  const handles = z.array(z.string().regex(/^vlt_[A-Za-z0-9_-]{8,}$/)).max(100).parse(input.credentialHandles ?? []);
  const timestamp = now();
  const [[lease], [task]] = await Promise.all([
    db().select({ id: capabilityLeases.id }).from(capabilityLeases).where(and(eq(capabilityLeases.accountId, input.accountId), eq(capabilityLeases.id, placement.leaseId), eq(capabilityLeases.taskId, placement.taskId), eq(capabilityLeases.status, "ACTIVE"), gt(capabilityLeases.expiresAt, timestamp), isNull(capabilityLeases.revokedAt))).limit(1),
    db().select({ id: v2Tasks.id }).from(v2Tasks).where(and(eq(v2Tasks.accountId, input.accountId), eq(v2Tasks.id, placement.taskId), inArray(v2Tasks.status, ["RUNNING", "PAUSED", "WAITING_APPROVAL"]))).limit(1),
  ]);
  if (!lease || !task) throw new RelayError("CAPABILITY_DENIED", "Placement authority or task is no longer active.", undefined, 403);
  const decision = placement.decision as { eligibleProviderDefinitionIds: string[] };
  const definitions = await db().select().from(executionProviderDefinitions).where(and(inArray(executionProviderDefinitions.id, decision.eligibleProviderDefinitionIds), eq(executionProviderDefinitions.status, "ACTIVE")));
  const ordered = decision.eligibleProviderDefinitionIds.map((definitionId) => definitions.find((definition) => definition.id === definitionId)).filter((definition): definition is typeof executionProviderDefinitions.$inferSelect => Boolean(definition));
  const claimed = await db().update(executionPlacements).set({ status: "DISPATCHING", updatedAt: now() }).where(and(eq(executionPlacements.accountId, input.accountId), eq(executionPlacements.id, placement.id), eq(executionPlacements.status, "SCHEDULED"))).returning({ id: executionPlacements.id });
  if (!claimed.length) throw new RelayError("CAPABILITY_DENIED", "Execution placement was concurrently dispatched.", undefined, 409);
  const preEffectFailures: string[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const definition = ordered[index]!;
    const manifest = executionProviderManifestSchema.parse(definition.manifest);
    const adapter = registry.resolve(manifest.providerKey, manifest.version);
    if (!adapter) continue;
    const publicKey = await keyResolver.publicKeyForKeyId(definition.signingKeyId);
    if (canonicalHash(manifest) !== definition.manifestHash || !publicKey || !verifyAuditSignature(publicKey, definition.manifestHash, definition.signature)) continue;
    const attempt = index + 1;
    const attemptId = id("exa");
    const idempotencyKey = `placement:${placement.id}:provider:${definition.id}`;
    await db().insert(executionAttempts).values({ id: attemptId, accountId: input.accountId, placementId: placement.id, providerDefinitionId: definition.id, attempt, idempotencyKey });
    const requirements = executionRequirementsSchema.parse(placement.requirements);
    const region = manifest.regions.find((candidate) => requirements.allowedRegions.includes(candidate))!;
    try {
      const [rawHealth, rawQuote] = await Promise.all([adapter.health(), adapter.quote(requirements)]);
      let health: ProviderHealth;
      let quote: ProviderQuote;
      try { health = providerHealthSchema.parse(rawHealth); quote = providerQuoteSchema.parse(rawQuote); } catch { throw new ProviderDispatchError("Provider returned invalid health or quote data.", "PRE_EFFECT", "ProviderContractViolation"); }
      if (!health.available || Date.parse(health.observedAt) < Date.now() - 60_000 || quote.currency !== requirements.quoteCurrency || Date.parse(quote.validUntil) <= Date.now() || (requirements.maximumQuotedAmount && decimalUnits(quote.amount) > decimalUnits(requirements.maximumQuotedAmount))) throw new ProviderDispatchError("Provider health or quote no longer satisfies placement constraints.", "PRE_EFFECT", "PlacementRevalidationFailed");
      const result = await adapter.prepareExecution({ accountId: input.accountId, taskId: placement.taskId, actionIntentId: placement.actionIntentId, leaseId: placement.leaseId, region, isolationMode: requirements.isolationMode, persistence: requirements.persistence, maximumSessionSeconds: requirements.maximumSessionSeconds, credentialHandles: handles, idempotencyKey });
      const safeReceipt = redactForEvidence(result.receipt) as Record<string, unknown>;
      await withTransaction(async (transaction) => {
        await transaction.update(executionAttempts).set({ status: "ACCEPTED", effectState: "IDEMPOTENT_SAFE", providerReceipt: safeReceipt, completedAt: now() }).where(and(eq(executionAttempts.accountId, input.accountId), eq(executionAttempts.id, attemptId)));
        const activated = await transaction.update(executionPlacements).set({ status: "RUNNING", providerDefinitionId: definition.id, providerSessionId: result.providerSessionId, quote, updatedAt: now() }).where(and(eq(executionPlacements.accountId, input.accountId), eq(executionPlacements.id, placement.id), eq(executionPlacements.status, "DISPATCHING"))).returning({ id: executionPlacements.id });
        if (!activated.length) throw new RelayError("PROVIDER_ERROR", "Provider accepted but authoritative placement changed; reconciliation is required.", undefined, 502);
        await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, taskId: placement.taskId, actionIntentId: placement.actionIntentId, leaseId: placement.leaseId, eventType: "execution.provider_accepted", outcome: "SUCCESS", details: { placementId: placement.id, attemptId, providerKey: manifest.providerKey, providerDefinitionId: definition.id, receipt: safeReceipt } }, signer);
      });
      await recordProviderSuccess(definition.id);
      return { providerKey: manifest.providerKey, providerSessionId: result.providerSessionId, attempt };
    } catch (error) {
      const preEffect = error instanceof ProviderDispatchError && error.phase === "PRE_EFFECT";
      await recordProviderFailure(definition.id);
      await db().update(executionAttempts).set({ status: preEffect ? "PRE_EFFECT_FAILED" : "EFFECT_UNKNOWN", effectState: preEffect ? "PRE_EFFECT" : "POSSIBLY_COMMITTED", errorClass: error instanceof ProviderDispatchError ? error.errorClass : error instanceof Error ? error.name : "UnknownError", completedAt: now() }).where(and(eq(executionAttempts.accountId, input.accountId), eq(executionAttempts.id, attemptId)));
      if (!preEffect) {
        await db().update(executionPlacements).set({ status: "RECONCILIATION_REQUIRED", providerDefinitionId: definition.id, updatedAt: now() }).where(and(eq(executionPlacements.accountId, input.accountId), eq(executionPlacements.id, placement.id)));
        throw new RelayError("PROVIDER_ERROR", "Provider dispatch outcome is unknown; reconciliation is required before retry.", undefined, 502);
      }
      preEffectFailures.push(`${manifest.providerKey}:${error instanceof Error ? error.message : "unknown pre-effect failure"}`);
    }
  }
  await db().update(executionPlacements).set({ status: "FAILED", updatedAt: now() }).where(and(eq(executionPlacements.accountId, input.accountId), eq(executionPlacements.id, placement.id)));
  throw new RelayError("PROVIDER_ERROR", `All eligible providers failed before effect dispatch (${preEffectFailures.join("; ")}).`, undefined, 503);
}

export async function listExecutionPlacements(accountId: string) { return await db().select().from(executionPlacements).where(eq(executionPlacements.accountId, accountId)).orderBy(asc(executionPlacements.createdAt)); }
export async function listExecutionAttempts(accountId: string, placementId: string) { return await db().select().from(executionAttempts).where(and(eq(executionAttempts.accountId, accountId), eq(executionAttempts.placementId, placementId))).orderBy(asc(executionAttempts.attempt)); }
