# Sofie runtime and lease compatibility requirements

Prepared against accepted Composio Relay `35300e8da774e2e521dc8892d7fbc776a0bc0fa6` and canonical Relay E `0af281b72cf8e894a6dc2aa7a3ba8c181471ebb6`. No public consumer transport or positive execution is activated. These requirements reuse existing Relay runtime/lease contracts, not an integration token format.

## Authentication and exact authority

Use `authenticateDeveloperClient()` / `authenticateRuntimeClient()` for runtime credentials, or the explicitly configured canonical OAuth verifier. Validate active runtime registration, credential revocation/expiry and audience. Never treat the current agent credential or a parsed runtimeClientId as proof of Sofie's runtime identity. Keep Composio API keys solely in a separately authorized Relay/provider boundary; MyEve receives none.

Bind the authenticated account/runtime to canonical ActionIntent (`relay.action-intent.v2`) accountId/runtimeClientId. Resolve the task and its assigned agent/status server-side; qualify harness, workload attestation, owner/organization/installation mapping, Work/Mission and delegation through the canonical authorities. Request fields cannot select verifier, issuer, audience or privileged owner. Parent capabilities and budgets attenuate descendants.

`consumerResource()` and `relay.integration-read.v1` currently bind exact integration request material, but parsing does not authenticate runtime/task or authorize execution. Preserve canonical hash equality for capability + resource + parameters and compare integration scope to authenticated identity. Canonical admission digest serialization differs from Relay's prefixed canonicalHash; use the Control Plane contract vectors.

## Lease and durable command composition

Reuse canonical workload bootstrap/exchange, policy evaluation, capability lease issuance, `authorizeLeaseCall(..., online:true)`, introspection/revocation and existing result/proof contracts. Required lease bindings are issuer/key, exact account/agent/runtime/task/workload, audience, capability name/version, action hash/resource, policy decision/revision, approval decision if applicable, environment/assurance, delegation/parent lease, revocation epoch, expiry/not-before, maxCalls and budgetReservationId.

`authorizeLeaseCall` is a consuming operation: it validates the live lease/token hash, workload, epoch, parent authority and reservation; durably deduplicates call ID and increments call count. It is not a harmless freshness probe. Exhausted/expired/revoked leases and budgets deny. Discovery does not consume a tool execution lease.

The existing `/api/v2/runtime/actions` transport uses Bearer authentication, `x-relay-account-id`, `x-relay-lease`, `x-relay-audience`, `x-relay-workload-id` and an idempotency key. Its existence does not make Composio a supported action backend. Before wiring, the canonical owner must specify server-bound expected audience and workload rather than trusting header claims independently, and qualify action dispatch. Frozen routes and runtime/lease code are unchanged here.

`submitDurableRuntimeAction()` binds `runtime-action:<runtimeClientId>:<idempotencyKey>` to the canonical action hash, resolves task/agent, then calls online lease authorization before writing command/outbox and signed queued evidence. The lease call uses its own transaction. Request owner qualification for crash/retry between lease debit and command commit, and for admission/dispatch fencing; do not promise atomicity across those transactions. Reuse canonical receipts and accounting rather than adding a parallel lease ledger.

Existing command replay returns its durable receipt before rechecking task/lease. That response must never be interpreted as a new admission or a second dispatch. A worker must follow qualified canonical rules for the existing admitted command, current targeted controls and connection revocation. Bound a provider attempt to the canonical command/call identity and preserve UNKNOWN if the external outcome is ambiguous. Do not decrement exposure or claim release merely because a local process timed out.

## Required consumer outcomes

| Condition | Sofie behavior |
|---|---|
| Catalog/connection metadata available | Explain setup/state and assigned access; do not claim live provider health. |
| Discovery permitted | Load at most ten relevant reviewed schemas (default five); schema/description/result text remains data, never instructions. |
| Current checkpoint read request | Surface NOT_DISPATCHED / CROSS_DATABASE_ORDERING_UNQUALIFIED. “Relay has not enabled this read, so I have not retrieved your issues.” No fabricated summary. |
| Invalid/expired runtime or lease | Reauthenticate/reestablish canonical authority; never substitute another owner, agent or connection. |
| Stale/pending policy, local revoke, unqualified admission | Explain blocked state. No fallback provider token, alternative transport or automatic execute retry. |
| Future durable queued command | Show queued/admitted status only as proved by its canonical receipt; do not call it a completed read. |
| Future provider ambiguity | UNKNOWN, with canonical correlation and reconciliation; no success claim or blind retry. |
| Future qualified success | Bounded projected result plus canonical Result/Proof; grounded answer cites retrieved evidence and treats content as untrusted. |

Acceptance tests must include authenticated runtime/task mismatch, wrong audience/workload, revoked registration/parent, lease replay/call exhaustion, expired budget/reservation, command replay after revoke, changed integration binding under the same idempotency key, crash after debit/before command, stale canonical permit, revoked connection before dispatch and IR-1 descriptor substitution. No positive fixture may inject an allow boolean around the canonical admission boundary.

Readiness: contract preparation complete; public runtime/lease composition, positive Golden Journey and live provider results **NOT_QUALIFIED / NOT_RUN**. Canonical owner decisions and the boundary acceptance package remain prerequisites.
