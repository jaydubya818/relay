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
| WO-02 independent security-owner review | `REQUIRES_HUMAN_REVIEW` | Named reviewer decision against security architecture and threat matrix |
| Independent penetration test | `REQUIRES_HUMAN_REVIEW` | Report with no open critical/high findings or signed exception with owner/expiry |
| Browserbase and E2B | `BLOCKED_EXTERNAL_CONFIGURATION` | Live versioned conformance, rate, timeout, outage, retention, and kill-switch report |
| Customer runner/private gateway | `BLOCKED_EXTERNAL_CONFIGURATION` | Customer-host mTLS, outbound-only network capture, attestation, compromise and revoke-latency report |
| Slack and Telegram | `BLOCKED_EXTERNAL_CONFIGURATION` | Live signed inbound, dedupe, exact approved send, rate-limit, outage, and receipt report |
| Google Drive and Linear | `BLOCKED_EXTERNAL_CONFIGURATION` | Live least-scope OAuth, permission drift, reconciliation, revoke, and provider-version report |
| Production KMS/vault/object store/build chain | `BLOCKED_EXTERNAL_CONFIGURATION` | Key rotation, canary, object retention, signed SBOM/provenance, image scan, patch evidence |
| Production broker/Temporal/database/region | `BLOCKED_EXTERNAL_CONFIGURATION` | Load/soak, failover, restore RPO/RTO, partial outage, queue fairness and alert evidence |
| Protected payment view / PCI / legal | `REQUIRES_HUMAN_REVIEW` | Scope decision and production capture-suppression evidence; actual unattended payment remains disabled |
| Accessibility and comprehension | `REQUIRES_HUMAN_REVIEW` | Screen-reader/browser matrix and multi-participant actor/destination/consequence/scope results |
| Product and operations launch choices | `REQUIRES_PRODUCT_OWNER_DECISION` | Regions, retention, classifications, thresholds, beta cohort, provider set, signed beta decision |

## Section 15 state

Local criteria 1, 2, 6, 8, 9, 10, 12, and 13 have deterministic passing evidence. Criteria 3–5, 7, 11, and 14 require live or production-like external qualification. Criterion 15 requires independent review and penetration evidence. A local pass is never promoted to live provider or GA assurance.

## Release decision

`assertV2ReleaseReady` intentionally throws with the current evidence set. Relay V2 must not be labeled limited-beta-ready or GA-ready yet. Main review/force-push/deletion protection and V2 tag immutability are now `PASSED_LIVE`; required CI checks and deployment-environment enforcement remain `BLOCKED_EXTERNAL_CONFIGURATION`. Independent security-owner review of WO-02 remains `REQUIRES_HUMAN_REVIEW`. These statuses do not invalidate locally completed WorkOrders, but the incomplete gates remain mandatory WO-22 release blockers.

## 2026-09-13 external qualification campaign

The complete current matrix, execution ownership and exact closure evidence are in [`wo22-gate-matrix.md`](./wo22-gate-matrix.md).

### Live execution and computer evidence

- `PASSED_LIVE` — Relay-managed conservative execution profile. With Docker and Chromium enabled, `tests/v2/relay-managed-provider-live.test.ts` and `tests/v2/relay-managed-provider.test.ts` passed 6/6. The combined ephemeral browser/shell/file lifecycle completed in 2.156 seconds and exercised provisioning, execution, evidence, cleanup and tenant-bound contracts.
- This pass applies only to the registered/internal/ephemeral Relay-managed profile. It does not qualify persistent profiles, restricted/high-assurance workloads or permanent desktop fleets.
- `BLOCKED_EXTERNAL_CONFIGURATION` — Browserbase and E2B had no V2 provider credentials/bindings.
- `BLOCKED_EXTERNAL_CONFIGURATION` — no customer runner host, mTLS enrollment, attestation service, outbound-only network capture or runner daemon was available. The deterministic runner contract remains `PASSED_AUTOMATED`, not live.

### Live channels and connectors

