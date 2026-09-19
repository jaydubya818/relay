# Relay V2 hosted performance root-cause and remediation — 2026-09-19

Status: `PASSED_WITH_EXACT_DEPLOYMENT_RECHECK_BLOCKED`

Performance verdict: `PASS`

Owner-preview verdict: `OWNER PREVIEW QUALIFICATION INCOMPLETE`

This record is limited to the hosted performance investigation. It does not qualify WO-22, authorize a release, start Telegram or V2.1/V3 work, or change V1.

## Qualified source and deployments

- Evidence branch: `codex/relay-owner-preview-qualification`.
- Investigation baseline: `8d6ee6dd0602d002b6c6fefcb3f73c4e09209d65`.
- Instrumentation commits: `f7b5daa` and `122d603`.
- Durable topology correction: `ee3a5e3` (`fix(platform): align Vercel with Neon region`).
- Pre-fix protected preview: `dpl_EjtNHm5q5a3r9DCakqsv3gR3c3wA`, Vercel `sfo1`.
- Post-fix comparison preview: `dpl_n8Qhw41kvSvbrmRfQjBLmvX5ZKAz`, deployed normally with the application at `122d603` and Vercel `iad1` selected explicitly.
- Final durable-config preview: `dpl_9pNSqSUQptf5armoorvys7pTzvjW`, `Ready`, with all functions verified in `iad1` and the canonical branch alias assigned to it.
- No deployment-protection bypass was used or retained.

## Metric semantics

The existing acceptance contract in `dashboard-performance-contract.md` and `tests/e2e/dashboard-performance.spec.ts` measures authenticated application-request duration from Playwright's HTTP client to completion of the response. It uses one warm-up followed by 20 sequential samples for each protected dashboard route and requires every route's warm p95 to be below 200 ms.

It is not a server-only metric and it is not complete browser navigation, DOMContentLoaded, load, hydration, or time-to-interactive. The contract is sufficiently explicit; no re-contract or threshold change was made.

## Baseline decomposition

All distributions below use p50/p95/p99 in milliseconds.

### Qualification-client network and protection floor

- Protected `/` without a Vercel session, returning the protection redirect: TTFB `82.020 / 96.725 / 96.923`; total `82.121 / 96.815 / 97.025`.
- Protected `/api/health` without a Vercel session: TTFB `80.228 / 100.541 / 134.389`; total `80.318 / 100.646 / 134.473`.
- Public Vercel static control: TTFB `89.540 / 117.931 / 162.516`; total `89.713 / 119.354 / 164.824`.
- Authenticated protected Relay static asset in the `sfo1` preview: TTFB `22.8 / 32.4 / 40.5`; total `22.9 / 32.5 / 40.7`.

The protection/network floor is material but cannot explain 300–500 ms warm application responses. Normal authenticated asset delivery is approximately 20–40 ms from this client.

### Pre-fix `sfo1` hosted application

The owner-only qualification endpoint measured non-sensitive stages from the actual hosted process. Its first invocation was cold/new-connection behavior:

- Relay authentication/session path: `529.267`.
- Simple Neon query: `59.945`.
- V2 dashboard read model: `485.212`.
- Total instrumented application work: `1074.535`.

Twenty sequential warm samples then measured:

- Authentication/session: `121.709 / 125.027 / 126.959`.
- Simple query: `59.601 / 60.068 / 61.290`.
- Dashboard read model: `124.132 / 126.977 / 128.048`.

Authenticated protected browser fetches measured:

- `/`: TTFB `300.7 / 470.0 / 977.9`; total response `301.8 / 470.3 / 978.2`.
- `/v2`: TTFB `298.4 / 331.6 / 975.4`; total response `298.7 / 331.9 / 977.4`.
- `/api/health`: TTFB `104.2 / 115.8 / 166.4`; total response `104.5 / 116.0 / 166.7`.

The previously recorded isolated protected `/` failure remains historical evidence: total `391.915 / 520.835 / 600.829`.

## Data path findings

- Vercel functions ran in `sfo1`; the Neon pooled endpoint ran in `us-east-1`. Every database-dependent request crossed regions.
- Relay uses a reusable `pg.Pool` with a maximum of ten connections per process.
- Session validation performs a session/user/account lookup followed by a last-seen update, so cross-region latency was paid sequentially during authentication.
- The page and dashboard layout each enforce authentication. V2 then issues 17 independent dashboard projections concurrently; the ten-connection pool can require a second query wave.
- No dashboard N+1 pattern was found. The read-model queries are already parallelized.
- Cold process/connection establishment amplified the mismatch but was not the warm-latency root cause.

## Root-cause classification

