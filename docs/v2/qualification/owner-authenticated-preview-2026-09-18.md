# Relay V2 owner-authenticated preview qualification — 2026-09-18

Status: `REQUIRES_HUMAN_REVIEW`

Verdict: `OWNER PREVIEW QUALIFICATION INCOMPLETE`

This record covers qualification only. It does not authorize Telegram, Browserbase/E2B, connector expansion, V2.1/V3 work, or any V1 change.

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