- Slack: `BLOCKED_EXTERNAL_CONFIGURATION`; no dedicated V2 app/workspace credentials or consent.
- Telegram: `BLOCKED_EXTERNAL_CONFIGURATION`; no dedicated V2 bot/test-chat credentials.
- Google Drive: `BLOCKED_EXTERNAL_CONFIGURATION`; no V2 credential-broker/OAuth binding. Frozen V1 Google credentials were not reused.
- Linear: `BLOCKED_EXTERNAL_CONFIGURATION`; no V2 OAuth app/workspace credentials.

The exact browser/Cowork setup actions are recorded in the matrix. No additional scopes were requested and no mock result was promoted to live.

### Trusted-action, event, provenance and revocation evidence

- `PASSED_AUTOMATED` — focused leases, orchestration, approvals, money and evidence qualification passed 33/33 across 5 files.
- The trusted-action chain persists and relates the initiating V2 event/task, Agent and signed Passport, runtime client, capability/action hash, policy decision and bundle hashes, exact signed once approval, transactional purchase-budget reservation, workload and bounded control lease, provider placement and fenced computer session, protected human effect/result, redacted receipt/settlement and signed account audit chain.
- Negative coverage rejects wrong tenant/audience/workload/resource, bootstrap replay, call exhaustion, expired and revoked authority, offline financial authority, approval mutation/staleness/wrong approver/expiry, budget contention, repeated ambiguous effects and merchant/currency/amount substitution.
- `PASSED_AUTOMATED` — transactional outbox, duplicate/reordered ingress, single-winner task claims, stale fencing, poison/DLQ replay, publisher failure and post-possible-effect worker death converge without duplicate consequential retry.
- `BLOCKED_EXTERNAL_CONFIGURATION` — no deployed Temporal topology existed; deterministic/local orchestration evidence is not represented as live Temporal evidence.

### Topology and recovery truth

The available topology was a single local host with Relay/Next, PostgreSQL 14.18, in-process policy evaluation, deterministic adapters and local Docker/Chromium. No Temporal service, separate workers, production object store, KMS/vault, distributed telemetry, customer runner or production provider adapter was present. Therefore production-topology qualification remains `BLOCKED_EXTERNAL_CONFIGURATION`.

- `PASSED_LIVE` — a disposable PostgreSQL backup/restore drill restored `relay_e2e_wo22_restore` into an isolated database. Source and restored data-only dumps had identical SHA-256 `ed2f34b16c077cfc20e206040120eb0d6301ab22162ae59a6acc25814dace404`; restored counts were 1 account, 2 agents and 21 migrations. Both disposable databases were removed.
- `PASSED_AUTOMATED` — worker pre/post-effect failure, provider failure, lease/runner/credential/approval revocation, budget recovery, event replay and evidence-tamper behavior.
- `BLOCKED_EXTERNAL_CONFIGURATION` — production database failover/RPO/RTO, Temporal restart, encrypted object restore, production provider outage/recovery and regional recovery.

### Accessibility finding and focused correction

The fresh pre-fix axe run found one moderate `landmark-unique` violation on `/v2` and no current navigation marker on `/v2/settings`. The focused correction names the sidebar complementary landmark and adds Settings to the current-route navigation. Regression coverage was added to `tests/v2/dashboard.test.ts`.

Post-fix evidence:

- dashboard regression 2/2, typecheck and lint: `PASSED_AUTOMATED`;
- axe-core 4.13 on all ten V2 routes: zero violations;
- every route had exactly one `h1`, one `main`, one `nav`, one current-route marker and zero unnamed buttons;
- first Tab on Approval focused “Skip to content”; final browser console had zero errors/warnings.

Focused defect commit: `a7ed00f`. Qualification evidence commit: `6b72301`.

Human screen-reader/platform and multi-participant actor/destination/consequence/scope studies remain `REQUIRES_HUMAN_REVIEW`. See [`wo22-accessibility-comprehension-protocol.md`](./wo22-accessibility-comprehension-protocol.md).

### Security, penetration and governance

- WO-02 independent security-owner review: `REQUIRES_HUMAN_REVIEW`. Review package: [`wo02-independent-security-review-package.md`](./wo02-independent-security-review-package.md).
- Independent penetration test: `REQUIRES_HUMAN_REVIEW`. Checklist: [`wo22-penetration-test-checklist.md`](./wo22-penetration-test-checklist.md).
- GitHub API inspection of `jaydubya818/relay`: `FAILED`. `main` returned “Branch not protected,” repository rulesets were empty, environments were empty, and no tag/release protection was found.
- Historical transition: remote protections changed from `BLOCKED_EXTERNAL_CONFIGURATION` (not inspectable/qualified) to `FAILED` (authenticated inspection proved controls absent). No governance setting was changed.
- Required authorized change: protect `main`; require pull-request review and named CI checks; block force push/deletion; add tag/release rules; create a protected deployment environment with V2-only secrets and required reviewers.

