# WO-22 Relay V2 release qualification dossier

Status: `BLOCKED_EXTERNAL_QUALIFICATION`

WO-22 is the mandatory aggregate gate. Local implementation and tests can prove control behavior, but they cannot fabricate provider credentials, production topology, independent penetration testing, human comprehension results, signed build provenance, or Product Owner release approval.

## Local evidence complete

- The full cross-boundary isolation registry covers identity, API, database, jobs/workflows, caches, search/indexes, object storage, events/outbox, Temporal workflows, runners, artifacts, computers, browsers, sandboxes, communications, connectors, approvals, and budgets.
- Cache and external search boundaries are explicitly absent and guarded; introducing either makes the release suite fail until tenant-keyed focused tests and evidence are added.
- Database introspection requires `account_id` on tenant-owned tables. The explicit exceptions are global registries/identity roots and the inherited V1 `connection_credentials` child table; the latter is not used by V2 connectors.
- Existing focused suites exercise cross-account reads, mutations, IDs, replay, queue/workflow, object-key, provider-session, runner, approval, budget, communication, connector, computer, browser, and sandbox boundaries.
- Local fault cases cover duplicate/reordered ingress, single-winner command claims, worker death before/after possible effect, durable outbox retry, DLQ replay, provider errors/circuit/kill-switch behavior, runner revocation, approval substitution, budget contention, delegation cascade, protected entry, and evidence tampering.
- Offline audit export verification, credential redaction/canary checks, deterministic provider/connector conformance, frontend build, automated accessibility audit, and the immutable V1 frontier guard are green.
- The release gate is executable and fails closed while any Section 15, independent security, provider/channel, operational, provenance, accessibility/comprehension, or Product Owner gate is pending.

## External evidence required before limited beta

| Gate | Current state | Required immutable evidence |
|---|---|---|
| WO-02 independent security-owner review | `PENDING_INDEPENDENT_REVIEW` | Named reviewer decision against security architecture and threat matrix |
| Independent penetration test | `PENDING_INDEPENDENT_REVIEW` | Report with no open critical/high findings or signed exception with owner/expiry |
| Browserbase and E2B | `BLOCKED_EXTERNAL_CONFIGURATION` | Live versioned conformance, rate, timeout, outage, retention, and kill-switch report |
| Customer runner/private gateway | `BLOCKED_EXTERNAL_CONFIGURATION` | Customer-host mTLS, outbound-only network capture, attestation, compromise and revoke-latency report |
| Slack and Telegram | `BLOCKED_EXTERNAL_CONFIGURATION` | Live signed inbound, dedupe, exact approved send, rate-limit, outage, and receipt report |
| Google Drive and Linear | `BLOCKED_EXTERNAL_CONFIGURATION` | Live least-scope OAuth, permission drift, reconciliation, revoke, and provider-version report |
| Production KMS/vault/object store/build chain | `BLOCKED_EXTERNAL_CONFIGURATION` | Key rotation, canary, object retention, signed SBOM/provenance, image scan, patch evidence |
| Production broker/Temporal/database/region | `BLOCKED_EXTERNAL_CONFIGURATION` | Load/soak, failover, restore RPO/RTO, partial outage, queue fairness and alert evidence |
| Protected payment view / PCI / legal | `PENDING_INDEPENDENT_REVIEW` | Scope decision and production capture-suppression evidence; actual unattended payment remains disabled |
| Accessibility and comprehension | `PENDING_INDEPENDENT_REVIEW` | Screen-reader/browser matrix and multi-participant actor/destination/consequence/scope results |
| Product and operations launch choices | `PENDING_PRODUCT_OWNER` | Regions, retention, classifications, thresholds, beta cohort, provider set, signed beta decision |

## Section 15 state

Local criteria 1, 2, 6, 8, 9, 10, 12, and 13 have deterministic passing evidence. Criteria 3–5, 7, 11, and 14 require live or production-like external qualification. Criterion 15 requires independent review and penetration evidence. A local pass is never promoted to live provider or GA assurance.

## Release decision

`assertV2ReleaseReady` intentionally throws with the current evidence set. Relay V2 must not be labeled limited-beta-ready or GA-ready yet. Remote branch/deployment protections remain `BLOCKED_EXTERNAL_CONFIGURATION`; independent security-owner review of WO-02 remains pending. These statuses do not invalidate locally completed WorkOrders, but they are mandatory WO-22 release blockers.
