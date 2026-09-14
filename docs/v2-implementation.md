---
title: Relay V2 Implementation Ledger
status: active
base_commit: 43e0160eb2b9552f71154d18369e4626e0e79339
base_tag: relay-v1.0.0-rc.1
branch: feat/relay-v2
specification: /Users/jaywest/Documents/ChatGPT/New project/docs/specs/relay-v2-product-architecture-spec.md
workorders: /Users/jaywest/Documents/ChatGPT/New project/docs/plans/2026-09-13-feat-relay-v2-foundation-workorders-plan.md
---

# Relay V2 Implementation Ledger

Relay V2 is developed from the immutable V1 RC1 tag on a dedicated branch. This ledger does not authorize changes to V1 branches, tags, soak evidence, or release history.

## Status

| WorkOrder | Title | Dependencies | State | Commit | Qualification | Blockers / deviations |
|---|---|---|---|---|---|---|
| WO-00 | Establish V2 isolation and governance | — | QUALIFIED | `07b1427` | LOCAL PASS | Remote branch/deploy protection: BLOCKED_EXTERNAL_CONFIGURATION |
| WO-01 | Freeze vocabulary, schemas, and state machines | WO-00 | QUALIFIED | `b468a38` | LOCAL PASS | — |
| WO-02 | Complete security architecture and abuse cases | WO-01 | IMPLEMENTED | `dbb48a0` | LOCAL PASS | Independent security-owner sign-off: BLOCKED_EXTERNAL_CONFIGURATION |
| WO-03 | Build tenancy, principals, and account roles | WO-01, WO-02 | QUALIFIED | `b5400fd` | SCOPED PASS | Acceptance sequencing corrected by Product Owner; live OIDC/WebAuthn pending provider qualification |
| WO-04 | Build evidence and append-only audit substrate | WO-01, WO-02, WO-03 | QUALIFIED | `b37cdba` | LOCAL PASS | Production KMS/HSM and object-store bindings are deployment configuration |
| WO-05 | Build Agent Passport and runtime attribution | WO-03, WO-04 | QUALIFIED | `85412d1` | LOCAL PASS | Third-party issuer federation remains excluded |
| WO-06 | Build capability registry and policy decision service | WO-02–WO-05 | QUALIFIED | `caaf8dd` | LOCAL PASS | External KMS signer binding remains deployment configuration |
| WO-07 | Build centralized approval service | WO-03, WO-04, WO-06 | QUALIFIED | `aaeeb1b` | LOCAL PASS | Quorum and email-link authorization remain excluded |
| WO-08 | Build capability leases and workload identity | WO-05–WO-07 | QUALIFIED | `897be3e` | LOCAL PASS | Production KMS/mTLS binding awaits provider WorkOrders |
| WO-09 | Build multi-dimensional budget engine | WO-04, WO-06, WO-08 | QUALIFIED | `a4cb446` | LOCAL PASS | Provider meter feeds and production SLOs await provider WorkOrders |
| WO-10 | Build durable event router and task orchestrator | WO-03, WO-04 | QUALIFIED | `34ac699` | LOCAL PASS | Live Temporal/broker failover and production SLOs remain deployment qualification |
| WO-11 | Build execution provider SDK and scheduler | WO-06, WO-08–WO-10 | QUALIFIED | `49a99c7` | LOCAL PASS | No real provider is qualified by this WorkOrder; live provider SLOs remain later gates |
| WO-12 | Qualify Relay-managed Playwright execution | WO-11 | QUALIFIED | `b56dea7` | LOCAL + LIVE PASS | Profile intentionally capped at registered/internal/ephemeral; production image attestation remains WO-22 |
| WO-13 | Qualify Browserbase and E2B adapters | WO-11 | IMPLEMENTED | `5f47543` | LOCAL PASS | Live Browserbase/E2B qualification: BLOCKED_EXTERNAL_CONFIGURATION (API keys absent) |
| WO-14 | Build customer runner and outbound private gateway | WO-08, WO-10, WO-11 | IMPLEMENTED | `dd0c2af` | LOCAL PASS | Live host/mTLS/attestation/network/provenance: BLOCKED_EXTERNAL_CONFIGURATION |
| WO-15 | Build live observation and human control | WO-07, WO-08, WO-12, WO-13 | IMPLEMENTED | pending | LOCAL PASS | Live provider/video/accessibility/production latency evidence pending WO-21/WO-22 |
| WO-16 | Qualify Slack and Telegram communications | WO-07, WO-10 | NOT_STARTED | — | — | — |
| WO-17 | Qualify Google Drive and Linear connectors | WO-06, WO-08, WO-10 | NOT_STARTED | — | — | — |
| WO-18 | Build financial domain and controlled purchase intents | WO-07, WO-09, WO-15 | NOT_STARTED | — | — | — |
| WO-19 | Build same-account Agent delegation | WO-04, WO-05, WO-08–WO-10 | NOT_STARTED | — | — | — |
| WO-20 | Publish REST, events, MCP, and client SDKs | WO-05–WO-10, WO-19 | NOT_STARTED | — | — | — |
| WO-21 | Build operator and user dashboard | WO-04, WO-07, WO-10, WO-15–WO-18 | NOT_STARTED | — | — | — |
| WO-22 | Qualify V2 for limited beta and GA | WO-12–WO-21 | NOT_STARTED | — | — | — |

