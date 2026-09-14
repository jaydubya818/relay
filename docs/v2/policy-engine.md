# Relay V2 Capability Registry and Policy Engine

WO-06 is the authoritative policy-decision point. It evaluates immutable action intents against signed capability definitions, active structured policy bundles, an active Agent Passport, tenant ownership, and fresh authoritative facts. It never executes an action.

## Capability definitions

V2 capability definitions are globally named and versioned. Each immutable definition declares effect class, risk class, resource type, and JSON input/output schemas, and is hash-bound and signed. V1's capability table remains unchanged.

## Structured policy

V2 accepts only the `relay.policy-bundle.v1` structured rule schema. Arbitrary code, third-party bundles, and custom policy runtimes are excluded. Relay safety-floor bundles are created only through the internal system boundary. Account policy is staged by an owner/admin and activation requires recent password step-up evidence bound to the exact bundle hash. Replaced bundles are retained as retired versions.

Applicable policy layers are intersected. Precedence is `DENY > ESCALATE > REQUIRE_APPROVAL > LIMIT > ALLOW`. Numeric limits take the minimum. Approval scopes are intersected; an empty intersection denies with `CONFLICTING_POLICY`. No matching rule denies by default.

## Facts and reproducibility

Rules name the authoritative facts they require. Server-configured resolvers return a value, observation time, expiry, authority flag, and source revision. Missing, non-authoritative, future-observed, expired, or conflicting values fail closed. Material facts are redacted before evaluation and persistence, so secret-like fact names cannot enter the decision store.

Each decision stores the exact capability hash, policy bundle hashes, redacted facts, evaluation snapshot, outcome, obligations, and expiry. The historic reproducer runs the pure deterministic evaluator against that snapshot without consulting current policy.

## Isolation obligation

Policy bundles and decisions are account-scoped; only global Relay safety bundles have no account. Action account IDs, resource account attributes, Agent Passport ownership, account policies, decision queries, and activation step-up evidence are independently checked. Focused negative coverage joins the WO-22 tenant-isolation suite.
