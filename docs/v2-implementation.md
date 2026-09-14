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
| WO-00 | Establish V2 isolation and governance | — | QUALIFIED | `07b1427` | LOCAL PASS | Remote protection was initially BLOCKED_EXTERNAL_CONFIGURATION; authenticated WO-22 inspection now records FAILED |
| WO-01 | Freeze vocabulary, schemas, and state machines | WO-00 | QUALIFIED | `b468a38` | LOCAL PASS | — |
| WO-02 | Complete security architecture and abuse cases | WO-01 | IMPLEMENTED | `dbb48a0` | LOCAL PASS | Independent security-owner review pending |
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
| WO-15 | Build live observation and human control | WO-07, WO-08, WO-12, WO-13 | IMPLEMENTED | `656e0af` | LOCAL PASS | Live provider/video/accessibility/production latency evidence pending WO-21/WO-22 |
| WO-16 | Qualify Slack and Telegram communications | WO-07, WO-10 | IMPLEMENTED | `c7e545a` | LOCAL PASS | Live Slack/Telegram channel qualification: BLOCKED_EXTERNAL_CONFIGURATION |
| WO-17 | Qualify Google Drive and Linear connectors | WO-06, WO-08, WO-10 | IMPLEMENTED | `67faf40` | LOCAL PASS | Live Google Drive/Linear qualification: BLOCKED_EXTERNAL_CONFIGURATION |
| WO-18 | Build financial domain and controlled purchase intents | WO-07, WO-09, WO-15 | IMPLEMENTED | `e8eaa88` | LOCAL PASS | Aggregator disabled; independent PCI review and production protected-view qualification pending WO-22 |
| WO-19 | Build same-account Agent delegation | WO-04, WO-05, WO-08–WO-10 | QUALIFIED | `eb00d61` | LOCAL PASS | Production-scale revocation/outbox/load evidence remains WO-22 |
| WO-20 | Publish REST, events, MCP, and client SDKs | WO-05–WO-10, WO-19 | QUALIFIED | `352c8e1` | LOCAL PASS | Live vendor/client and hosted authorization-server conformance remain external |
| WO-21 | Build operator and user dashboard | WO-04, WO-07, WO-10, WO-15–WO-18 | IMPLEMENTED | `8109a47` | LOCAL PASS | Formal screen-reader and multi-participant comprehension evidence pending WO-22 |
| WO-22 | Qualify V2 for limited beta and GA | WO-12–WO-21 | BLOCKED_EXTERNAL_QUALIFICATION | `ec10c27`, `a7ed00f`, `6b72301` | LOCAL + RELAY-MANAGED LIVE PARTIAL | External providers/channels/topology and human reviews remain blocked; remote governance controls are FAILED |

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
- Qualification passed: focused migration/control suite (11/11), frontier guard, typecheck, lint, Drizzle schema check, and all runnable serial tests (134/134); 4 opt-in local live tests remained intentionally skipped. Live provider, UI video, accessibility, and production latency evidence remain downstream WO-21/WO-22 gates; no such claim is recorded here.

### 2026-09-13 — WO-16 Slack and Telegram communications

- Added account-owned Slack and Telegram connections whose durable records contain opaque vault handles, provider identity mapping, and no credential values.
- Added current Slack raw-body signing-secret verification with a five-minute replay window and Telegram webhook secret-token verification; deprecated Slack verification tokens are not accepted.
- Added account-scoped provider conversation/thread mapping, bounded attachment metadata classification, provider-event deduplication, owned-bot echo suppression, and direct normalization into the durable WO-10 event router so one accepted retry creates one Agent task.
- Added exact thread/text action-hash and active lease enforcement for replies, mandatory approval-linked authority for new recipients, stable send idempotency, provider message/final-state receipts, and reauthorization immediately before effect.
- Added concrete Slack `chat.postMessage` and Telegram `sendMessage` adapters. Explicit 429 responses enter a single-winner delayed retry path; timeout and 5xx outcomes become `EFFECT_UNKNOWN` and cannot retry without reconciliation.
- Added focused tenant-isolation coverage for communication connections, threads, inbound/outbound messages, routing, leases, approvals, queries, retries, and reconciliation. Cross-account send attempts fail before message persistence or provider effect.
- Qualification passed: focused channel/control/provider suite (14/14), frontier guard, typecheck, lint, Drizzle schema check, and all runnable serial tests (140/140); 4 opt-in local live tests remained intentionally skipped. Live Slack workspace and Telegram bot delivery/rate/latency evidence is `BLOCKED_EXTERNAL_CONFIGURATION` and remains a WO-22 gate.