## Work log

### 2026-09-13 — Implementation frontier

- Read the approved V2 specification, WorkOrder plan, brainstorm, and execution brief.
- Determined the V2 base as immutable tag `relay-v1.0.0-rc.1` at `43e0160eb2b9552f71154d18369e4626e0e79339`.
- Rejected `codex/relay-v1-rc-soak` HEAD as a base because it contains ongoing post-tag soak work and its latest evidence still recommends continued soak.
- Created dedicated branch `feat/relay-v2` from the immutable base.
- Added ADR-016 and `pnpm v2:frontier:check` to enforce immutable tag, ancestry, branch, and protected-ref invariants.
- Qualification passed: frontier check, typecheck, lint, and unit tests (4/4).
- Live verification of GitHub branch protections and V2-only deployment credentials is `BLOCKED_EXTERNAL_CONFIGURATION`; no administrative mutation was attempted.

### 2026-09-13 — WO-01 contracts

- Added strict V2 action, event, capability-lease, resource, capability-reference, and approval-scope validators.
- Added stable JSON Schema 2020-12 identifiers, reason codes, and explicit task/action/approval/lease transition maps.
- Added deterministic canonical JSON and SHA-256 action hashing with invalid-value rejection.
- Qualification passed: typecheck, lint, and focused contract/hygiene tests (9/9).

### 2026-09-13 — WO-02 security architecture

- Documented six enforcement boundaries, authoritative fact ownership, tenant isolation, classifications, key/credential lifecycle, runner assurance, egress, approval integrity, and fail-closed behavior.
- Mapped all 20 approved threats to preventative controls, detective/recovery controls, and required qualification test IDs.
- Qualification passed: typecheck, lint, contract tests, and security-architecture completeness tests (9/9).
- Independent security-owner acceptance remains `BLOCKED_EXTERNAL_CONFIGURATION`; no self-approval is recorded.

### 2026-09-13 — Approved tenant-isolation sequencing correction

- Product Owner approved qualifying WO-03 only against boundaries present at WO-03: identity persistence, membership authorization, service clients, step-up replay protection, existing APIs, and existing database/account boundaries.
- Every later WorkOrder must add focused isolation coverage for every tenant boundary it introduces.
- WO-22 retains the complete cross-boundary tenant-isolation release gate.
- This resolves the circular dependency without weakening tenant isolation.

