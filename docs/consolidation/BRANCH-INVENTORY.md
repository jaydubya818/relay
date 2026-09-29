# Current branch inventory

Initial source investigation and unique-commit dispositions remain in historical-status/initial-BRANCH-INVENTORY.md, branch-dispositions.json and unique-commits.json. This post-cleanup list records current local/remote refs. Remote deletion manifest is pending approval; local deletions are in CLEANUP-RECEIPT.json. UNKNOWN dispositions:0.

| Ref | Tip | Unique vs qualified main | Disposition |
|---|---|---:|---|
| refs/heads/codex/canonical-consolidation | `749c553b37a55c47dd31add72a760a439fbb0ab0` | 0 | KEEP_CANONICAL_OR_CONSOLIDATION |
| refs/heads/codex/myfactory-hosted-routing | `fac4dede019d0b60aacc1a7c5901a413e38206d4` | 8 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/heads/codex/myfactory-relay-live | `86c558d6e52081cfbb425920d560ed8024731bb4` | 1 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/heads/codex/relay-federation | `614c638d6fc4099db8064540326f5de4438e93a1` | 4 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/heads/codex/relay-v1-rc-soak | `6ca798d5a677e0b7d9563692fb9ccbe1fa91a4ad` | 5 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/heads/feat/authority-inspection-v1 | `31ab0eec3d02d660f81bc156f1eea4535c2f5764` | 1 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/heads/feat/relay-v1 | `43e0160eb2b9552f71154d18369e4626e0e79339` | 0 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/heads/feat/relay-v2-telegram-private-beta | `89d6b053196566486648c3bbc7ac36d196a0e0c1` | 0 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/heads/main | `e2eb350f5655427d55cc204264020a9295173f96` | 0 | KEEP_CANONICAL_OR_CONSOLIDATION |
| refs/remotes/origin/HEAD | `0feb834594c9b25596653894333306d4770345a3` | 0 | KEEP_CANONICAL_OR_CONSOLIDATION |
| refs/remotes/origin/claude/telegram-local-qualification | `b4fe4bd390bfbd53069ef92232af09c96d7c5526` | 11 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/remotes/origin/codex/authority-expiry-diagnostics | `36b79399b9906208cc0784f7f613e8dd5ce5489f` | 0 | DELETE_REMOTE_PENDING_APPROVAL |
| refs/remotes/origin/codex/canonical-consolidation | `749c553b37a55c47dd31add72a760a439fbb0ab0` | 0 | KEEP_CANONICAL_OR_CONSOLIDATION |
| refs/remotes/origin/codex/fq-relay-6384519e0e01 | `73d9104fbe8a2c102258dc593ce61d0f23d9254f` | 1 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/remotes/origin/codex/grant-never-expire | `b8be9352780b3d49cc8e4eae45d1be47a57919e0` | 0 | DELETE_REMOTE_PENDING_APPROVAL |
| refs/remotes/origin/codex/myeve-federation-preprovision | `c910c9debc1f92acd60649431a6466243a711c33` | 5 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/remotes/origin/codex/myfactory-hosted-routing | `fac4dede019d0b60aacc1a7c5901a413e38206d4` | 8 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/remotes/origin/codex/myfactory-relay-live | `e2dfb5b4480f9bc2c2e5c7642dbf38f36a3f8404` | 2 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/remotes/origin/codex/peer-message-answers | `381918e5ce6a24ecdf5ba5d74daec02663728662` | 0 | DELETE_REMOTE_PENDING_APPROVAL |
| refs/remotes/origin/codex/prod-relay-release | `b453652e3efa7db18e06cd5fe42cba4a518b4c63` | 1 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/remotes/origin/codex/relay-beta-identity-lifecycle | `416dee9b2faf4e206deb75ff93f9d284c0c1439d` | 0 | DELETE_REMOTE_PENDING_APPROVAL |
| refs/remotes/origin/codex/relay-beta-trust-onboarding | `9e3903aa19c11337f078297397d5cda821a7d5e8` | 0 | DELETE_REMOTE_PENDING_APPROVAL |
| refs/remotes/origin/codex/relay-final-integration | `88bd2e88ce2253b092847c1dc7aaaac55099fb3f` | 0 | DELETE_REMOTE_PENDING_APPROVAL |
| refs/remotes/origin/codex/relay-owner-preview-consolidation | `f8f30ccd1db769aee7751c6eef56ea09a7152290` | 0 | DELETE_REMOTE_PENDING_APPROVAL |
| refs/remotes/origin/codex/relay-owner-preview-qualification | `2405e33eca5131d846044c2c811c15126b2d39a2` | 14 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/remotes/origin/codex/relay-private-preview | `2b49e1584e9b595f745df4ef5c56c51255c7221b` | 0 | DELETE_REMOTE_PENDING_APPROVAL |
| refs/remotes/origin/codex/relay-signing-envelope-v2 | `31f878a6c420a1b9889bb4921bc8eefb4cb996ce` | 0 | DELETE_REMOTE_PENDING_APPROVAL |
| refs/remotes/origin/codex/relay-v1-soak-consolidation | `f77a9c15d3d3838e207be53cbc6192a9207ff88f` | 0 | DELETE_REMOTE_PENDING_APPROVAL |
| refs/remotes/origin/codex/telegram-current-integration | `0bcb8777e45e57b52cf8e536b6f5a12c90b811ad` | 0 | DELETE_REMOTE_PENDING_APPROVAL |
| refs/remotes/origin/feat/authority-inspection-v1 | `31ab0eec3d02d660f81bc156f1eea4535c2f5764` | 1 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/remotes/origin/feat/relay-v1 | `43e0160eb2b9552f71154d18369e4626e0e79339` | 0 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/remotes/origin/feat/relay-v2 | `23950ebfa7fd08e0fc00c8067183cbcbf1cab9ac` | 0 | DELETE_REMOTE_PENDING_APPROVAL |
| refs/remotes/origin/feat/relay-v2-telegram-private-beta | `e3b981a787476416005a555a5ac9c58b24c00300` | 3 | KEEP_INTENTIONAL_SOURCE_OR_CHECKOUT |
| refs/remotes/origin/main | `0feb834594c9b25596653894333306d4770345a3` | 0 | KEEP_CANONICAL_OR_CONSOLIDATION |
