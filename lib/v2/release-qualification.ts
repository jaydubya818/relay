export const REQUIRED_TENANT_BOUNDARIES = [
  "identity",
  "api",
  "database",
  "jobs-workflows",
  "caches",
  "search-indexes",
  "object-storage",
  "events-outbox",
  "temporal-workflows",
  "runners",
  "artifacts",
  "computers",
  "browsers",
  "sandboxes",
  "communications",
  "connectors",
  "approvals",
  "budgets",
] as const;

export type TenantBoundary = typeof REQUIRED_TENANT_BOUNDARIES[number];
export type BoundaryDisposition = "EXERCISED" | "ABSENT_AND_GUARDED";

export type TenantIsolationEvidence = {
  boundary: TenantBoundary;
  disposition: BoundaryDisposition;
  testFiles: readonly string[];
  evidencePhrases: readonly string[];
  rationale?: string;
};

export const TENANT_ISOLATION_EVIDENCE: readonly TenantIsolationEvidence[] = [
  { boundary: "identity", disposition: "EXERCISED", testFiles: ["tests/v2/identity.test.ts"], evidencePhrases: ["enforces account membership", "binds step-up authentication to account"] },
  { boundary: "api", disposition: "EXERCISED", testFiles: ["tests/v2/developer-platform.test.ts", "tests/v2/dashboard.test.ts"], evidencePhrases: ["fails closed for wrong tenant", "projects only the authenticated account"] },
  { boundary: "database", disposition: "EXERCISED", testFiles: ["tests/v2/release-qualification.test.ts", "tests/security/v1-boundaries.test.ts"], evidencePhrases: ["requires an account column", "denies cross-account Agent"] },
  { boundary: "jobs-workflows", disposition: "EXERCISED", testFiles: ["tests/v2/orchestration.test.ts"], evidencePhrases: ["isolates routes, jobs, history, outbox, and dead letters"] },
  { boundary: "caches", disposition: "ABSENT_AND_GUARDED", testFiles: ["tests/v2/release-qualification.test.ts"], evidencePhrases: ["keeps absent cache and search boundaries absent"] , rationale: "V2 has no application cache. Adding one requires tenant-keyed focused coverage before this guard may change." },
  { boundary: "search-indexes", disposition: "ABSENT_AND_GUARDED", testFiles: ["tests/v2/release-qualification.test.ts"], evidencePhrases: ["keeps absent cache and search boundaries absent"], rationale: "V2 has no external search index. Adding one requires tenant-keyed focused coverage before this guard may change." },
  { boundary: "object-storage", disposition: "EXERCISED", testFiles: ["tests/v2/evidence.test.ts"], evidencePhrases: ["isolates audit queries and encrypted artifacts by account"] },
  { boundary: "events-outbox", disposition: "EXERCISED", testFiles: ["tests/v2/orchestration.test.ts", "tests/v2/runners.test.ts"], evidencePhrases: ["keeps acknowledged events and outbox messages durable", "wakes one task"] },
  { boundary: "temporal-workflows", disposition: "EXERCISED", testFiles: ["tests/v2/orchestration.test.ts", "tests/v2/release-qualification.test.ts"], evidencePhrases: ["defines a deterministic, fenced workflow", "tenant-binds Temporal workflow identities"] },
  { boundary: "runners", disposition: "EXERCISED", testFiles: ["tests/v2/runners.test.ts"], evidencePhrases: ["isolates runner assignments by tenant"] },
  { boundary: "artifacts", disposition: "EXERCISED", testFiles: ["tests/v2/evidence.test.ts"], evidencePhrases: ["isolates audit queries and encrypted artifacts by account"] },
  { boundary: "computers", disposition: "EXERCISED", testFiles: ["tests/v2/runners.test.ts", "tests/v2/dashboard.test.ts"], evidencePhrases: ["makes Agent input and human takeover mutually exclusive", "projects only the authenticated account"] },
  { boundary: "browsers", disposition: "EXERCISED", testFiles: ["tests/v2/third-party-providers.test.ts", "tests/v2/relay-managed-provider.test.ts"], evidencePhrases: ["controls Browserbase through the same bounded visual-browser actions", "enforces tenant/task/lease bindings"] },
  { boundary: "sandboxes", disposition: "EXERCISED", testFiles: ["tests/v2/third-party-providers.test.ts", "tests/v2/relay-managed-provider.test.ts"], evidencePhrases: ["supports E2B shell/files and account-bound beta pause/resume", "enforces tenant/task/lease bindings"] },
  { boundary: "communications", disposition: "EXERCISED", testFiles: ["tests/v2/runners.test.ts"], evidencePhrases: ["sends once, isolates tenants"] },
  { boundary: "connectors", disposition: "EXERCISED", testFiles: ["tests/v2/runners.test.ts"], evidencePhrases: ["stores only broker handles with visible scopes", "reconciles writes, and detects permission drift"] },
  { boundary: "approvals", disposition: "EXERCISED", testFiles: ["tests/v2/approvals.test.ts"], evidencePhrases: ["wrong approvers, expiry, and cross-account access"] },
  { boundary: "budgets", disposition: "EXERCISED", testFiles: ["tests/v2/budgets.test.ts", "tests/v2/money.test.ts"], evidencePhrases: ["isolates budgets, reservations, status changes", "isolates purchase, receipt, and aggregator boundaries"] },
] as const;

export const SECTION_15_CRITERIA = Array.from({ length: 15 }, (_, index) => index + 1) as readonly number[];

export type GateStatus = "PASS" | "BLOCKED_EXTERNAL_CONFIGURATION" | "PENDING_INDEPENDENT_REVIEW" | "PENDING_PRODUCT_OWNER";
export type ReleaseEvidence = {
  section15: Readonly<Record<number, GateStatus>>;
  tenantIsolation: GateStatus;
  credentialNonExposure: GateStatus;
  independentSecurityReview: GateStatus;
  penetrationTest: GateStatus;
  providerChannelQualification: GateStatus;
  operationalDrills: GateStatus;
  accessibilityAndComprehension: GateStatus;
  signedBuildProvenance: GateStatus;
  productOwnerDecision: GateStatus;
};

export type ReleaseGateResult = { ready: boolean; blockers: readonly string[] };

export function evaluateV2ReleaseGate(evidence: ReleaseEvidence): ReleaseGateResult {
  const blockers: string[] = [];
  for (const criterion of SECTION_15_CRITERIA) {
    if (evidence.section15[criterion] !== "PASS") blockers.push(`section15.${criterion}:${evidence.section15[criterion]}`);
  }
  for (const [gate, status] of Object.entries(evidence).filter(([gate]) => gate !== "section15")) {
    if (status !== "PASS") blockers.push(`${gate}:${status}`);
  }
  return { ready: blockers.length === 0, blockers };
}

export function assertV2ReleaseReady(evidence: ReleaseEvidence) {
  const result = evaluateV2ReleaseGate(evidence);
  if (!result.ready) throw new Error(`Relay V2 release gate is not satisfied: ${result.blockers.join(", ")}`);
}