### 2026-09-13 — WO-03 tenancy and principals

- Added additive principal, membership, service-client, and step-up tables plus deterministic backfill for existing V1 users.
- Added baseline OWNER/ADMIN/OPERATOR/APPROVER/MEMBER/AUDITOR permissions without using roles as Agent capability grants.
- Added one-time service credentials, account-bound authentication, active-membership enforcement, principal suspension/session revocation, and action-bound password step-up.
- Corrected a pre-commit design flaw that would have trusted a caller-declared step-up method; only server-verified password completion is currently implemented.
- Scoped qualification passed: frontier and Drizzle checks, typecheck, lint, auth 3/3, database 3/3, existing security 5/5, V2 identity 5/5.
- OIDC/WebAuthn provider adapters remain unqualified and are not represented as implemented authentication evidence.

### 2026-09-13 — WO-04 evidence and append-only audit

- Added account-scoped append-only audit records with canonical hashing, per-account transactional sequencing, Ed25519 signatures, and signed export manifests that detect record tampering, truncation, deletion, reordering, and tenant substitution.
- Added an offline verifier with public-key rotation support and no database or Relay service dependency.
- Added envelope-encrypted evidence artifacts, account-bound key wrapping, structured-evidence redaction, integrity verification, retention enforcement, and tombstoned deletion hooks.
- Local cryptographic and object-store adapters refuse production use where applicable; production KMS/HSM and private object-store bindings remain deployment configuration, not embedded durable credentials.
- Added focused tenant-isolation coverage for the new audit, artifact metadata, object storage, and key-unwrapping boundaries.
- Qualification passed: V2 frontier guard, typecheck, lint, Drizzle schema check, and all runnable tests (60/60); 3 live-provider tests remained intentionally skipped.

### 2026-09-13 — WO-05 Agent Passport and runtime attribution

- Added draft-first V2 Agent lifecycle and signed, versioned Passport v1 documents containing owner, trust, eligibility, policy, budget, environment, data-access, validity, and revocation claims.
- Added a trusted issuer-registry boundary and quarantine-style import: verified source provenance is retained, while no local Passport or capability grant is created by import.
- Added explicit trust downgrade behavior that increments the revocation epoch, returns the Agent to draft, records evidence, and invokes the future incompatible-work revocation boundary.
- Added runtime-client identities and one-time credentials; product labels remain self-declared until a configured server-side attestation verifier supplies verified identity evidence.
- Added focused isolation tests for Passport persistence/export, imported provenance, runtime-client verification, and runtime credentials.
- Qualification passed: frontier guard, typecheck, lint, Drizzle schema check, focused V2 tests (22/22), and all runnable tests (65/65); 3 live-provider tests remained intentionally skipped.

### 2026-09-13 — WO-06 capability registry and policy engine

- Added immutable signed capability definitions with explicit versions, effect/risk classes, resource types, and typed input/output contracts.
- Added signed, versioned structured policy bundles with Relay-safety and account layers, staged activation, exact-hash password step-up, deterministic precedence, limit/scope intersection, and retained history.
- Added mandatory authoritative resource-ownership resolution; Agent-supplied tenant attributes are not accepted as ownership evidence.
- Added fresh authoritative fact resolvers and fail-closed handling for missing, stale, future-dated, non-authoritative, and conflicting facts.
- Added durable decision records containing capability/bundle hashes, redacted material facts, obligations, expiry, and a self-contained evaluation snapshot that reproduces historic outcomes.
- Added focused tenant-isolation coverage for policy activation, resource ownership, and decision queries; added golden outcomes for all five policy results and a 10,000-evaluation local latency gate.
- Qualification passed: frontier guard, typecheck, lint, Drizzle schema check, and all runnable tests (70/70); 3 live-provider tests remained intentionally skipped.

### 2026-09-13 — WO-07 centralized approvals