#### Release-governance hardening transition

Authenticated repository-admin authorization was available and the release-hardening task explicitly authorized minimum governance changes. The following settings were applied and read back:

- `PASSED_LIVE` — `main` is protected and requires a pull request with one approving review.
- `PASSED_LIVE` — stale approvals are dismissed, the most recent pusher cannot approve, all conversations must be resolved, and rules apply to administrators.
- `PASSED_LIVE` — force pushes and branch deletion are disabled.
- `PASSED_LIVE` — repository ruleset `23264220`, “Relay V2 release tags,” is active for only `refs/tags/relay-v2.*`; deletion and non-fast-forward updates are prohibited and no bypass actor exists.
- `BLOCKED_EXTERNAL_CONFIGURATION` — required status checks and “branch must be up to date” cannot be configured truthfully. The repository contains no GitHub workflow, the `main` commit has no check runs and no status contexts, and no check name was invented.
- `BLOCKED_EXTERNAL_CONFIGURATION` — deployment-environment protection. The repository has no environment or deployment pipeline, so no placeholder environment or secret scope was invented.

Code-owner review is not required because no `CODEOWNERS` file exists. Signed commits are not required because no established signing/verification workflow exists. Existing merge methods—merge commit, squash, and rebase—remain enabled; constraining merge style is not necessary for the minimum review/immutability policy and was not changed. Auto-merge remains disabled.

Historical transition: branch/tag/deployment governance was `FAILED` before hardening. Branch review/admin/force-push/deletion and V2 tag controls transitioned to `PASSED_LIVE`; checks and deployment environments transitioned to the narrower truthful `BLOCKED_EXTERNAL_CONFIGURATION`.

### Release recommendation

Engineering-controlled local and Relay-managed qualification is green after the focused accessibility correction, but the release is `NOT_READY_FOR_LIMITED_BETA`: required CI checks and deployment-environment enforcement are not available; independent security, penetration, accessibility/comprehension and payment-scope reviews are incomplete; and the intended live provider/channel/connector/runner and production topology are unqualified.

The Product Owner decision remains `REQUIRES_PRODUCT_OWNER_DECISION`. GA remains `BLOCKED_EXTERNAL_QUALIFICATION`. No tag, merge, V1 change, V2.1 work or V3 work was performed.

## 2026-09-13 Browserbase and E2B qualification campaign

Scope was limited to the existing Browserbase/E2B provider-neutral architecture and the Relay-managed comparator. No other WO-22 gate was changed.

### Contract reconciliation

Both adapters implement the common `ExecutionProviderAdapter` lifecycle: health, quote, prepare, control, observe, evidence, meters, terminate and reconcile. The scheduler requires an active same-account task, Agent Passport, policy-bound unexpired capability lease, signed provider manifest, allowed provider/region/isolation/persistence/classification, and a healthy closed circuit before placement. Provider dispatch is account/task/action/lease bound and recorded in the audit chain.

Browserbase `browserbase@1.0` claims only registered-assurance ephemeral process isolation for public/internal visual-browser and live-observation work. It supports navigation, bounded input, extraction through browser operations, screenshots, live/replay metadata, six-hour maximum TTL, explicit termination, tombstoned cleanup and computer-second metering. It does not claim persistence, pause/resume, shell/files, private network, human takeover, secret injection, idempotent upstream create or provider-signed evidence.

E2B `e2b@1.0` claims only registered-assurance ephemeral microVM isolation for public/internal shell/files and beta pause/resume. It enforces workspace-rooted paths, 1 MiB file bounds, 10,000-character commands, 30-second command timeout, 24-hour maximum TTL, explicit kill, tombstoned cleanup and compute-second metering. It does not claim a visual browser, persistent computer, private/network-policy enforcement, human takeover, secret injection, idempotent upstream create or provider-signed evidence. CPU/memory selection is a template concern and is not projected by the current Relay adapter contract.

