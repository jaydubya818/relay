# ADR-016: Relay V2 implementation frontier

- Status: Accepted
- Date: 2026-09-13
- WorkOrder: WO-00

## Context

Relay V1 is frozen in RC soak. V2 needs the qualified V1 capability-plane foundation without changing the RC tag, soak branch, evidence, or release history.

## Decision

Relay V2 is implemented only on `feat/relay-v2`, created from immutable tag `relay-v1.0.0-rc.1` at commit `43e0160eb2b9552f71154d18369e4626e0e79339`.

The active soak head was rejected as the base. It contains post-tag defect fixes and ongoing same-day soak evidence whose recorded disposition is `CONTINUE SOAK`; it is not an immutable promoted baseline.

The following refs are protected V1 state and are never V2 write targets:

- `main`
- `feat/relay-v1`
- `codex/relay-v1-rc-soak`
- `relay-v1.0.0-rc.1`
- every `relay-v1.*` tag

V2 uses distinct deployed resource names and credentials. Production configuration must supply V2-specific database, Temporal namespace, queue/topic, object-storage prefix or bucket, KMS key, runner trust domain, OAuth clients, webhook endpoints, and deploy target. A V2 process must refuse a configuration whose declared environment or resource namespace is `v1`, `rc1`, or `soak`.

V2 must not import a V1 database in place. Any future migration is an explicit, copy-based, reversible WorkOrder and is not authorized by this ADR.

## Enforcement

- `pnpm v2:frontier:check` verifies the immutable base tag, ancestry, branch, and protected refs before V2 qualification.
- V2 CI must run the frontier check before build, migration, or deploy.
- Remote branch protections and deployment credentials must prevent V2 automation from writing protected V1 refs or environments.
- V2 migrations use new migration files and are never executed against the V1 soak database.
- No V2 release tag, merge, or deployment occurs without Product Owner approval.

## Consequences

V2 can deliberately port a post-tag fix as a V2 commit, but it does not inherit ongoing soak evidence or imply V1 promotion. Some live enforcement depends on repository/deployment administration and must be recorded as `BLOCKED_EXTERNAL_CONFIGURATION` until verified.