### 2026-09-13 — WO-17 Google Drive and Linear connectors

- Qualified a two-connector V2 surface rather than a generic API proxy: Google Drive v3 search/read plus binary file create/update, and Linear issue search/read/create plus title/description update.
- Restricted Google to `drive.file` with authenticated user-selected roots/files; broad Drive scopes, delete, move, sharing, permission changes, and Workspace-native conversion remain excluded. Restricted Linear to configured team IDs and rejected workflow-state, assignment, label, delete, and arbitrary GraphQL mutations.
- Added signed immutable connector manifests with exact scopes, capabilities, network hosts, credential access, versioning, conformance checks, and signature verification at every operation.
- Added account/principal/provider-bound one-time OAuth state, broker-owned PKCE and token exchange, opaque credential handles, exact scope/resource validation, scopes/restrictions display, fail-closed local revoke, reconnect semantics, and current read/write permission drift detection.
- Added canonical Drive-file and Linear-issue adapters, pre-generated Drive create IDs, stable Linear reconciliation references, provider resource tracking, effect-unknown containment, explicit reconciliation, redacted provider receipts, idempotency-key misuse rejection, and lease call-limit consumption.
- Corrected a pre-commit authorization flaw by replacing caller-declared Drive `appCreated` status with authoritative account/connection-scoped resource records.
- Added focused tenant-isolation coverage for OAuth flows, connections, definitions, resource mappings, operations, receipts, lease/action bindings, revocation, permission snapshots, and queries; cross-account attempts fail before persistence or provider effect.
- Qualification passed: focused connector/control/provider suite (17/17), frontier guard, typecheck, lint, Drizzle schema check, and all runnable serial tests (146/146); 4 opt-in local live tests remained intentionally skipped. V2-specific Google Drive and Linear live OAuth/provider packs are `BLOCKED_EXTERNAL_CONFIGURATION`; frozen V1 credentials/evidence were not reused or modified.

### 2026-09-13 — WO-18 financial domain and controlled purchase intents

- Added account-scoped financial accounts, transactions, opaque payment-credential references, purchase intents, protected-checkout permits, and receipts; no raw payment field or funds-custody model exists.
- Added canonical `money.purchase.request@1.0` binding across merchant, exact amount, currency, items, tax/shipping tolerance, credential reference, Agent/runtime/task, action hash, and idempotency key.
- Reserved the requested amount plus declared contingency headroom atomically before approval. Any observed merchant, currency, or total change still revokes checkout and requires a fresh intent/approval; tolerance never silently expands payment authority.
- Required a current once-only financial approval and exact live purchase-budget reservation before atomically fencing Agent input, rotating the computer-control fence, and enabling protected credential entry.
- Returned only the human-facing credential label during checkout; the opaque vault handle remains server-side and has no V2 production execution path.
- Added confirmed receipt reconciliation and terminal `EFFECT_UNKNOWN` handling that marks affected budget state unknown and cannot be retried. Agent control remains paused until WO-15 policy/integrity resume checks pass.
- Added shared payment-data rejection/redaction for explicit PAN/CVV/CVC/bank fields and Luhn-valid payment numbers, a test-only simulated executor that refuses production, and a disabled-by-default qualified read-only aggregator registry.
- Added focused tenant-isolation coverage for financial records, credential references, intents, reservations, checkout permits, control-session bindings, receipts, and aggregator access, plus a concurrent purchase-budget fixture.
- Qualification passed: focused money suite (6/6), frontier guard, typecheck, lint, Drizzle schema check, and all runnable serial tests (152/152); 4 opt-in live-provider tests remained intentionally skipped.
- Independent PCI/security/legal assessment, financial-aggregator selection, and production protected-view suppression validation remain external qualifications and do not authorize unattended payment execution.

