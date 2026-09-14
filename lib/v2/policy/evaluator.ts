import type { ActionIntent } from "@/lib/v2/contracts";
import type { AgentPassport } from "@/lib/v2/contracts/schemas";
import type { CapabilityDefinition, PolicyBundleDocument, PolicyRule, ResolvedFact } from "./contracts";

export type PolicyObligations = { limits: Record<string, number>; approval?: { classes: string[]; allowedScopes: Array<"once" | "task" | "session"> }; escalationTargets?: string[] };
export type PolicyEvaluationResult = { outcome: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "LIMIT" | "ESCALATE"; reasonCodes: string[]; obligations: PolicyObligations; matchedRuleIds: string[] };
export type PolicyEvaluationSnapshot = { action: ActionIntent; capability: CapabilityDefinition; passport: AgentPassport; bundles: PolicyBundleDocument[]; facts: ResolvedFact[]; evaluatedAt: string; factResolutionFailure?: "MISSING_AUTHORITATIVE_FACT" | "CONFLICTING_POLICY" };

const EFFECT_ORDER = { ALLOW: 0, LIMIT: 1, REQUIRE_APPROVAL: 2, ESCALATE: 3, DENY: 4 } as const;

function matches(rule: PolicyRule, snapshot: PolicyEvaluationSnapshot, facts: Map<string, ResolvedFact>) {
  const match = rule.match;
  if (match.capability && (match.capability.name !== snapshot.capability.name || match.capability.version !== snapshot.capability.version)) return false;
  if (match.effectClass && match.effectClass !== snapshot.capability.effectClass) return false;
  if (match.riskClass && match.riskClass !== snapshot.capability.riskClass) return false;
  if (match.resourceType && match.resourceType !== snapshot.action.resource.type) return false;
  return Object.entries(match.facts ?? {}).every(([name, value]) => facts.get(name)?.value === value);
}

export function requiredFactNames(bundles: PolicyBundleDocument[]) {
  return [...new Set(bundles.flatMap((bundle) => bundle.rules.flatMap((rule) => Object.keys(rule.match.facts ?? {}))))].sort();
}

export function evaluatePolicySnapshot(snapshot: PolicyEvaluationSnapshot): PolicyEvaluationResult {
  if (snapshot.factResolutionFailure) return { outcome: "DENY", reasonCodes: [snapshot.factResolutionFailure], obligations: { limits: {} }, matchedRuleIds: [] };
  if (snapshot.action.capability.name !== snapshot.capability.name || snapshot.action.capability.version !== snapshot.capability.version) return { outcome: "DENY", reasonCodes: ["CAPABILITY_NOT_GRANTED"], obligations: { limits: {} }, matchedRuleIds: [] };
  if (snapshot.action.resource.type !== snapshot.capability.resourceType) return { outcome: "DENY", reasonCodes: ["RESOURCE_OUT_OF_SCOPE"], obligations: { limits: {} }, matchedRuleIds: [] };
  const resourceAccount = snapshot.facts.find((fact) => fact.name === "resource.account_id");
  if (!resourceAccount || !resourceAccount.authoritative || Date.parse(resourceAccount.observedAt) > Date.parse(snapshot.evaluatedAt) || Date.parse(resourceAccount.expiresAt) <= Date.parse(snapshot.evaluatedAt)) return { outcome: "DENY", reasonCodes: ["MISSING_AUTHORITATIVE_FACT"], obligations: { limits: {} }, matchedRuleIds: [] };
  if (resourceAccount.value !== snapshot.action.accountId) return { outcome: "DENY", reasonCodes: ["TENANT_MISMATCH"], obligations: { limits: {} }, matchedRuleIds: [] };
  const eligible = snapshot.passport.capabilityEligibility.some((entry) => entry.name === snapshot.capability.name && entry.version === snapshot.capability.version);
  if (!eligible) return { outcome: "DENY", reasonCodes: ["CAPABILITY_NOT_GRANTED"], obligations: { limits: {} }, matchedRuleIds: [] };

  const facts = new Map(snapshot.facts.map((fact) => [fact.name, fact]));
  for (const name of requiredFactNames(snapshot.bundles)) {
    const fact = facts.get(name);
    if (!fact || !fact.authoritative || Date.parse(fact.observedAt) > Date.parse(snapshot.evaluatedAt) || Date.parse(fact.expiresAt) <= Date.parse(snapshot.evaluatedAt)) return { outcome: "DENY", reasonCodes: ["MISSING_AUTHORITATIVE_FACT"], obligations: { limits: {} }, matchedRuleIds: [] };
  }

  const matched = snapshot.bundles.flatMap((bundle) => bundle.rules).filter((rule) => matches(rule, snapshot, facts));
  if (!matched.length) return { outcome: "DENY", reasonCodes: ["POLICY_DENIED"], obligations: { limits: {} }, matchedRuleIds: [] };
  const outcome = matched.reduce<PolicyEvaluationResult["outcome"]>((current, rule) => EFFECT_ORDER[rule.effect] > EFFECT_ORDER[current] ? rule.effect : current, "ALLOW");
  const limits: Record<string, number> = {};
  for (const rule of matched) for (const [name, value] of Object.entries(rule.limits ?? {})) limits[name] = Math.min(limits[name] ?? Number.POSITIVE_INFINITY, value);
  const approvals = matched.flatMap((rule) => rule.approval ? [rule.approval] : []);
  const allowedScopes = approvals.length ? approvals.map((approval) => approval.allowedScopes).reduce((intersection, scopes) => intersection.filter((scope) => scopes.includes(scope))) : [];
  if (approvals.length && !allowedScopes.length) return { outcome: "DENY", reasonCodes: ["CONFLICTING_POLICY"], obligations: { limits }, matchedRuleIds: matched.map((rule) => rule.id).sort() };
  return {
    outcome,
    reasonCodes: [...new Set(matched.map((rule) => rule.reasonCode))].sort(),
    obligations: {
      limits,
      ...(approvals.length ? { approval: { classes: [...new Set(approvals.map((approval) => approval.class))].sort(), allowedScopes } } : {}),
      ...(matched.some((rule) => rule.escalationTarget) ? { escalationTargets: [...new Set(matched.flatMap((rule) => rule.escalationTarget ? [rule.escalationTarget] : []))].sort() } : {}),
    },
    matchedRuleIds: matched.map((rule) => rule.id).sort(),
  };
}
