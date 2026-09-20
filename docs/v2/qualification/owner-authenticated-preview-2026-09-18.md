# Relay V2 owner-authenticated preview qualification — 2026-09-18

Status: `OWNER_PREVIEW_QUALIFIED`

Verdict: `OWNER PREVIEW QUALIFIED`

This record covers qualification only. It does not authorize Telegram, Browserbase/E2B, connector expansion, V2.1/V3 work, or any V1 change.

The 2026-09-18 incomplete attempt and 2026-09-19 checkpoint limitation are preserved below as historical evidence. The 2026-09-20 exact-final record at the end is authoritative for the current branch and deployment.

## 1. Branch, revision, and isolation

- Qualified source: `origin/main` at `2a2bf372477165d5fed8a9430d90558df4358da3`.
- Qualification branch: `codex/relay-owner-preview-qualification` in disposable clone `/private/tmp/relay-v2-owner-qualification`.
- The source checkout remained on the V1 soak branch and was not switched or edited by this work.
- V2 qualification changes, if any, are confined to the disposable clone.

## 2. Environment

- Host: macOS arm64, America/Los_Angeles.
- Node.js: `24.18.1`.
- pnpm: `9.0.0`.
- Disposable PostgreSQL: Homebrew PostgreSQL `14.18`, loopback-only on port `55432`, trust authentication, test databases created and removed by the repository helpers.
- Hosted preview: Vercel project `prj_3IRvr9knK5VJcBTgTYMvhv6ixmJK`, deployment `dpl_7x9ZSboMfDB3NkauRGoDfcvLUddz`, production alias `https://relay-jaydubya818.vercel.app`, reported `Ready`.
- Hosted datastore inventory: 21 migrations; 1 account; 1 user; 1 human principal; 1 active owner membership; 0 Agents.
- Federation surfaces remain absent/disabled by design.
- Runtime actions remain explicitly disabled and signup remains explicitly disabled for the private-preview profile.

## 3. Baseline and operational checks

- `PASSED_LIVE` — protected operational health returned HTTP 200 with database `ready`.
- `PASSED_LIVE` — protected readiness returned HTTP 200 with database, migrations, and events `ready`.
- The Vercel CLI created an automation-bypass token while performing the protected health probe. The token was immediately revoked through the documented project protection API with regeneration disabled. Read-back reported zero automation-bypass entries and no project-specific local token-cache file. No bypass remains and deployment protection was not weakened.
- `PASSED_AUTOMATED` — Drizzle schema check completed against the hosted schema.
- A persistent worker is not required for the actions-disabled owner preview. No execution claim is made.

The protected health/readiness probe is operational evidence only. It is not owner-login or owner-UI evidence.

## 4. Owner login and protected routes

- `PASSED_LIVE` — an unauthenticated real browser requesting Relay `/login` was redirected to the Vercel Authentication login page.
- `REQUIRES_HUMAN_REVIEW` — the Product Owner did not complete Vercel Authentication in the visible qualification browser during this run.
- Relay login rendering, valid owner login, application session creation, authenticated navigation persistence, logout, invalid/expired application session behavior, and post-logout route rejection were therefore not qualified live.
- Non-secret screenshot captured locally at `output/playwright/owner-preview-qualification/vercel-authentication-required.png`.

No database/session manipulation and no retained deployment bypass were used to claim owner authentication.

## 5. Signup denial

- `PASSED_AUTOMATED` — the hosted deployment contract sets `RELAY_ALLOW_SIGNUP=false`; application registration denies when signup is disabled.
- `PASSED_AUTOMATED` — authentication coverage rejects duplicate ownership and verifies account/session isolation.
- Pre-attempt hosted inventory remains 1 account, 1 user, 1 principal, 1 membership, 0 Agents, and 0 active unexpired sessions.
- `REQUIRES_HUMAN_REVIEW` — an unauthenticated signup attempt through the protected hosted UI could not be performed before Vercel Authentication. No live side-effect claim is made.

## 6. Runtime-action denial and error states

- `PASSED_AUTOMATED` — private-preview runtime actions are unconditionally denied by the deployment guard.
- `PASSED_AUTOMATED` — the focused policy, approval, lease, budget, runner, provider, orchestration, connector, communication, and release suites cover missing/revoked/expired authority, missing approval, budget contention, unavailable/disabled providers, invalid tenant/resource bindings, idempotency, dead letters, and ambiguous effects.
- `REQUIRES_HUMAN_REVIEW` — representative denials were not exercised from the hosted owner UI because the Vercel owner gate was not completed.

