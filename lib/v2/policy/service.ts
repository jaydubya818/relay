import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db, withTransaction } from "@/lib/db";
import { agentPassports, capabilityDefinitions, policyBundles, policyDecisions, stepUpChallenges } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import { actionIntentSchema, agentPassportSchema, canonicalHash, type ActionIntent } from "@/lib/v2/contracts";
import { appendAuditRecordInTransaction } from "@/lib/v2/evidence/audit";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { redactForEvidence } from "@/lib/v2/evidence/redaction";
import { requireMembership } from "@/lib/v2/identity";
import { capabilityDefinitionSchema, policyBundleDocumentSchema, resolvedFactSchema, type CapabilityDefinition, type PolicyBundleDocument, type ResolvedFact } from "./contracts";
import { evaluatePolicySnapshot, requiredFactNames, type PolicyEvaluationResult, type PolicyEvaluationSnapshot } from "./evaluator";

type AccountPolicyLayer = "ACCOUNT" | "RESOURCE" | "TASK" | "DYNAMIC_RISK";

export interface PolicyFactResolver {
  readonly name: string;
  resolve(input: { accountId: string; action: ActionIntent; evaluatedAt: string }): Promise<ResolvedFact | undefined>;
}

export interface PolicyResourceResolver {
  resolveOwnership(input: { accountId: string; resource: ActionIntent["resource"] }): Promise<ResolvedFact | undefined>;
}

function actionMaterial(action: ActionIntent) {
  return { capability: action.capability, resource: action.resource, parameters: action.parameters };
}

export async function registerCapabilityDefinition(input: CapabilityDefinition, signer: AuditSigner) {
  const parsed = capabilityDefinitionSchema.parse(input);
  const definition = { ...parsed, meteringDimensions: parsed.meteringDimensions ?? [] };
  const definitionHash = canonicalHash(definition);
  const signature = await signer.sign(definitionHash);
  const capabilityId = id("cap");
  await db().insert(capabilityDefinitions).values({ id: capabilityId, ...definition, definitionHash, signature, signingKeyId: signer.keyId });
  return { capabilityId, definitionHash, signature, signingKeyId: signer.keyId };
}

async function createPolicyBundleDocument(input: { accountId: string | null; name: string; layer: PolicyBundleDocument["layer"]; rules: PolicyBundleDocument["rules"]; createdByPrincipalId?: string }, signer: AuditSigner, activate: boolean) {
  return await withTransaction(async (transaction) => {
    const lockKey = `${input.accountId ?? "relay"}:${input.layer}:${input.name}`;
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const [previous] = await transaction.select({ version: policyBundles.version }).from(policyBundles).where(and(input.accountId ? eq(policyBundles.accountId, input.accountId) : isNull(policyBundles.accountId), eq(policyBundles.layer, input.layer), eq(policyBundles.name, input.name))).orderBy(desc(policyBundles.version)).limit(1);
    const document = policyBundleDocumentSchema.parse({ schemaVersion: "relay.policy-bundle.v1", accountId: input.accountId, name: input.name, layer: input.layer, version: (previous?.version ?? 0) + 1, rules: input.rules });
    const bundleHash = canonicalHash(document);
    const signature = await signer.sign(bundleHash);
    const bundleId = id("pol");
    await transaction.insert(policyBundles).values({ id: bundleId, accountId: input.accountId, name: input.name, layer: input.layer, version: document.version, status: activate ? "ACTIVE" : "STAGED", rules: document.rules, bundleHash, signature, signingKeyId: signer.keyId, createdByPrincipalId: input.createdByPrincipalId, activatedAt: activate ? now() : undefined });
    return { bundleId, document, bundleHash, signature, signingKeyId: signer.keyId };
  });
}

export async function publishRelaySafetyPolicy(input: { name: string; rules: PolicyBundleDocument["rules"] }, signer: AuditSigner) {
  return await createPolicyBundleDocument({ accountId: null, name: input.name, layer: "RELAY_SAFETY", rules: input.rules }, signer, true);
}

export async function stageAccountPolicy(input: { accountId: string; actorPrincipalId: string; name: string; layer: AccountPolicyLayer; rules: PolicyBundleDocument["rules"] }, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.actorPrincipalId, allowedRoles: ["OWNER", "ADMIN"] });
  return await createPolicyBundleDocument({ accountId: input.accountId, name: input.name, layer: input.layer, rules: input.rules, createdByPrincipalId: input.actorPrincipalId }, signer, false);
}

