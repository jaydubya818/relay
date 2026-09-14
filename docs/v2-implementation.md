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
| WO-08 | Build capability leases and workload identity | WO-05–WO-07 | QUALIFIED | pending commit | LOCAL PASS | Production KMS/mTLS binding awaits provider WorkOrders |
| WO-09 | Build multi-dimensional budget engine | WO-04, WO-06, WO-08 | NOT_STARTED | — | — | — |
| WO-10 | Build durable event router and task orchestrator | WO-03, WO-04 | NOT_STARTED | — | — | — |
| WO-11 | Build execution provider SDK and scheduler | WO-06, WO-08–WO-10 | NOT_STARTED | — | — | — |
| WO-12 | Qualify Relay-managed Playwright execution | WO-11 | NOT_STARTED | — | — | — |
| WO-13 | Qualify Browserbase and E2B adapters | WO-11 | NOT_STARTED | — | — | — |
| WO-14 | Build customer runner and outbound private gateway | WO-08, WO-10, WO-11 | NOT_STARTED | — | — | — |
| WO-15 | Build live observation and human control | WO-07, WO-08, WO-12, WO-13 | NOT_STARTED | — | — | — |
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
