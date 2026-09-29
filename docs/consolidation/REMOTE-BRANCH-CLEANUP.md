# Exact remote deletion manifest

Each DELETE_PROVEN_OBSOLETE tip is reachable from verified canonical `main` (`0feb834594c9b25596653894333306d4770345a3`), was classified obsolete in the source audit, and is not used by an existing registered worktree. Fresh-canonical qualification PASS. Automatic approval review requires separate final approval of this exact manifest; no remote deletion has occurred. A compare-and-swap lease must match every listed tip; changed tips are retained. Unique history, active/recovery and shared-checkout branches are retained.

| Branch | Expected tip | Unique vs main | Disposition |
|---|---|---:|---|
| claude/telegram-local-qualification | `b4fe4bd390bfbd53069ef92232af09c96d7c5526` | 11 | KEEP |
| codex/authority-expiry-diagnostics | `36b79399b9906208cc0784f7f613e8dd5ce5489f` | 0 | DELETE_PROVEN_OBSOLETE |
| codex/canonical-consolidation | `749c553b37a55c47dd31add72a760a439fbb0ab0` | 0 | KEEP |
| codex/fq-relay-6384519e0e01 | `73d9104fbe8a2c102258dc593ce61d0f23d9254f` | 1 | KEEP |
| codex/grant-never-expire | `b8be9352780b3d49cc8e4eae45d1be47a57919e0` | 0 | DELETE_PROVEN_OBSOLETE |
| codex/myeve-federation-preprovision | `c910c9debc1f92acd60649431a6466243a711c33` | 5 | KEEP |
| codex/myfactory-hosted-routing | `fac4dede019d0b60aacc1a7c5901a413e38206d4` | 8 | KEEP |
| codex/myfactory-relay-live | `e2dfb5b4480f9bc2c2e5c7642dbf38f36a3f8404` | 2 | KEEP |
| codex/peer-message-answers | `381918e5ce6a24ecdf5ba5d74daec02663728662` | 0 | DELETE_PROVEN_OBSOLETE |
| codex/prod-relay-release | `b453652e3efa7db18e06cd5fe42cba4a518b4c63` | 1 | KEEP |
| codex/relay-beta-identity-lifecycle | `416dee9b2faf4e206deb75ff93f9d284c0c1439d` | 0 | DELETE_PROVEN_OBSOLETE |
| codex/relay-beta-trust-onboarding | `9e3903aa19c11337f078297397d5cda821a7d5e8` | 0 | DELETE_PROVEN_OBSOLETE |
| codex/relay-final-integration | `88bd2e88ce2253b092847c1dc7aaaac55099fb3f` | 0 | DELETE_PROVEN_OBSOLETE |
| codex/relay-owner-preview-consolidation | `f8f30ccd1db769aee7751c6eef56ea09a7152290` | 0 | DELETE_PROVEN_OBSOLETE |
| codex/relay-owner-preview-qualification | `2405e33eca5131d846044c2c811c15126b2d39a2` | 14 | KEEP |
| codex/relay-private-preview | `2b49e1584e9b595f745df4ef5c56c51255c7221b` | 0 | DELETE_PROVEN_OBSOLETE |
| codex/relay-signing-envelope-v2 | `31f878a6c420a1b9889bb4921bc8eefb4cb996ce` | 0 | DELETE_PROVEN_OBSOLETE |
| codex/relay-v1-soak-consolidation | `f77a9c15d3d3838e207be53cbc6192a9207ff88f` | 0 | DELETE_PROVEN_OBSOLETE |
| codex/telegram-current-integration | `0bcb8777e45e57b52cf8e536b6f5a12c90b811ad` | 0 | DELETE_PROVEN_OBSOLETE |
| feat/authority-inspection-v1 | `31ab0eec3d02d660f81bc156f1eea4535c2f5764` | 1 | KEEP |
| feat/relay-v1 | `43e0160eb2b9552f71154d18369e4626e0e79339` | 0 | KEEP |
| feat/relay-v2 | `23950ebfa7fd08e0fc00c8067183cbcbf1cab9ac` | 0 | DELETE_PROVEN_OBSOLETE |
| feat/relay-v2-telegram-private-beta | `e3b981a787476416005a555a5ac9c58b24c00300` | 3 | KEEP |
| main | `0feb834594c9b25596653894333306d4770345a3` | 0 | KEEP |