## 7. Dashboard, approvals, activity, and accessibility

- `PASSED_AUTOMATED` — dashboard read-model and tenant-bound operator tests passed 2/2.
- `PASSED_AUTOMATED` — the existing V2 automated accessibility evidence remains green and includes headings, landmarks, current-route semantics, accessible names, and skip-link coverage across all ten V2 routes.
- `REQUIRES_HUMAN_REVIEW` — hosted Overview, Agents, Passport/capabilities/leases, Approvals, Budgets, Events, Runners, Computers, Browsers, Sandboxes, Communications, Connections, Activity, Developer/Operations, and disabled federation presentation were not inspected in the owner-authenticated browser.
- `REQUIRES_HUMAN_REVIEW` — no hosted consequential approval request or activity/audit correlation was inspected. No external consequential action was performed.
- The outstanding formal human accessibility and approval-comprehension study remains `REQUIRES_HUMAN_REVIEW` and was not reclassified.

## 8. Restart and session behavior

- `PASSED_LIVE` — Vercel health/readiness recovered and the hosted durable owner inventory remained present.
- `REQUIRES_HUMAN_REVIEW` — owner application-session persistence and logout/revocation across hosted navigation were not qualified because Relay login was not reached.
- No deployment restart or redeploy was introduced solely for this qualification.

## 9. Regression evidence

### Focused security and release run

- 5 test files passed.
- 15/15 tests passed: owner authentication, opaque durable session revocation, duplicate-owner rejection, account isolation, V1 boundary preservation, V2 dashboard tenant boundary, and WO-22 aggregate release gate.

### Full repository qualification

- Typecheck: passed.
- Lint: passed.
- CI tests: 41 files passed, 3 opt-in live-provider files skipped; 180 tests passed, 4 skipped.
- Performance tests: 2/2 passed. Dashboard read-model median was 0.640 ms and p95 was 1.041 ms. The modest-concurrency suite completed 64 operations with 0 errors and p95 34.951 ms.
- Production build: passed; 26 static/dynamic page groups generated and all expected V1/V2 application and API routes were emitted.

### Playwright dashboard run

- Functional owner login/navigation/Agent-credential flow: passed.
- New-account/signup/empty-state/logout/session-revocation flow: passed in the isolated local development profile.
- Warm local route target: failed reproducibly on `/`. First p95 was 224.909 ms; isolated rerun p95 was 222.460 ms; threshold remains `<200 ms`.
- The failure is confined to the checked-in Next.js development-mode browser harness. Dedicated read-model performance tests and the production build passed. No threshold was weakened and no unverified harness or product change was retained.

Overall browser result: 2 passed, 1 failed. Classification: `FAILED` for the browser performance gate pending a production-faithful performance harness or a verified performance correction.

## 10. Defects, changes, and commits

- The browser performance gate failure was preserved and reproduced.
- A production-mode local harness experiment did not faithfully reproduce Next.js `__Host-` cookie parsing and was discarded in full.
- No product fix, test-threshold change, or qualification bypass is retained.
- No implementation commit exists from this incomplete qualification.

## 11. Remaining blockers

1. `REQUIRES_HUMAN_REVIEW` — complete normal Vercel Authentication in the visible qualification browser, then run the Relay owner-login, navigation, signup-denial, protected-route, invalid-session, runtime-denial, approvals, activity, accessibility, logout, and screenshot checks.
2. `FAILED` — close or explicitly re-contract the reproducible development-mode Playwright p95 result without weakening the `<200 ms` acceptance threshold.
3. Remote branch/deployment protections retain `BLOCKED_EXTERNAL_CONFIGURATION` for required CI/deployment enforcement not represented by the current setup.
4. Independent security-owner review of WO-02 remains `REQUIRES_HUMAN_REVIEW`.
5. All unrelated WO-22 external provider, topology, managed deletion-protection, penetration, accessibility/comprehension, and release-decision gates retain their previously recorded status.

## 12. Verdict

`OWNER PREVIEW QUALIFICATION INCOMPLETE`

No Telegram implementation may begin from this result.

## 13. 2026-09-19 owner-authenticated completion record

### Exact revision and deployment