### 2026-09-13 — WO-19 same-account Agent delegation

- Added attached same-account parent/child task delegation with one immutable `agents.task.delegate@1.0` action binding the child, objective, authority promises, context memory IDs, budget ceilings, and idempotency key.
- Added newly allocated child tasks, explicit parent relationships, maximum depth 8, active fan-out 16, durable start commands/outbox delivery, and no detachable or cross-account child mode.
- Added child-Passport capability/data-access intersection, parent-task lease validation, pending-promise accounting, single-winner authority claim, and normal WO-08 parent-linked child leases.
- Corrected parent lease revocation so it recursively revokes all descendant leases rather than checking only an immediate parent at call time.
- Restricted context transfer to authoritative, explicitly named same-account memory records; private records must be parent-created and child context APIs return no undeclared memory. Provenance exports contain context hashes, not content.
- Added delegation-scoped child budgets with sibling/live-parent ceiling checks and authoritative lineage resolution inside WO-09 reservation transactions. Caller-declared parent task/Agent identity is not accepted.
- Added terminal result return with redaction, hashes, same-account evidence references, parent-task outbox notification, automatic unused-authority/budget shutdown, recursive delegation revoke, and signed provenance export.
- Added focused tenant-isolation coverage for delegation records, task relationships, contexts, authority promises/claims, child leases, budgets, results, evidence references, queries, and provenance exports.
- Qualification passed: focused delegation suite (6/6), affected lease/budget/delegation suites (21/21), frontier guard, typecheck, lint, Drizzle schema check, and all runnable serial tests (158/158); 4 opt-in live-provider tests remained intentionally skipped.
- Production-scale depth/fan-out load, recursive revocation latency, outbox recovery, and worker-loss claim reconciliation remain WO-22 qualification work.

### 2026-09-13 — WO-20 developer platform, REST, MCP, and SDKs

- Added dated REST endpoints for durable runtime action submission/status plus a protected-resource metadata endpoint and deployment-owned signer, key-resolver, and OAuth-verifier bindings.
- Added exact account/runtime/resource/audience/workload/action/lease authorization. OAuth tokens are accepted only for an active same-account runtime registration and the exact requested resource; downstream connector-token passthrough is not part of the contract.
- Added serialized runtime-scoped idempotency so concurrent retries create one command, one transactional outbox wake-up, and one lease-call receipt. Reuse with a different valid canonical action fails with `409`.
- Added stateless MCP `2026-07-28` discovery/routing and compatibility initialization for `2025-11-25` and `2025-06-18`, with authenticated tool listing and structured action results.
- Published OpenAPI and JSON schemas, TypeScript and dependency-free Python reference clients, Codex/Claude examples, versioning guidance, and an explicit runtime compatibility matrix. Product labels remain attribution rather than authority; named-client certification is deferred.
- Added focused tenant-isolation coverage for REST/MCP access, OAuth resources, runtime registrations, command status, commands, and outbox wake-ups. These boundaries remain inputs to the mandatory WO-22 cross-boundary suite.
- Implementation commit: `352c8e1` (`feat(v2): add developer REST MCP and SDK contracts`).
- Qualification passed: typecheck, lint, Python syntax validation, focused interoperability/isolation suite (5/5), isolated approval regression rerun (6/6), and all runnable serial tests (163/163); 4 opt-in live-provider tests remained intentionally skipped.
- Published-package signing, live vendor/client certification, hosted authorization-server conformance, and independent security qualification remain external or WO-22 evidence. Remote branch/deployment protections remain `BLOCKED_EXTERNAL_CONFIGURATION`; independent security-owner review of WO-02 remains pending.