- Added account-scoped approval requests, separately signed human decisions, atomic consumption records/counters, and durable assignment notification records.
- Bound requests to immutable action hashes, active policy decisions, exact Agent/runtime/task context, risk/effect class, displayed evidence, assigned approvers, and expiry.
- Added once/task/session scope intersection; V2 broader scopes conservatively authorize only repeated instances of the identical approved action template.
- Enforced hard once-only floors for financial and destructive actions and for external communications without an authoritative known-recipient fact.
- Added revoke, supersede, and expiry hooks; exposed transaction-aware consumption for atomic integration with WO-08 permit issuance and WO-09 reservations.
- Added focused tenant-isolation coverage for requests, decisions, consumptions, notifications, assignment, and policy linkage, plus an eight-way consumption race fixture.
- A parallel focused run exposed a repository test-harness database teardown race although all assertions passed; the authoritative clean qualification reran database-backed tests serially.
- Qualification passed: frontier guard, typecheck, lint, Drizzle schema check, and all runnable serial tests (76/76); 3 live-provider tests remained intentionally skipped.

### 2026-09-13 — WO-08 capability leases and workload identity

- Added one-time, tenant-bound workload bootstrap with Ed25519 proof of possession and a signed short-lived workload identity token; Relay never receives the workload private key.
- Added signed capability leases bound to account, Agent, runtime, workload, task, audience, exact capability/resource/action, policy revision, approval, environment, call limit, parent, expiry, and revocation epoch.
- Integrated approval consumption atomically with lease issuance and re-enforced financial, destructive, and new-recipient communication floors at the issuance boundary.
- Added reference online/offline PEP enforcement, per-call replay receipts, atomic call counters, introspection, workload/lease revocation, and emergency Agent epoch revocation.
- Added atomic parent-call reservation so concurrent child leases cannot amplify delegated authority; unused reservations remain conservatively unavailable until later completion reconciliation.
- Restricted offline authority to parentless low-risk reads with at most 60 seconds remaining and a durable local counter; financial and destructive permits always require online validation.
- Added focused tenant-isolation and conformance coverage for workloads, bootstrap secrets, leases, epochs, parent relationships, call receipts, token bindings, introspection, and revocation.
- Qualification passed: focused cryptographic/PEP suite (14/14), frontier guard, typecheck, lint, Drizzle schema check, and all runnable serial tests (83/83); 3 live-provider tests remained intentionally skipped.

### 2026-09-13 — WO-09 multi-dimensional budget engine

- Added exact fixed-point account, Agent, task, and delegation budgets for tokens, model spend, connector calls, compute time, computer time, and purchases; monetary values require explicit currency and never use binary floating point.
- Added hierarchical hard/soft limits with per-account transaction serialization, conditional database enforcement, durable warning events, and child ceilings constrained by current parent remainder.
- Added action-scoped atomic reservations, account-local idempotency, usage ingestion, reconciliation, release, expiry, and truthful overage handling that records actual usage and marks uncertain balances `UNKNOWN`.
- Bound metered capability leases one-to-one to live reservations and required online enforcement to reject released, expired, disabled, stale, unknown, or cross-account budget state before an execution call.
- Required purchase-metered capabilities to use the financial effect class, preserving the non-overridable approval floor from WO-07/WO-08; stale or unknown purchase balances fail closed.
- Added focused tenant-isolation coverage for budgets, hierarchy lookups, Agent ownership, reservations, status mutation, usage, warning events, and lease binding.
- Qualification passed: 50-way concurrency fixture, focused budget/lease suite (15/15), frontier guard, typecheck, lint, Drizzle schema check, and all runnable serial tests (91/91); 3 live-provider tests remained intentionally skipped.

### 2026-09-13 — WO-10 durable events and task orchestration

