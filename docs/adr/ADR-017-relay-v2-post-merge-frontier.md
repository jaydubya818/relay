# ADR-017: Relay V2 post-merge implementation frontier

- Status: Accepted
- Date: 2026-09-14
- Supersedes: ADR-016 branch-target restriction after the approved V2 merge

## Context

ADR-016 required all initial V2 implementation to remain on `feat/relay-v2` while V1 was frozen in RC soak. The Product Owner approved PR #1 and Relay V2 was merged to `main` at `768a6e26356271a9a7a8741b25dc99921d66c72c`. Normal post-merge maintenance now happens through pull-request branches and CI must also qualify `main`.

Keeping a single hard-coded `feat/relay-v2` branch requirement would prevent both workflows without adding V1 protection. The immutable V1 release tag and V1 branch refs remain the actual frozen assets.

## Decision

V2 development may run on ordinary pull-request branches and `main`, provided HEAD descends from the immutable V1 base. The frontier guard continues to require `relay-v1.0.0-rc.1` at `43e0160eb2b9552f71154d18369e4626e0e79339`, rejects either frozen V1 branch as the current write target, and verifies every available frozen V1 ref against its recorded commit.

The frozen targets remain:

- tag `relay-v1.0.0-rc.1` at `43e0160eb2b9552f71154d18369e4626e0e79339`;
- branch `feat/relay-v1` at `43e0160eb2b9552f71154d18369e4626e0e79339`;
- local soak branch `codex/relay-v1-rc-soak` at `6ca798d5a677e0b7d9563692fb9ccbe1fa91a4ad` when that local-only ref is present.

No V2 deployment may reuse a V1 database, credentials, OAuth application, resource namespace, environment, or release tag.

## Consequences

GitHub Actions can qualify pull requests and `main` without checking out or modifying a V1 branch. The guard becomes stricter about ref immutability by comparing exact commits instead of checking only that branch names exist. ADR-016 remains the historical record of the pre-merge implementation boundary.