- Qualification branch: `codex/relay-owner-preview-qualification`.
- Final application revision: `f39288e74c74bc3764457bbc52d8f3961bc47e11`.
- Final Vercel preview: `dpl_7id7j1jxSmBM4MJh6JaLTKAorTeo`, `Ready`, canonical branch alias `https://relay-git-codex-relay-owner-preview-qualification-jaydubya818.vercel.app`.
- The temporary V1 missing-Agent correction in `5680056` was reverted by `f39288e`; the final diff against `origin/main` contains no V1 application change.
- No V2.1/V3, Telegram, live third-party provider, or connector-expansion work was started.

### Owner authentication and session behavior

- `PASSED_LIVE` — normal Vercel Authentication completed through the owner GitHub account. No deployment-protection bypass was created or retained.
- `PASSED_LIVE` — Relay rendered its own login, accepted the existing owner identity, created a production `__Host-relay_session`, and redirected to the authenticated Overview.
- The owner password was reset only after explicit Product Owner approval because the original credential was unavailable. Exactly one existing owner hash was replaced, one prior active session was revoked, and the replacement was stored as a generic macOS Keychain item without printing it. A read-only verification proved the Keychain value matched the hosted owner hash.
- `PASSED_LIVE` — the authenticated session persisted across reload and all protected route transitions.
- `PASSED_LIVE` — logout revoked the application session; a subsequent `/v2` request redirected to `/login`.
- `PASSED_LIVE` — an explicitly invalid `__Host-relay_session` received HTTP 307 to `/login`.
- `PASSED_LIVE` — `/signup` redirected to `/login` with signup disabled.

### Hosted route and state inspection

- `PASSED_LIVE` — all ten V2 routes rendered with one `main`, one `h1`, the expected current navigation item, and their truthful empty/disabled states: `/v2`, `/v2/agents`, `/v2/approvals`, `/v2/tasks`, `/v2/governance`, `/v2/infrastructure`, `/v2/computers`, `/v2/connections`, `/v2/activity`, and `/v2/settings`.
- `PASSED_LIVE` — the inherited owner routes `/`, `/agents`, `/memory`, `/connections`, `/sandboxes`, `/browsers`, `/events`, `/activity`, `/developer`, and `/settings` rendered without console warnings or errors during the route sweep.
- V2 state remained truthful: zero active work, approvals, Agents, runtime clients, policies, budgets, runners, placements, computers, communication identities, connectors, messages, or audit records.
- Settings preserved `BLOCKED_EXTERNAL_CONFIGURATION` for remote checks/deployment enforcement and the pending independent WO-02 review.
- `NOT_RUN_NO_FIXTURE` — no approval decision or approval/activity correlation was fabricated because the hosted tenant has zero Agents and zero pending approvals. Automated approval, step-up, evidence, isolation, and replay coverage remains green.

### Denial, accessibility, and data-integrity evidence

- `PASSED_LIVE` — after correcting branch-scoped non-secret preview settings, `POST /api/v2/runtime/actions` returned HTTP 503 with `CAPABILITY_DENIED`; no durable runtime credential was used.
- The first live denial attempt returned HTTP 500 because `RELAY_DEPLOYMENT_MODE` was scoped only to a different preview branch. The exact qualification branch now has `RELAY_DEPLOYMENT_MODE=private-preview`, `RELAY_V2_ACTIONS_ENABLED=false`, `RELAY_ALLOW_SIGNUP=false`, and branch-specific public/issuer URLs. No Vercel secret was exported.
- A missing V1 Agent detail route produced a server exception. A candidate fix passed focused tests but was reverted because V1 is frozen. The finding remains evidence only and is not a Relay V2 change.
- `PASSED_LIVE` — keyboard smoke focused `Skip to content` first; the V2 command page had one `main`, one `h1`, `nav[aria-label="Relay V2"]`, one current-page marker, zero unnamed buttons, and zero duplicate IDs.
- Formal screen-reader/platform and multi-participant approval-comprehension work remains `REQUIRES_HUMAN_REVIEW`.
- Post-qualification inventory: 1 account, 1 user, 1 principal, 1 membership, 0 Agents, 0 Agent credentials, 4 total sessions, 0 active sessions at the inventory point, and 4 revoked sessions. The final owner login created a new active session afterward. Signup and denial probes created no account, Agent, or credential.

### Regression and performance evidence