export async function activateAccountPolicy(input: { accountId: string; actorPrincipalId: string; bundleId: string; stepUpChallengeId: string }, signer: AuditSigner) {
  await requireMembership({ accountId: input.accountId, principalId: input.actorPrincipalId, allowedRoles: ["OWNER", "ADMIN"] });
  await withTransaction(async (transaction) => {
    const [bundle] = await transaction.select().from(policyBundles).where(and(eq(policyBundles.accountId, input.accountId), eq(policyBundles.id, input.bundleId), eq(policyBundles.status, "STAGED"))).limit(1);
    if (!bundle) throw new RelayError("INVALID_INPUT", "Staged policy bundle not found.", undefined, 404);
    const freshnessFloor = new Date(Date.now() - 10 * 60_000).toISOString();
    const [stepUp] = await transaction.select({ id: stepUpChallenges.id }).from(stepUpChallenges).where(and(eq(stepUpChallenges.id, input.stepUpChallengeId), eq(stepUpChallenges.accountId, input.accountId), eq(stepUpChallenges.principalId, input.actorPrincipalId), eq(stepUpChallenges.actionClass, "policy.activate"), eq(stepUpChallenges.actionHash, bundle.bundleHash), eq(stepUpChallenges.status, "CONSUMED"), gt(stepUpChallenges.consumedAt, freshnessFloor))).limit(1);
    if (!stepUp) throw new RelayError("INVALID_CREDENTIAL", "Fresh action-bound step-up evidence is required.", undefined, 401);
    await transaction.update(policyBundles).set({ status: "RETIRED", retiredAt: now() }).where(and(eq(policyBundles.accountId, input.accountId), eq(policyBundles.name, bundle.name), eq(policyBundles.layer, bundle.layer), eq(policyBundles.status, "ACTIVE")));
    await transaction.update(policyBundles).set({ status: "ACTIVE", activatedAt: now() }).where(and(eq(policyBundles.accountId, input.accountId), eq(policyBundles.id, bundle.id)));
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, actorPrincipalId: input.actorPrincipalId, eventType: "policy.activated", outcome: "SUCCESS", details: { bundleId: bundle.id, bundleHash: bundle.bundleHash, layer: bundle.layer, version: bundle.version } }, signer);
  });
}

async function loadEvaluationInputs(accountId: string, action: ActionIntent) {
  const [capability] = await db().select().from(capabilityDefinitions).where(and(eq(capabilityDefinitions.name, action.capability.name), eq(capabilityDefinitions.version, action.capability.version), eq(capabilityDefinitions.enabled, true))).limit(1);
  if (!capability) throw new RelayError("CAPABILITY_DENIED", "Capability definition is unavailable.", action.capability.name, 403);
  const [passportRow] = await db().select().from(agentPassports).where(and(eq(agentPassports.accountId, accountId), eq(agentPassports.agentId, action.agentId), eq(agentPassports.status, "ACTIVE"), gt(agentPassports.expiresAt, now()))).orderBy(desc(agentPassports.version)).limit(1);
  if (!passportRow) throw new RelayError("CAPABILITY_DENIED", "Active Agent Passport is unavailable.", action.capability.name, 403);
  const rows = await db().select().from(policyBundles).where(and(or(isNull(policyBundles.accountId), eq(policyBundles.accountId, accountId)), eq(policyBundles.status, "ACTIVE")));
  const bundles = rows.map((row) => policyBundleDocumentSchema.parse({ schemaVersion: "relay.policy-bundle.v1", name: row.name, layer: row.layer, version: row.version, accountId: row.accountId, rules: row.rules }));
  return {
    capability: capabilityDefinitionSchema.parse({ name: capability.name, version: capability.version, domain: capability.domain, description: capability.description, effectClass: capability.effectClass, riskClass: capability.riskClass, resourceType: capability.resourceType, inputSchema: capability.inputSchema, outputSchema: capability.outputSchema, meteringDimensions: capability.meteringDimensions }),
    capabilityHash: capability.definitionHash,
    passport: agentPassportSchema.parse(passportRow.payload),
    bundles,
    bundleHashes: rows.map((row) => row.bundleHash).sort(),
  };
}

async function resolveFacts(names: string[], resolvers: PolicyFactResolver[], input: { accountId: string; action: ActionIntent; evaluatedAt: string }) {
  const facts: ResolvedFact[] = [];
  for (const name of names) {
    const candidates = resolvers.filter((resolver) => resolver.name === name);
    if (!candidates.length) return { facts, failure: "MISSING_AUTHORITATIVE_FACT" as const };
    const resolved = (await Promise.all(candidates.map((resolver) => resolver.resolve(input)))).filter((fact): fact is ResolvedFact => Boolean(fact)).map((fact) => resolvedFactSchema.parse(fact));
    if (!resolved.length) return { facts, failure: "MISSING_AUTHORITATIVE_FACT" as const };
    if (resolved.some((fact) => fact.name !== name) || resolved.some((fact) => canonicalHash(fact.value) !== canonicalHash(resolved[0]!.value))) return { facts, failure: "CONFLICTING_POLICY" as const };
    facts.push(resolved[0]!);
  }
  return { facts };
}

