---
status: ready
priority: p1
issue_id: "002"
tags: [relay-v2, deployment, vercel, ci, security]
dependencies: []
---

# Relay V2 owner-only private preview

## Problem Statement

Relay V2 is merged but has no hosted environment, CI workflow, deployment protection, or production-safe preview mode. A public launch would overstate qualification because production cryptographic bindings and external WO-22 gates remain incomplete.

## Findings

- Vercel can host the Next.js web/API surface but not the persistent maintenance worker.
- Production requires PostgreSQL, TLS, secrets, migrations, an owner seed, and a stable public issuer URL.
- Local evidence signing and key wrapping intentionally refuse production use.
- GitHub has no observed CI context or deployment pipeline to protect yet.

## Proposed Solutions

### Approved: owner-only fail-closed preview

Deploy the dashboard/API to Vercel with a dedicated database and worker. Keep signup and V2 runtime actions disabled, leave external providers unset, and retain every external WO-22 blocker.

### Deferred: limited beta

Do not expose real-world execution until KMS/HSM, artifact storage, operational topology, provider qualification, and human security gates pass.

## Recommended Action

Add a tested deployment-mode guard, environment validator, CI workflow, Vercel and worker configurations, and an executable runbook. Qualify locally, provision the isolated hosted resources, deploy, bind observed checks/protections, and record truthful evidence.

## Acceptance Criteria

- [x] Private-preview mode cannot enable V2 runtime action submission.
- [x] Production configuration validation requires owner-only access, HTTPS, PostgreSQL TLS, and strong secrets.
- [x] CI runs the V1/V2 frontier guard, schema validation, typecheck, lint, tests, performance tests, and build.
- [x] Vercel and non-root worker deployment configurations exist without embedded secrets.
- [x] Hosted bootstrap creates only one owner, is idempotent without resetting credentials, and fails closed on unexpected tenant state.
- [ ] A dedicated managed PostgreSQL database is migrated, owner-bootstrapped once, backed up, and isolated from V1.
- [ ] A Vercel preview is deployed and its health/readiness/login/disabled-action behavior is verified.
- [ ] A maintenance worker is deployed and observed completing cycles.
- [ ] GitHub protects `main` with the observed CI context and a protected deployment environment.
- [ ] Qualification evidence records what passed and preserves every external WO-22 blocker.

## Work Log

### 2026-09-14 — Deployment design and repository hardening

**By:** Codex

**Actions:**
- Confirmed no Relay Vercel project or GitHub deployment existed.
- Selected the owner-only, fail-closed preview profile already approved by the Product Owner.
- Added the initial deployment safety, CI, hosting, worker, validation, and runbook changes for qualification.

**Learnings:**
- Vercel is only the web/API tier; a database and separately hosted worker remain required.
- Production evidence signing is deliberately unavailable until KMS/HSM bindings exist, so private preview must not accept V2 actions.

### 2026-09-14 — Local qualification

**By:** Codex

**Actions:**
- Added and passed four focused private-preview safety tests and updated the V1 frontier guard for the approved post-merge workflow without changing frozen V1 refs.
- Corrected a nondeterministic payment-number false positive for canonical Relay identifiers and added regression assertions that standalone card values remain rejected.
- Passed the deterministic non-live suite (176/176), performance suite (2/2), production build, schema check, typecheck, lint, and V1 frontier guard.
- Built the non-root worker image and verified its TypeScript runtime launcher.

**Learnings:**
- Parallel creation of the full 21-migration test schema requires elevated PostgreSQL lock capacity; CI uses the established serial qualification mode for deterministic results.
- GitHub's Node 22.5 runner requires the Vitest configuration to use the `.mts` ESM marker because Vite is ESM-only.

### 2026-09-14 — Hosted owner bootstrap

**By:** Codex

**Actions:**
- Replaced the hosted runbook's demo seed step with a private-preview-only owner bootstrap.
- Made bootstrap transactional and concurrency-fenced; it creates only the owner identity, returns exact existing state without changing the password, and refuses every ambiguous database state.
- Added focused tests for empty-database creation, idempotency, credential preservation, unexpected-state refusal, and deployment-mode enforcement.
- Passed 180 deterministic non-live tests, 2 performance tests, typecheck, lint, the V1/V2 frontier guard, schema validation, and the production build.

**Learnings:**
- The local demo seed is intentionally unsuitable for a hosted preview because it creates Agent credentials and demo resources.
- The owner password remains outside Relay's logs and repository and is retained only in the operator's secret stores.