- `PASSED_AUTOMATED` — typecheck, lint, the full serial CI suite, both dedicated performance tests, and the production build completed successfully after the final net code state. The first sandboxed attempt was invalid because local Postgres/network access was denied; the identical unrestricted run passed.
- `PASSED_AUTOMATED` — Playwright functional flows passed 2/2.
- `PASSED_AUTOMATED` — the production-mode Playwright gate passed 1/1 with one warmup and 20 sequential samples per route. Final local production p95 values were: `/` 162.102 ms; `/agents` 6.826 ms; `/memory` 7.438 ms; `/connections` 6.877 ms; `/sandboxes` 8.445 ms; `/browsers` 5.192 ms; `/events` 5.882 ms; `/activity` 5.062 ms; `/developer` 5.982 ms.
- Development-mode `/` remained above target at p50 214.624 ms, p95 223.455 ms, and p99 228.768 ms.
- Hosted final-deployment HTTP timing used `curl time_total`, one warmup, and 20 sequential samples inside each route. The nine routes were sampled concurrently across routes; every hosted p95 exceeded 200 ms. Final p95 values were `/` 807.424 ms, `/agents` 408.495 ms, `/memory` 509.800 ms, `/connections` 575.419 ms, `/sandboxes` 401.398 ms, `/browsers` 700.023 ms, `/events` 543.265 ms, `/activity` 470.807 ms, and `/developer` 536.125 ms.
- A separate, globally isolated `/` run confirmed p50 391.915 ms, p95 520.835 ms, and p99 600.829 ms. The `<200 ms` threshold was not weakened.
- Classification: `ENVIRONMENT_SPECIFIC_REGRESSION`. Local production is green, while the exact protected Vercel preview is not. This is not classified as a development-only contract defect and is not dismissed as insufficient evidence.

### Final status

- Owner login, persistence, logout, signup denial, protected-route denial, runtime-action denial, V2 dashboard routes, empty states, keyboard semantics, console health, and database non-creation checks are `PASSED_LIVE`.
- Approval decision evidence is `NOT_RUN_NO_FIXTURE`; formal accessibility/comprehension remains `REQUIRES_HUMAN_REVIEW`.
- Hosted performance remains `ENVIRONMENT_SPECIFIC_REGRESSION` and blocks the owner-preview acceptance threshold.
- Remote branch/deployment protections remain `BLOCKED_EXTERNAL_CONFIGURATION` exactly as previously recorded. Independent security-owner review of WO-02 remains pending.

Verdict: `OWNER PREVIEW QUALIFICATION INCOMPLETE`.

## 14. 2026-09-19 hosted performance root-cause and remediation

- Preserved the original exact-preview `/` failure of p50 `391.915`, p95 `520.835`, and p99 `600.829` ms.
- Added owner-only, private-preview-only, non-sensitive stage timing and established that Vercel `sfo1` was crossing regions to the pooled Neon database in `us-east-1` on every database-dependent request.
- Warm `sfo1` measurements were: simple query p95 `60.068` ms, Relay authentication/session p95 `125.027` ms, and V2 dashboard read-model p95 `126.977` ms. Protection/network controls were materially smaller and did not explain the application-route regression.
- Corrected only the evidenced topology defect by setting Vercel to `iad1` in commit `ee3a5e3`; no threshold, security check, query, V1 surface, or product scope changed.
- On an authenticated protected `iad1` comparison deployment, the simple-query, authentication/session, and dashboard-read-model p95 values fell to `9.679`, `9.320`, and `12.231` ms. Two isolated warm `/` repetitions measured total-response p95 `147.6` and `169.4` ms and passed the unchanged `<200 ms` target. The initial cold/transient distribution measured p95 `235.1` ms and remains recorded separately.
- The exact final automatic deployment `dpl_9pNSqSUQptf5armoorvys7pTzvjW` is `Ready`, serves the canonical branch alias, and has all functions in `iad1`. Vercel Security Checkpoint Code 21 then blocked both retained and fresh normal-auth browser sessions; no bypass was used. Exact-final-deployment browser navigation and complete-navigation timing therefore remain externally blocked.
- Final local qualification passed typecheck, lint, 184 runnable tests with 5 opt-in live-provider skips, 2/2 dedicated performance tests, the production build, Playwright functional 2/2, and production performance 1/1. Local `/` measured p50 `113.529`, p95 `125.374`, and p99 `133.413` ms.
- Performance verdict: `PASS` for the existing warm authenticated-request contract. Owner-preview verdict remains `OWNER PREVIEW QUALIFICATION INCOMPLETE` until the exact final normal-auth browser recheck is possible.
- Detailed evidence: [`hosted-performance-2026-09-19.md`](./hosted-performance-2026-09-19.md).