async function persistDecision(input: { accountId: string; action: ActionIntent; capabilityHash: string; bundleHashes: string[]; snapshot: PolicyEvaluationSnapshot; result: PolicyEvaluationResult; signer: AuditSigner }) {
  const decisionId = id("dec");
  const factExpiry = input.snapshot.facts.map((fact) => Date.parse(fact.expiresAt));
  const expiresAt = new Date(Math.min(Date.now() + 60_000, ...(factExpiry.length ? factExpiry : [Date.now() + 60_000]))).toISOString();
  const persistableSnapshot = redactForEvidence(input.snapshot) as unknown as PolicyEvaluationSnapshot;
  await withTransaction(async (transaction) => {
    await transaction.insert(policyDecisions).values({ id: decisionId, accountId: input.accountId, actionIntentId: input.action.id, agentId: input.action.agentId, outcome: input.result.outcome, reasonCodes: input.result.reasonCodes, obligations: input.result.obligations, capabilityDefinitionHash: input.capabilityHash, policyBundleHashes: input.bundleHashes, materialFacts: persistableSnapshot.facts, evaluationSnapshot: { snapshot: persistableSnapshot, result: input.result }, expiresAt });
    await appendAuditRecordInTransaction(transaction, { accountId: input.accountId, agentId: input.action.agentId, runtimeClientId: input.action.runtimeClientId, taskId: input.action.taskId, actionIntentId: input.action.id, policyDecisionId: decisionId, eventType: "policy.evaluated", outcome: input.result.outcome, details: { reasonCodes: input.result.reasonCodes, matchedRuleIds: input.result.matchedRuleIds, capabilityDefinitionHash: input.capabilityHash, policyBundleHashes: input.bundleHashes } }, input.signer);
  });
  return { decisionId, expiresAt, ...input.result };
}

export async function evaluatePolicy(input: { accountId: string; action: ActionIntent; resourceResolver: PolicyResourceResolver; factResolvers?: PolicyFactResolver[] }, signer: AuditSigner) {
  const action = actionIntentSchema.parse(input.action);
  if (action.accountId !== input.accountId || canonicalHash(actionMaterial(action)) !== action.canonicalHash) throw new RelayError("INVALID_INPUT", "Action intent account or canonical hash is invalid.");
  const loaded = await loadEvaluationInputs(input.accountId, action);
  const evaluatedAt = now();
  const resolved = await resolveFacts(requiredFactNames(loaded.bundles), input.factResolvers ?? [], { accountId: input.accountId, action, evaluatedAt });
  const ownership = await input.resourceResolver.resolveOwnership({ accountId: input.accountId, resource: action.resource });
  const parsedOwnership = ownership ? resolvedFactSchema.parse(ownership) : undefined;
  const ownershipFailure = !parsedOwnership || parsedOwnership.name !== "resource.account_id" || !parsedOwnership.authoritative || Date.parse(parsedOwnership.observedAt) > Date.parse(evaluatedAt) || Date.parse(parsedOwnership.expiresAt) <= Date.parse(evaluatedAt) ? "MISSING_AUTHORITATIVE_FACT" as const : undefined;
  const facts = redactForEvidence([...(parsedOwnership ? [parsedOwnership] : []), ...resolved.facts]) as ResolvedFact[];
  const failure = ownershipFailure ?? resolved.failure;
  const snapshot: PolicyEvaluationSnapshot = { action, capability: loaded.capability, passport: loaded.passport, bundles: loaded.bundles, facts, evaluatedAt, ...(failure ? { factResolutionFailure: failure } : {}) };
  const result = evaluatePolicySnapshot(snapshot);
  return await persistDecision({ accountId: input.accountId, action, capabilityHash: loaded.capabilityHash, bundleHashes: loaded.bundleHashes, snapshot, result, signer });
}

export async function reproducePolicyDecision(accountId: string, decisionId: string) {
  const [decision] = await db().select().from(policyDecisions).where(and(eq(policyDecisions.accountId, accountId), eq(policyDecisions.id, decisionId))).limit(1);
  if (!decision) throw new RelayError("INVALID_INPUT", "Policy decision not found.", undefined, 404);
  const stored = decision.evaluationSnapshot as { snapshot: PolicyEvaluationSnapshot; result: PolicyEvaluationResult };
  const reproduced = evaluatePolicySnapshot(stored.snapshot);
  return { matches: canonicalHash(reproduced) === canonicalHash(stored.result), stored: stored.result, reproduced };
}

export async function simulatePolicy(snapshot: PolicyEvaluationSnapshot) {
  return evaluatePolicySnapshot(snapshot);
}