### 2026-09-14 — Hosted private-preview evidence

**By:** Codex

**Actions:**
- Merged PR #3 after its required `quality` check passed; post-merge main qualification run `34883664670` also passed.
- Migrated the dedicated Neon database from zero public tables and bootstrapped exactly one owner with zero Agents.
- Deployed main to Vercel deployment `dpl_2UoFkvPznuz5cVy6vq6iCSkQrGeM`; the canonical URL is protected by Vercel Authentication and the Relay application remains in `private-preview` mode.
- Ran one successful maintenance cycle against Neon and stopped the local smoke-test worker cleanly.
- Recorded resource identifiers, inventory, qualification results, and remaining blockers in `docs/v2/qualification/private-preview-2026-09-14.md`.

**Remaining:**
- Upgrade or otherwise configure the managed database for deletion protection and verify its PITR window; the isolated logical restore rehearsal is complete.
- Complete the owner-authenticated live browser checks without weakening Vercel deployment protection.
- Authenticate and configure a persistent worker host; Railway is installed locally but not logged in.
- Preserve `BLOCKED_EXTERNAL_CONFIGURATION` and pending independent-security-review statuses for the external WO-22 gates.

### 2026-09-18 — Deployment boundary and recovery revalidation

**By:** Codex

**Actions:**
- Confirmed the current Vercel production deployment is `Ready` at revision `016007e9f1b2b8917cb66fffe0fc2222fb79195e` and that an unauthenticated headless browser is redirected to Vercel Authentication.
- Attempted a read-only logical backup from the dedicated Neon database for an isolated restore rehearsal.
- Recorded the exact compatibility blocker: Neon runs PostgreSQL 18.6, while the available `pg_dump` is 14.18; no invalid backup or unsupported restore was accepted as evidence.
- Confirmed that obtaining a PostgreSQL 18 client is currently blocked by the unaccepted local Xcode license and that Docker is not running.
- Preserved the managed-backup and owner-authenticated live-flow acceptance criteria as open.

**Learnings:**
- Deployment readiness and deployment protection are verified independently from the owner-authenticated Relay application flow.
- A backup checkbox is insufficient: qualification requires a version-compatible artifact and a successful isolated restore.
- Railway is not required while runtime actions remain disabled; a persistent worker should not be purchased or deployed solely to satisfy preview optics.

### 2026-09-18 — PostgreSQL 18 recovery rehearsal

**By:** Codex

**Actions:**
- Used the official PostgreSQL 18 container tooling to create a read-only custom-format logical backup from the dedicated Neon database.
- Restored the archive with `--exit-on-error` into a fresh PostgreSQL 18 database isolated in a disposable container.
- Verified 21 Drizzle migrations and the expected private-preview inventory: 1 account, 1 user, 1 human principal, 1 owner membership, and 0 Agents.
- Recorded the 325,351-byte artifact checksum `7f894c9460226b75f63de9141b06dd72a5589dc9e4c2cd5f3bf5cbb50e7f0801`.
- Deleted the temporary archive and restore container, then verified no matching containers or temporary directories remained.

**Learnings:**
- The logical recovery path is qualified with version-matched tooling.
- The combined managed-database criterion remains open because Neon plan-level PITR retention and deletion protection still require owner-authenticated verification.

### 2026-09-18 — Managed database control inspection

**By:** Codex

**Actions:**
- Authenticated the Neon CLI and verified that the direct Neon organization is separate from the Vercel Marketplace-managed Relay resource.
- Queried Vercel's authenticated storage metadata and confirmed that Relay's owned Neon resource is active, connected only to Relay, and uses billing plan `free_v3`.
- Confirmed from Neon's current official plan documentation that Free-plan Instant Restores are limited to up to six hours or 1 GB of changes, whichever is smaller.
- Confirmed from Neon's official protected-branch documentation that deletion prevention requires the Scale plan.
- Attempted Vercel Marketplace SSO in an isolated browser without copying personal browser state; the SSO endpoint requires an authenticated dashboard cookie and correctly returned `Unauthorized`.
- Preserved the combined database acceptance criterion as open and marked the managed deletion-protection requirement `BLOCKED_EXTERNAL_CONFIGURATION` rather than weakening it.

**Learnings:**
- The logical recovery path is proven, but the current Free resource cannot satisfy managed deletion protection.
- A Neon plan upgrade is a Product Owner purchase decision and is not authorized by CLI authentication alone.