WO-22 remains `BLOCKED_EXTERNAL_QUALIFICATION`; remote CI/deployment enforcement remains `BLOCKED_EXTERNAL_CONFIGURATION`; independent WO-02 review and formal accessibility/comprehension remain pending. No V1, Telegram, V2.1, or V3 work was performed.

## 15. 2026-09-20 exact-final owner browser qualification

### Exact source and deployment

- Final application revision: `de727a5` (`fix(v2): focus skip-link target`).
- Exact protected preview: `dpl_8GCcV5W3tW6yUibicAE2xDKBqCoT`, `Ready`, Vercel `iad1`.
- Normal Vercel Authentication completed through the owner's GitHub passkey in the retained visible browser session. No Security Checkpoint remained, and no automation or deployment-protection bypass was created.
- Relay accepted the existing owner identity from the existing macOS Keychain credential without displaying or exporting the password.

### Authenticated application and route sweep

- `PASSED_LIVE` — the browser reached Relay rather than a Vercel checkpoint; `/v2` rendered the authenticated Command surface.
- `PASSED_LIVE` — the Relay session persisted through reload and navigation.
- `PASSED_LIVE` — all ten V2 routes rendered one `main`, one expected `h1`, the labelled `Relay V2` navigation, exactly one correct `aria-current="page"`, zero duplicate IDs, zero unnamed controls, truthful empty states, and no application error: `/v2`, `/v2/agents`, `/v2/approvals`, `/v2/tasks`, `/v2/governance`, `/v2/infrastructure`, `/v2/computers`, `/v2/connections`, `/v2/activity`, and `/v2/settings`.
- `PASSED_LIVE` — inherited owner routes `/`, `/agents`, `/memory`, `/connections`, `/sandboxes`, `/browsers`, `/events`, `/activity`, `/developer`, and `/settings` rendered authenticated content with one `main`, the expected `h1`, zero duplicate IDs, and no application error.
- `PASSED_LIVE` — after clearing third-party login-frame messages, the exact-final Relay route sweep produced no page exceptions or Relay console errors.
- `PASSED_LIVE` — a non-credential runtime-action probe returned HTTP 503 `CAPABILITY_DENIED`: runtime actions remain explicitly disabled and fail closed.
- V2 remained truthfully empty: zero active work, pending approvals, Agents, runtime clients, policies, budgets, runners, placements, computers, communications, connectors, messages, or audit records. Approval execution remains `NOT_RUN_NO_FIXTURE`; no fixture was manufactured.

### Accessibility defect and correction

- The first replay exposed one genuine defect: activating `Skip to content` changed the fragment but left focus on `body` because the existing `main` target was not programmatically focusable.
- Revision `de727a5` adds only `tabIndex={-1}` to the existing `main#v2-content` target and a focused regression assertion. Typecheck, lint, focused dashboard tests 2/2, and production build passed before deployment.
- `PASSED_LIVE` on the exact corrected deployment — first Tab focused `Skip to content`; activation set `#v2-content` and moved focus to `MAIN#v2-content`. The route retained one `main`, one `h1`, labelled navigation, one current-page marker, zero duplicate IDs, and zero unnamed controls.

### Logout, invalid session, and signup denial

- `PASSED_LIVE` — Sign out returned to Relay `/login`; a subsequent protected `/v2` navigation remained on `/login`, proving revocation was enforced.
- `PASSED_LIVE` — an explicitly invalid secure `__Host-relay_session` was denied and redirected to `/login`.
- `PASSED_LIVE` — `/signup` redirected to `/login`. A same-origin signup submission returned HTTP 403 `INVALID_INPUT` with `Account registration is not enabled.` The browser remained unauthenticated and protected `/v2` remained denied; no signup account, Agent, credential, or session was created.

### Final verdict

`OWNER PREVIEW QUALIFIED`

This verdict is limited to the owner-only, actions-disabled private preview. The performance contract and its historical `sfo1` failure and `iad1` pass evidence are unchanged. WO-22 remains `BLOCKED_EXTERNAL_QUALIFICATION`; remote CI/deployment enforcement remains `BLOCKED_EXTERNAL_CONFIGURATION`; independent WO-02 security-owner review and formal accessibility/comprehension remain pending. This does not establish limited-beta readiness and does not authorize Telegram, V2.1, V3, or additional provider work.