- Added signature-verifier-first event ingress with strict V2 envelopes, account/source deduplication, provider sequence tracking, and explicit reordered-delivery evidence.
- Added immutable versioned routes that resolve only active same-account Agents and atomically create one logical task, state history, start command, outbox messages, and audit evidence per event/route pair.
- Added a PostgreSQL-backed multi-instance command queue with transactional claims, coordinator leases, monotonic fences, bounded classified retries, and worker-death recovery.
- Added mandatory pre-effect classification: pre-effect and provider-idempotent work may retry; possibly committed effects never auto-retry and enter the DLQ as `EFFECT_UNKNOWN`.
- Added poison/retry-exhaustion dead letters, single explicit account-authorized replay, durable cancellation delivery, and an at-least-once outbox whose stable idempotency keys make publisher crash recovery safe.
- Added the deterministic `relay.task.v1` Temporal workflow contract/reducer. PostgreSQL remains the authority and Relay's command ledger owns retries; Temporal's adapter uses stable workflow IDs and cannot override fences.
- Added focused tenant-isolation coverage for routes, normalized events, sequence cursors, tasks/jobs, state history, commands/queue, outbox, and dead letters.
- Qualification passed: focused state/fault/isolation suite (15/15), frontier guard, typecheck, lint, Drizzle schema check, and all runnable serial tests (99/99); 3 live-provider tests remained intentionally skipped.

### 2026-09-13 — WO-11 execution provider SDK and scheduler

- Added a strict provider-neutral adapter SDK for health, quotes, idempotent preparation, control, observation, evidence, meters, termination, and reconciliation.
- Added immutable signed provider manifests, runtime conformance checks, signature/integrity verification at scheduling and dispatch, and shared database-backed circuit state.
- Added deterministic hard-filter-first placement across feature, Passport provider eligibility, assurance, region, isolation, persistence, classification, private networking, duration, health, circuit, adapter availability, and exact quote constraints.
- Resolved a design seam exposed by the failover fixture: the WO-08 lease authorizes the scheduler workload and does not pretend its current-workload provider binding is a candidate set. Candidate providers come from active Passport ∩ policy requirements; provider-specific workload identity/leases are minted only after placement in WO-12–WO-14.
- Added idempotent placement decisions with auditable exclusions, requirements hashes, manifest hashes, and deterministic scoring; hard-filtered providers cannot be restored by better speed, capacity, or price.
- Added dispatch-time authority/health/quote revalidation, opaque vault-handle-only credential references, atomic dispatch claims, pre-effect-only failover, redacted receipts, and mandatory reconciliation without failover for ambiguous effects.
- Added focused tenant-isolation coverage for placements and attempts, plus concurrency, failover, ambiguity, circuit-breaker, manifest tamper, and compatibility vectors.
- Qualification passed: focused provider conformance/chaos/isolation suite (7/7), frontier guard, typecheck, lint, Drizzle schema check, and all runnable serial tests (106/106); 3 live-provider tests remained intentionally skipped.

### 2026-09-13 — WO-12 Relay-managed execution provider

- Added a provider-SDK-compatible Relay-managed adapter for one ephemeral visual-browser plus Docker shell/file session with click, type, key, scroll, screenshot, bounded shell, and bounded file read/write/list/delete operations.
- Kept the qualified claim intentionally conservative: `registered` assurance, process-level common isolation, internal-or-lower data, public-only browser networking, no shell network, and no persistence/private networking/live takeover/high-assurance hostile code.
- Added per-action account/task/lease reauthorization, pause/resume, short expiry, opaque vault-handle broker binding, credential revocation, idempotent termination, cleanup reconciliation, hashed action evidence, stable meters, and no typed text/handle retention.
- Added SSRF/DNS/private-address blocking, path traversal/absolute/NUL rejection, no Docker mounts, dropped capabilities, no-new-privileges, PID/CPU/memory/time/output limits, and bounded command/input payloads.
- Added immutable image-provenance enforcement plus a CycloneDX execution-substrate SBOM recording Alpine OCI digest, Playwright/Chromium versions, and lockfile hash. Production must replace local provenance with signed build attestation at WO-22.
- Added focused tenant-isolation coverage for managed sessions and post-task leaked authority, plus termination tests proving browser/container/credential access removal.
- Qualification passed: focused managed + SDK conformance suite (12/12), live component/combined lifecycle suite (4/4), frontier guard, typecheck, lint, Drizzle schema check, and all default runnable serial tests (111/111); 4 opt-in live-provider tests were intentionally skipped in the default run and passed separately.

