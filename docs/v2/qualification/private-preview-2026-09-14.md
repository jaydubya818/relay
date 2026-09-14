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
- Backup/restore rehearsal: pending.
- Owner-authenticated live flow: pending.
- All other external WO-22 gates remain open as recorded in the release dossier and gate matrix.
