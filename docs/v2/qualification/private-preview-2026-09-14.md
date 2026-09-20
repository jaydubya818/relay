# Relay V2 private-preview qualification evidence — 2026-09-14

## Qualified revision

- Git revision: `6c15d333eb8d8866e5348596be686155ce13bd89` (`main`, merge of PR #3)
- Required GitHub check: `quality`
- Post-merge run: `34883664670` — passed in 3m42s
- Local qualification before merge: 180 non-live tests passed, 4 opt-in live tests skipped, 2 performance tests passed, plus typecheck, lint, frontier guard, schema check, and production build

## Hosted control-plane preview

- Vercel project: `prj_3IRvr9knK5VJcBTgTYMvhv6ixmJK`
- Deployment: `dpl_2UoFkvPznuz5cVy6vq6iCSkQrGeM` — Ready
- Owner URL: `https://relay-jaydubya818.vercel.app`
- Vercel production branch: `main`
- Deployment profile: `private-preview`
- V2 runtime actions: explicitly disabled and unconditionally denied by the private-preview guard
- Signup: disabled
- Vercel Authentication: enabled; the Relay application is not anonymously reachable

The Vercel target is named Production by Vercel, but the Relay application profile remains an owner-only private preview. This is not a limited-beta or production-execution qualification.

## Dedicated database evidence

- Provider resource: Neon integration resource `store_NoIIiEgH5AoDvwL5`
- Baseline before migration: zero public tables
- Migration result: all 21 additive migrations applied successfully
- Owner bootstrap result: created once through `pnpm db:bootstrap-owner`
- Post-bootstrap inventory: 1 account, 1 user, 1 human principal, 1 owner membership, 0 Agents
- V1 credentials, OAuth applications, databases, and deployments were not used

The database acceptance criterion remains open until automated backup/deletion protection is verified and an isolated restore is rehearsed.

## Worker evidence

The production worker image was built successfully. A one-cycle smoke test against the dedicated Neon database completed with zero cleanup errors and then shut down cleanly on `SIGINT`. A persistent hosted worker remains open because the installed Railway CLI is not authenticated.

## Live-flow boundary

The canonical URL returns the Vercel Authentication challenge to an unauthenticated headless browser, confirming the deployment-protection boundary. Relay login, readiness, signup denial, and disabled-action checks still require an authenticated owner browser session or a deliberately provisioned and subsequently revoked automation bypass. No bypass was created and deployment protection was not weakened.

## Truthful remaining status

- Remote branch/deployment protections: `BLOCKED_EXTERNAL_CONFIGURATION` where the WO-22 contract requires controls not represented by the current GitHub branch protection and Vercel owner-preview configuration.
- Independent security-owner review of WO-02: pending.
- Persistent hosted worker: blocked on worker-host authentication/configuration.
- Logical backup/restore rehearsal: passed; managed PITR and deletion protection remain open.
- Owner-authenticated live flow: pending.
- All other external WO-22 gates remain open as recorded in the release dossier and gate matrix.

## 2026-09-18 revalidation

- Revalidated revision: `016007e9f1b2b8917cb66fffe0fc2222fb79195e` (`main`, merge of PR #4).
- Vercel deployment `dpl_9hmvaM7cGnmetyMbThXAGfNvybSh` reports `Ready` for the production target and serves the owner alias `https://relay-jaydubya818.vercel.app`.
- A fresh unauthenticated headless-browser session requesting `/login` was redirected to Vercel's authentication page. This reconfirms that the deployment-protection boundary remains fail closed; it does not qualify Relay's owner-authenticated application flow.
- Neon reports PostgreSQL server version 18.6. The available local `pg_dump` is 14.18 and correctly refused to create a version-incompatible backup. PostgreSQL 17 is also installed but is not a valid PostgreSQL 18 backup client.
- A PostgreSQL 18 client could not be installed because the host's Xcode license is not accepted, and Docker was not running. No backup artifact was created or retained, no production data was mutated, and no restore was claimed.
- Neon's configured plan, point-in-time-restore window, deletion protection, and restore path remain unverified because the Neon CLI requires owner authentication.

### Required follow-up

1. Decide whether to upgrade the Vercel-managed Neon resource to a plan that supports protected branches, then verify the configured PITR window and protection state in an owner-authenticated resource dashboard.
2. Complete the Relay login, readiness, signup-denial, and disabled-action checks in an owner-authenticated browser session without weakening Vercel Authentication.

## 2026-09-18 PostgreSQL 18 recovery rehearsal

- Source operation: read-only PostgreSQL 18 logical backup from the dedicated Neon database.
- Backup format: PostgreSQL custom archive with ownership and ACLs excluded.
- Artifact size: 325,351 bytes.
- Artifact SHA-256: `7f894c9460226b75f63de9141b06dd72a5589dc9e4c2cd5f3bf5cbb50e7f0801`.
- Restore target: isolated disposable `postgres:18` Docker container and fresh `relay_restore` database.
- Restore result: passed with `pg_restore --exit-on-error`.
- Restored inventory: 21 Drizzle migrations, 1 account, 1 user, 1 human principal, 1 owner membership, and 0 Agents.
- Cleanup: verified no `relay-v2-restore-*` containers or `/private/tmp/relay-v2-restore.*` directories remained.
- Production impact: no writes to Neon; no backup artifact or restored data retained.

This qualifies the logical backup and isolated-restore path. The combined managed-database acceptance criterion remains open because the current Free plan cannot provide the required managed deletion protection.

## 2026-09-18 managed database control inspection

- Authenticated Vercel storage metadata confirms `store_NoIIiEgH5AoDvwL5` is the owned, active Neon resource `neon-cerise-car`, connected only to the Relay project.
- Vercel reports billing plan `free_v3` (`Free`) with no payment method required.
- Neon documents Free-plan Instant Restores as up to six hours or 1 GB of changes, whichever is smaller: <https://neon.com/blog/new-usage-based-pricing>.
- Neon documents protected branches, which prevent branch reset/deletion and project deletion, as a Scale-plan feature: <https://neon.com/blog/restrict-access-to-the-production-branch>.
- The direct Neon OAuth account does not own the Vercel Marketplace resource; its organization contains no projects. The authoritative resource dashboard is reached through Vercel Marketplace SSO.
- Vercel Marketplace SSO requires an authenticated Vercel browser cookie. It rejected both an isolated unauthenticated browser and an origin-scoped Vercel CLI bearer token, so the configured resource-level history window cannot be independently read from the automation session.

The current Free resource cannot satisfy the deletion-protection portion of the acceptance criterion. That criterion remains open and is now explicitly `BLOCKED_EXTERNAL_CONFIGURATION`; upgrading or purchasing a paid Neon plan requires Product Owner approval. The successful logical restore rehearsal remains valid independent evidence and is not a substitute for managed deletion protection.

## 2026-09-18 Product Owner plan decision

The Product Owner decided to remain on Neon Free for the owner-only, actions-disabled private preview. No billing or plan change was made. Managed deletion protection remains `BLOCKED_EXTERNAL_CONFIGURATION`, and the combined database acceptance criterion must stay open. Before Relay stores real customer data, enables real-world actions, or advances beyond private preview, the database plan and deletion-protection gate must be reconsidered and qualified.

## 2026-09-18 owner-authenticated preview qualification

The owner-authenticated qualification remains `REQUIRES_HUMAN_REVIEW` because normal Vercel Authentication was not completed in the visible qualification browser. Operational health/readiness passed and the temporary CLI-created automation bypass was immediately revoked with zero bypass entries on read-back; those checks are not owner-login evidence. Automated qualification remained green, while the checked-in development-mode Playwright browser performance case reproducibly missed its `<200 ms` p95 target. No threshold was weakened and no unverified fix was retained.

Full evidence and the exact remaining browser steps are recorded in [`owner-authenticated-preview-2026-09-18.md`](./owner-authenticated-preview-2026-09-18.md). Verdict: `OWNER PREVIEW QUALIFICATION INCOMPLETE`.

## 2026-09-19 owner-authenticated completion

- Normal Vercel Authentication and Relay owner login completed on `codex/relay-owner-preview-qualification` without a deployment bypass.
- Final application revision `f39288e74c74bc3764457bbc52d8f3961bc47e11` is deployed as `dpl_7id7j1jxSmBM4MJh6JaLTKAorTeo` and serves the qualification branch alias.
- Login, reload persistence, logout/revocation, signup denial, invalid-session redirect, all ten V2 routes, inherited owner routes, empty states, console health, and keyboard/semantic smoke passed live.
- Runtime actions fail closed with HTTP 503 `CAPABILITY_DENIED`. Five non-secret safety settings were added only to this qualification branch after the first denial probe exposed missing branch scope. No stored Vercel secret was exported.
- Hosted state remained 1 account, 1 user, 1 principal, 1 membership, 0 Agents, and 0 Agent credentials. No synthetic approval, Agent, credential, or action fixture was created.
- Local production performance passed the unchanged `<200 ms` p95 gate on all nine routes; `/` p95 was 162.102 ms. The exact protected Vercel preview failed: isolated `/` p95 was 520.835 ms. Classification is `ENVIRONMENT_SPECIFIC_REGRESSION`.
- A missing V1 Agent detail route was observed to crash. A candidate correction was reverted in full because V1 is frozen; the final branch has no V1 application diff.
- Verdict remains `OWNER PREVIEW QUALIFICATION INCOMPLETE` because hosted performance misses the acceptance threshold. Remote branch/deployment enforcement remains `BLOCKED_EXTERNAL_CONFIGURATION`; independent WO-02 security-owner review and formal accessibility/comprehension remain pending.

Detailed evidence: [`owner-authenticated-preview-2026-09-18.md`](./owner-authenticated-preview-2026-09-18.md).

## 2026-09-19 hosted performance remediation

Stage timing proved that the protected preview's dominant latency was the Vercel `sfo1` to Neon `us-east-1` database path, amplified by session validation, pool waves, and cold connections. The smallest correction aligned Vercel with the database in `iad1` (`ee3a5e3`). On an authenticated protected post-fix preview, two independent warm `/` runs passed the unchanged `<200 ms` contract at p95 `147.6` and `169.4` ms; the initial cold/transient p95 `235.1` ms is preserved separately. Final local production `/` measured p50 `113.529`, p95 `125.374`, and p99 `133.413` ms.

The exact final preview `dpl_9pNSqSUQptf5armoorvys7pTzvjW` is Ready and verified in `iad1`, but Vercel Security Checkpoint Code 21 prevented the exact-final normal-auth browser rerun after the measurement volume. No bypass was used. Performance is `PASS` for the defined warm authenticated-request metric; owner preview remains `OWNER PREVIEW QUALIFICATION INCOMPLETE` pending that exact-final browser recheck. See [`hosted-performance-2026-09-19.md`](./hosted-performance-2026-09-19.md).

WO-22 and all unrelated external gates remain unchanged. No V1, Telegram, V2.1, or V3 work was performed.

## 2026-09-20 exact-final owner-browser completion

Normal Vercel Authentication completed through the owner's GitHub passkey in the retained visible browser; no checkpoint or bypass remained. Relay owner login then succeeded on exact application revision `de727a5`, protected deployment `dpl_8GCcV5W3tW6yUibicAE2xDKBqCoT`, Ready in `iad1`.

All ten V2 routes and all ten inherited owner routes rendered their expected authenticated and truthful empty states without Relay page or console errors. The session survived reload and navigation; runtime actions returned HTTP 503 `CAPABILITY_DENIED`; approvals remain `NOT_RUN_NO_FIXTURE`.

The replay found and corrected one focused accessibility defect: the skip-link fragment target was not focusable. The corrected exact deployment moves keyboard focus from `Skip to content` to `MAIN#v2-content` and retains one main/h1, labelled/current navigation, zero duplicate IDs, and zero unnamed controls. Typecheck, lint, focused dashboard tests 2/2, and production build passed.

Logout revoked the Relay session; protected navigation returned to `/login`; an invalid `__Host-relay_session` was denied; `/signup` remained unavailable; and the signup endpoint returned HTTP 403 before creating an account or session.

Verdict: `OWNER PREVIEW QUALIFIED`. WO-22 remains `BLOCKED_EXTERNAL_QUALIFICATION`; remote CI/deployment enforcement remains `BLOCKED_EXTERNAL_CONFIGURATION`; independent WO-02 review and formal accessibility/comprehension remain pending. Limited-beta readiness is unchanged.