### 2026-09-13 — WO-13 Browserbase and E2B providers

- Added provider-SDK-compatible Browserbase and E2B adapters without changing Agent-facing placement or execution contracts.
- Browserbase is conservatively registered for ephemeral visual browser control, fresh live observation, and replay metadata. E2B is conservatively registered for ephemeral microVM shell/files and explicitly beta pause/resume.
- Kept both at `registered` assurance and internal-or-lower classification; provider isolation/compliance statements do not become Relay attestation.
- Added server-only API-key sources, hard rejection of execution credential handles where no qualified secret broker exists, operator kill switches, bounded read-only backoff, and create failure classification that permits failover only after explicit pre-effect rejection.
- Added focused isolation coverage for Browserbase/E2B account-task-lease session bindings, plus provider substitution, capability, secret, rate-limit, timeout, 5xx, expired-link refresh, cleanup, and kill-switch tests.
- Qualification passed: focused provider suite (27/27), frontier guard, typecheck, lint, Drizzle schema check, and all runnable serial tests (126/126); 4 opt-in local live tests remained intentionally skipped. Live Browserbase and E2B qualification is `BLOCKED_EXTERNAL_CONFIGURATION` because neither provider API key is configured; no live provider assurance, retention, or SLO claim is recorded.

### 2026-09-13 — WO-14 customer runner and private gateway

- Added one-time account-bound runner enrollment with key proof of possession, signed expiring certificates, trust epochs, assurance downgrade for unverifiable attestation, operator revocation, and signed digest-pinned update manifests.
- Added an outbound-only assignment stream binding runner/account/task/workload/lease/payload/expiry/fence, plus ordered runner-signed evidence that remains labeled `runner_reported`.
- Added assignment-scoped credential-socket broker bindings; durable secret values and environment injection are outside the runner contract.
- Added named HTTPS private resources with exact runner, assignment, method, and path-prefix enforcement. Arbitrary subnet, raw TCP/UDP, and independent runner policy storage remain excluded.
- Added focused tenant-isolation coverage for enrollments, runner identity, assignment polling, evidence, gateway resources/receipts, credential bindings, and cascade revocation.
- Qualification passed: focused migration/runner suite (8/8), frontier guard, typecheck, lint, Drizzle schema check, and all runnable serial tests (131/131); 4 opt-in local live tests remained intentionally skipped. Live customer-host, mTLS, attestation, network-capture, revoke-latency, and release-provenance qualification is `BLOCKED_EXTERNAL_CONFIGURATION` and remains a WO-22 gate.

### 2026-09-13 — WO-15 live observation and human control

- Added account-scoped computer-control sessions, opaque short-lived viewer grants, durable control events, provider-URL containment behind an observation relay, and explicit disconnect behavior.
- Added atomic input permits, in-flight counters, takeover locks, and monotonic fences so Agent input and human control cannot coexist under races.
- Added protected credential-entry mode that suppresses observation before the provider relay and records no frame, key, or credential contents.
- Added explicit resume requiring fresh policy and integrity checks, with input-fence and viewer-epoch rotation plus prior viewer revocation.
- Added focused tenant-isolation coverage for control sessions, viewer grants, observations, inputs, takeover, disconnect, and resume.
- Local focused qualification passed. Live provider, UI video, accessibility, and production latency evidence remain downstream WO-21/WO-22 gates; no such claim is recorded here.