Policy/approval/budget remain authoritative control-plane inputs. Neither provider adapter can widen them. Credential handles are rejected because no qualified secret-broker path exists for these providers, and provider API keys are supplied only by the server-side credential source.

### Configuration inspection

Only configuration presence was inspected; no secret value was printed.

| Provider setting | State |
|---|---|
| `BROWSERBASE_API_KEY` | MISSING |
| Browserbase project binding | MISSING |
| Browserbase account/session-limit evidence | MISSING |
| `E2B_API_KEY` | MISSING |
| E2B team/workspace binding | MISSING |
| E2B approved template binding | MISSING |

The repository contains the adapters and mock conformance clients, but no concrete live Browserbase/E2B HTTP/SDK client binding or opt-in live qualification test. Adding such a binding was not attempted because this mission prohibited features and credentials are absent.

### Executed evidence and status

- `PASSED_AUTOMATED` — 28/28 tests across `execution-providers.test.ts`, `third-party-providers.test.ts`, `relay-managed-provider.test.ts` and the Relay-managed live comparator.
- `PASSED_LIVE` — Relay-managed comparator completed a real combined browser/shell/file lifecycle in 3.414 seconds and cleaned up.
- `PASSED_AUTOMATED` — Browserbase/E2B common manifest substitution, account/session binding, unsupported-capability denial, secret-handle rejection, kill switch, termination, evidence redaction, 429 pre-effect classification, 5xx/timeout ambiguous classification, scheduler hard filtering, signed-manifest integrity, circuit opening, no failover after possible effect, account isolation and concurrent-dispatch fencing.
- Browserbase: `BLOCKED_EXTERNAL_CONFIGURATION`. No live session, navigation, screenshot, cookie/storage isolation, TTL, close, cleanup, evidence or latency claim was made.
- E2B: `BLOCKED_EXTERNAL_CONFIGURATION`. No live sandbox, shell/file, resource, timeout, network, TTL, destruction, cleanup, evidence or latency claim was made.
- Live provider-neutrality across Relay-managed and either third-party provider remains `BLOCKED_EXTERNAL_CONFIGURATION`; only the shared semantics are `PASSED_AUTOMATED`.

No Relay contract incompatibility was established without a live provider. Current upstream documentation still supports Browserbase API-key/session/project/region/timeout semantics; Browserbase project inference is permitted upstream but explicit project recording is required for Relay qualification. E2B documentation shows sandbox lifecycle, shell/files and beta pause, and exposes CPU/memory through template configuration. The repository document pins E2B SDK 2.6.2 while the current official reference also exposes 2.6.3; the live binding must select and record one reviewed version before qualification.

WO-22 remains `BLOCKED_EXTERNAL_QUALIFICATION`; all unrelated blockers and the `NOT_READY_FOR_LIMITED_BETA` recommendation are unchanged.

## 2026-09-14 pre-merge qualification

Fresh pre-merge execution found and corrected two nondeterministic qualification defects in commit `bce7cc6`: evidence redaction could corrupt a canonical identifier containing a Luhn-valid digit run, and a fact observed during resolver execution could be incorrectly newer than a policy decision timestamp captured before resolution. Regression coverage now preserves canonical identifiers while still redacting standalone payment numbers and evaluates freshness against the completed fact set without weakening fail-closed policy outcomes.

Post-fix evidence is green: frontier guard, schema check, typecheck, lint, 172/172 runnable non-live tests, 2/2 performance tests, production build, 6/6 Relay-managed live provider tests, and 3/3 dashboard Playwright E2E tests. These results strengthen local and Relay-managed evidence only. WO-22 remains `BLOCKED_EXTERNAL_QUALIFICATION`, and every previously recorded external configuration, independent review, human study, production topology, and Product Owner gate retains its truthful status.

## 2026-09-18 owner-authenticated preview qualification attempt

Hosted health/readiness and the full automated regression remained green, but normal Vercel Authentication was not completed in the visible qualification browser. The requested hosted Relay login, owner-route, approval, activity, session, accessibility, and screenshot checks therefore remain `REQUIRES_HUMAN_REVIEW`. A temporary Vercel CLI automation bypass created by an operational health probe was immediately revoked with regeneration disabled; read-back reported zero bypass entries and it was not used as owner-login evidence.