### 2026-09-13 — WO-21 operator control dashboard

- Added an additive `/v2` evidence-first operator surface covering Command, Activity, Tasks, Approval Center, Agents and Passports, Computers, Connections, Policies and Budgets, Runners and Providers, and Settings without modifying the frozen V1 surface.
- Added an account-scoped dashboard projection that resolves an active operator membership and selects only safe display fields. Credential handles and hashes, runner public keys, webhook-secret references, and other durable secret material are not returned.
- Added same-origin operator mutations for exact approval decisions, task cancellation, computer pause/take-control, and runner cascade revocation. Approval decisions use a server-created, once-only password step-up bound to the request, action hash, decision, account, and principal; destructive controls require a visible two-stage confirmation.
- Represented pending, paused, stale/unknown budget, effect-unknown, dead-letter, reconciliation-required, provider/runner unavailable, protected-entry, empty, error, and success states with explicit operator guidance. Resume is intentionally absent unless fresh policy and integrity checks are configured.
- Added focused tenant-isolation coverage for the dashboard read model and authenticated operator boundary. The mutation routes derive account/principal exclusively from the authenticated session and delegate to existing account-scoped domain services.
- Implementation commit: `8109a47` (`feat(v2): add operator control dashboard`).
- Qualification passed: focused dashboard suite (2/2), typecheck, lint, production build, frontier guard, all runnable serial tests (165/165), keyboard/semantic inspection, zero console errors/warnings, and local axe-core WCAG A/AA checks with zero violations across all ten V2 routes; 4 opt-in live-provider tests remained intentionally skipped.
- Preserved desktop and mobile screenshots in `output/playwright/`. Automated accessibility results do not establish complete WCAG conformance; formal screen-reader/platform testing and the Product Owner's multi-participant actor/destination/consequence/scope comprehension study remain WO-22 launch evidence.
- Remote branch/deployment protections remain `BLOCKED_EXTERNAL_CONFIGURATION`; independent security-owner review of WO-02 remains pending. Neither external qualification blocked this dependency-ready implementation.

### 2026-09-13 — WO-22 aggregate release qualification

- Added a fail-closed release evaluator covering all 15 specification acceptance criteria plus tenant isolation, credential non-exposure, independent security review, penetration testing, provider/channel currency, operational drills, accessibility/comprehension, signed build provenance, and explicit Product Owner decision. The evaluator cannot report ready while any gate is pending.
- Added the mandatory cross-boundary tenant-isolation registry for identity, API, database, jobs/workflows, caches, search/indexes, object storage, events/outbox, Temporal workflows, runners, artifacts, computers, browsers, sandboxes, communications, connectors, approvals, and budgets.
- Added an aggregate test that requires exact boundary coverage, resolves every cited evidence phrase from the focused suites, introspects the migrated schema for tenant-owned tables missing `account_id`, tenant-binds Temporal workflow IDs, and guards the deliberate absence of V2 cache and external-search implementations.
- Recorded the only schema exceptions explicitly: global registries and identity roots, plus the inherited V1 `connection_credentials` child table. V2 connector credentials use opaque broker handles and do not use that inherited table.
- Added the release operations contract for SLO/alert signals, provider/channel kill switches, restore/regional recovery, revocation/DLQ/unknown-effect/retention drills, staged rollout/rollback, privacy deletion, and incident ownership.
- Added a release dossier separating deterministic local evidence from evidence that requires live credentials, production-like infrastructure, independent reviewers, human participants, and Product Owner authority.
- Implementation commit: `ec10c27` (`feat(v2): add fail-closed release qualification gate`).
- Local aggregate qualification passed: frontier guard, Drizzle schema check, typecheck, lint, focused release suite (5/5), all runnable serial tests (170/170), performance tests (2/2, including the existing 10k policy-evaluation budget exercised in the main suite), and production build; 4 opt-in live-provider tests remained intentionally skipped.
- WO-22 remains `BLOCKED_EXTERNAL_QUALIFICATION`. Browserbase, E2B, customer runner/private gateway, Slack, Telegram, Google Drive, Linear, production KMS/vault/object storage/build provenance, broker/Temporal/database/region drills, production protected-view validation, independent security review/penetration test, formal accessibility/comprehension, and Product Owner limited-beta/GA decisions do not have qualified evidence in this environment.
- Remote branch/deployment protections remain `BLOCKED_EXTERNAL_CONFIGURATION`; independent security-owner review of WO-02 remains pending. No V1 branch, tag, soak record, or implementation was modified, and no V2.1/V3 work was started.