- Dominant: `DATABASE_TOPOLOGY` — measured warm simple-query p95 was 60.068 ms from `sfo1` and 9.679 ms from `iad1` against the same `us-east-1` Neon service.
- Secondary: `DATABASE_CONNECTION` and `COLD_START` — first-call authentication fell from 529.267 ms to 69.242 ms after alignment, while warm authentication was substantially lower in both cases.
- Amplifier: `AUTHENTICATION` — the secure session path performs multiple database operations; these became expensive only when each operation crossed regions.
- Smaller floor: `NETWORK` and `VERCEL_PROTECTION` — controls measured roughly 20–135 ms depending on authentication state and endpoint.
- Overall: `MULTIPLE_CAUSES`, with region mismatch as the evidence-backed cause under Relay's control.

## Correction

`vercel.json` now selects `iad1`, aligning Relay's serverless functions with the `us-east-1` Neon database. No authentication, authorization, query, isolation, data-retention, provider, or acceptance behavior changed. No speculative query caching or security-check removal was introduced.

The owner-only performance endpoint is available only in the private-preview deployment mode, returns 404 elsewhere, requires the authenticated owner, returns no secrets or owner identifiers, and emits `Server-Timing` plus bounded topology/pool metadata.

## Post-fix hosted evidence

The first instrumented `iad1` invocation measured:

- Authentication/session: `69.242`.
- Simple query: `2.429`.
- Dashboard read model: `91.720`.
- Total instrumented application work: `163.483`.

Twenty warm sequential internal samples measured:

- Authentication/session: `6.800 / 9.320 / 17.222`.
- Simple query: `2.214 / 9.679 / 10.807`.
- Dashboard read model: `9.242 / 12.231 / 31.657`.

Authenticated protected browser-fetch response timing measured:

- `/v2`: TTFB `128.1 / 155.1 / 173.0`; total `129.8 / 155.3 / 173.6`.
- `/`, first post-deploy distribution including cold/transient samples: TTFB `138.3 / 233.7 / 322.6`; total `142.8 / 235.1 / 326.8`.
- `/`, isolated warm repeat 1: total `132.1 / 147.6 / 158.3`.
- `/`, isolated warm repeat 2: total `133.6 / 169.4 / 175.1`.
- `/api/health`: TTFB `110.4 / 128.7 / 147.5`; total `110.7 / 128.7 / 147.6`.
- Authenticated static control: TTFB `24.1 / 35.4 / 36.4`; total `40.4 / 50.8 / 55.1`.

The first cold/transient `/` distribution is preserved and exceeds the warm contract. Both subsequent 20-sample warm distributions satisfy the unchanged p95 below 200 ms requirement. Cold-start behavior remains separately visible and is not represented as warm acceptance evidence.

Browser TTFB and response completion were measured. Complete browser navigation, DOMContentLoaded, load, hydration, and interactive timing could not be validly remeasured: Vercel began returning Security Checkpoint Code 21 after the automated sample volume. A navigation that rendered the checkpoint was rejected as Relay evidence.

The final automatic deployment contains the same `iad1` topology as the passing comparison and was verified `Ready` with all functions in `iad1`. A fresh normal-auth browser session was also checkpointed, so the exact final deployment was not re-sampled. No bypass was attempted. This is an external qualification limitation, not a performance-contract change.

## Post-fix local evidence

The final local production-mode Playwright route gate used the unchanged contract and passed 1/1. `/` measured `113.529 / 125.374 / 133.413`; the other eight protected routes had p95 values between 4.465 and 7.272 ms.

Regression qualification on the final source state:

- Typecheck: passed.
- Lint: passed.
- Serial CI: 43 files passed, 3 opt-in live-provider files skipped; 184 tests passed, 5 skipped.
- Dedicated performance: 2/2 passed.
- Functional Playwright owner flows: 2/2 passed.
- Production-mode Playwright performance: 1/1 passed.
- Production build: passed and emitted the expected application/API routes, including the private-preview qualification route.

## Verdict and remaining boundaries

Performance verdict: `PASS`. An authenticated, protected, post-fix `iad1` preview satisfied the currently defined warm request p95 contract in two independent 20-sample repetitions, and the measured stage timings establish region alignment as the cause of the improvement. The threshold remains p95 below 200 ms.

Owner-preview verdict: `OWNER PREVIEW QUALIFICATION INCOMPLETE`. The final exact deployment is correctly configured and Ready, but Vercel's external Security Checkpoint prevented the required final normal-auth browser recheck and complete-navigation capture. The prior owner-login, route, denial, logout, accessibility-smoke, and data-integrity evidence remains valid but is not silently promoted to an exact-final-deployment run.

WO-22 remains `BLOCKED_EXTERNAL_QUALIFICATION`. Remote CI/deployment enforcement remains `BLOCKED_EXTERNAL_CONFIGURATION`; independent WO-02 security-owner review, formal accessibility/comprehension, and all other previously recorded external gates remain open. No V1, Telegram, V2.1, or V3 work was performed.
