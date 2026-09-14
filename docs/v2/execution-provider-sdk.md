# Relay V2 Execution Provider SDK

## Contract

Execution providers implement one versioned adapter contract for health, quotes, idempotent preparation, control, observation, evidence, meters, termination, and reconciliation. A signed immutable manifest declares features, assurance, regions, isolation and persistence modes, maximum data classification and duration, evidence sources, meters, private-network support, and create idempotency. Manifest claims are treated as compatibility inputs, not self-proving security attestations; provider qualification WorkOrders supply the evidence.

Provider adapters receive an execution specification containing account/task/action/authorization references, selected region/isolation/persistence, duration, stable idempotency key, and opaque vault handles. The SDK rejects credential values that are not `vlt_…` handles. It never provides an action prompt, durable credential, or lease signing key to an adapter.

The WO-08 lease passed to scheduling authorizes the hosted scheduler action. Its current-workload provider binding is not incorrectly reused as the execution-provider candidate set. Candidate providers are the intersection of the active Agent Passport and policy-derived requirements. After placement, WO-12 through WO-14 mint the selected provider workload identity and provider/audience-specific execution lease. This sequencing enables safe pre-effect failover without widening a workload-bound lease.

## Placement algorithm

1. Verify the same-account task, exact action-linked policy decision, active lease, and active Agent Passport.
2. Intersect policy-requested provider IDs with Passport-allowed providers and take the strongest assurance floor across request, Passport, and scheduler lease.
3. Hard-filter feature, provider, assurance, region, isolation, persistence, classification, private-network, duration, adapter availability, circuit, health freshness, quote validity/currency, and maximum quote.
4. Score only eligible providers using deterministic warm capacity, reliability, latency, exact quoted cost, and provider key tie-break.
5. Persist selected and excluded candidates, reasons, manifest hash, quote, algorithm version, and requested-requirements hash.

No score or preference can restore a hard-filtered provider. Repeating the same account/task/action request returns the original placement; changed lease or requirements under the same key is rejected.

## Dispatch and failure semantics

Before provider dispatch, Relay revalidates task/lease authority, provider registration, health, quote, and credential-handle shape, then atomically claims the placement. One placement cannot be dispatched concurrently.

- A provider must throw `ProviderDispatchError(..., "PRE_EFFECT")` only when it can prove no provider resource/effect was accepted. Relay records the attempt and may try the next already-qualified candidate.
- Any generic error or explicit `POSSIBLY_COMMITTED` result is treated as ambiguous. Relay records `EFFECT_UNKNOWN`, moves the placement to `RECONCILIATION_REQUIRED`, and does not fail over.
- Provider receipts are redacted before durable storage and audit.
- Three consecutive failures open the shared database-backed circuit for 60 seconds. An expired open circuit may probe; success closes and resets it.

## Conformance and later qualification

The WO-11 conformance harness rejects adapter/manifest identity mismatch, missing lifecycle methods, and inconsistent persistent/private-network claims. Fake-provider vectors prove hard-filter precedence, deterministic selection, pre-effect failover, ambiguous-dispatch stop, circuit opening, placement idempotency, concurrent dispatch exclusion, and account isolation.

WO-11 intentionally does not qualify a real provider. WO-12 qualifies Relay-managed Playwright; WO-13 qualifies Browserbase and E2B; WO-14 qualifies customer runners/private gateways. Each must run the same contract plus provider-specific escape, credential, cleanup, evidence, metering, and isolation tests. WO-22 re-runs the full provider/placement boundary in the cross-boundary tenant suite.