The checked-in development-mode Playwright suite passed both functional flows and reproducibly failed its warm-route performance case at 224.909 ms and 222.460 ms p95 against the unchanged `<200 ms` threshold. Dedicated performance tests and the production build passed. No threshold was weakened and no unverified product or harness change was retained.

Detailed evidence: [`owner-authenticated-preview-2026-09-18.md`](./owner-authenticated-preview-2026-09-18.md). Verdict: `OWNER PREVIEW QUALIFICATION INCOMPLETE`. WO-22 remains `BLOCKED_EXTERNAL_QUALIFICATION`; all unrelated external, independent-review, and Product Owner gates are unchanged.

## 2026-09-19 owner-authenticated preview completion

Normal owner authentication completed on final revision `f39288e74c74bc3764457bbc52d8f3961bc47e11`, deployment `dpl_7id7j1jxSmBM4MJh6JaLTKAorTeo`. Login, session persistence, logout/revocation, signup denial, invalid-session rejection, all V2 dashboard routes, inherited owner routes, empty states, console health, keyboard semantics, and the private-preview runtime denial passed live. The tenant remained 1 account, 1 owner, 0 Agents and 0 Agent credentials; no synthetic consequential approval or action was created.

The exact branch initially lacked branch-scoped `RELAY_DEPLOYMENT_MODE`, so the runtime denial returned 500. Only known non-secret safety values were added to the qualification branch; the corrected deployment returns 503 `CAPABILITY_DENIED`. No Vercel secret was exported or protection bypass retained.

Local production performance passed all nine routes with `/` p95 162.102 ms against the unchanged `<200 ms` threshold. The exact protected Vercel preview failed every hosted route; an isolated `/` run measured p50 391.915 ms, p95 520.835 ms and p99 600.829 ms. Classification is `ENVIRONMENT_SPECIFIC_REGRESSION`.

The owner-preview verdict remains `OWNER PREVIEW QUALIFICATION INCOMPLETE`. WO-22 remains `BLOCKED_EXTERNAL_QUALIFICATION`; remote checks/deployment enforcement remains `BLOCKED_EXTERNAL_CONFIGURATION`; independent WO-02 review, penetration evidence, formal accessibility/comprehension, provider/topology evidence and Product Owner release decisions remain open. No V1 net change, V2.1/V3 work, or new connector/provider implementation was retained.

## 2026-09-19 hosted performance root-cause and remediation

The protected-preview performance failure was traced to a cross-region application/database topology: Vercel functions in `sfo1` repeatedly accessed pooled Neon in `us-east-1`. An owner-only private-preview probe measured warm pre-fix p95 of `60.068` ms for a simple query, `125.027` ms for Relay authentication/session work, and `126.977` ms for the V2 dashboard read model. Network and Vercel-protection controls were materially smaller.

Commit `ee3a5e3` aligned Vercel functions to `iad1`. An authenticated protected comparison preview then measured warm p95 of `9.679` ms for a simple query, `9.320` ms for authentication/session work, and `12.231` ms for the dashboard read model. Two independent warm `/` distributions passed the unchanged `<200 ms` contract at p95 `147.6` and `169.4` ms; the first cold/transient p95 `235.1` ms remains separately recorded. Final local production `/` passed at p50/p95/p99 `113.529 / 125.374 / 133.413` ms.

The final automatic deployment is Ready with all functions verified in `iad1`, but Vercel Security Checkpoint Code 21 prevented an exact-final normal-auth browser rerun. No bypass was used. Performance is `PASS` for the established warm authenticated-request contract; owner preview remains `OWNER PREVIEW QUALIFICATION INCOMPLETE` pending the exact-final browser recheck. Full evidence is in [`hosted-performance-2026-09-19.md`](./hosted-performance-2026-09-19.md).

This does not close WO-22. Its status remains `BLOCKED_EXTERNAL_QUALIFICATION`; remote CI/deployment enforcement remains `BLOCKED_EXTERNAL_CONFIGURATION`; independent WO-02 review, penetration evidence, formal accessibility/comprehension, provider/topology evidence, and Product Owner release decisions remain open.