### 2026-09-13 — WO-22 external release qualification campaign

- Reconciled the complete release-gate matrix in `docs/v2/qualification/wo22-gate-matrix.md`, with exact requirements, methods, evidence, environment ownership, automation/browser/human responsibilities, and Product Owner decisions.
- Relay-managed live execution is `PASSED_LIVE` for the conservative registered/internal/ephemeral profile: Docker/Chromium provider suites passed 6/6 and the combined browser/shell/file lifecycle completed in 2.156 seconds. Persistent profiles and restricted/high-assurance execution are not qualified.
- Browserbase, E2B, customer runner/private gateway, Slack, Telegram, V2 Google Drive, V2 Linear, live Temporal and production topology remain `BLOCKED_EXTERNAL_CONFIGURATION`; no mock or V1 credential was promoted to live evidence.
- Focused trusted-action, event durability, revocation and evidence suites passed 33/33 across leases, orchestration, approvals, money and evidence. Exact action binding, policy hashes, once approval, budget contention, bounded leases, protected human checkout, receipt settlement, ambiguous-effect behavior and audit integrity are `PASSED_AUTOMATED`.
- A disposable PostgreSQL 14.18 backup/restore drill is `PASSED_LIVE`: source/restored data hashes both equal `ed2f34b16c077cfc20e206040120eb0d6301ab22162ae59a6acc25814dace404`, with restored counts of 1 account, 2 agents and 21 migrations. Production failover/RPO/RTO and object/Temporal recovery remain blocked.
- Fresh accessibility qualification found and preserved a moderate duplicate-landmark finding plus a missing Settings current-route marker. The focused fix names the sidebar complementary landmark, adds Settings to the navigation, and adds regression coverage. Post-fix dashboard tests passed 2/2; typecheck and lint passed; axe-core 4.13 reported zero violations across all ten V2 routes; semantic/current-route/accessible-name checks and skip-link focus passed; final console was clean.
- Focused defect commit: `a7ed00f` (`fix(v2): close WO-22 dashboard accessibility findings`). Qualification evidence commit: `6b72301` (`docs(v2): record WO-22 external qualification evidence`).
- Added the bounded WO-02 independent review package, independent penetration checklist, and human accessibility/approval-comprehension protocol. Those independent gates remain `REQUIRES_HUMAN_REVIEW`; the Product Owner release choice remains `REQUIRES_PRODUCT_OWNER_DECISION`.
- Authenticated GitHub inspection transitioned remote main/tag/deployment protections from historical `BLOCKED_EXTERNAL_CONFIGURATION` to current `FAILED`: `main` is unprotected, repository rulesets and environments are empty, and no release/tag protection was found. No remote mutation was authorized or made.
- WO-22 remains `BLOCKED_EXTERNAL_QUALIFICATION` and the recommendation is `NOT_READY_FOR_LIMITED_BETA`. No V2 RC tag, main merge, V1 modification, V2.1 work or V3 work occurred.
