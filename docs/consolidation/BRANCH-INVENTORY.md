# Relay branch inventory
Initial inventory: 2026-09-29T06:10:56.663709+00:00. Current candidate: `ed8bb0f11543c2b82a61cf65fc9ed697aae21df4`. Remote canonical: `1da025e4dc234acdc1e6546c4770ccf733611967`.
No branch or worktree is authorized for deletion by this report yet. Canonical merge, post-merge and fresh-clone gates remain open.

Classifications use ancestry, commit/file deltas and the documented source/qualification findings. UNKNOWN is deliberately retained where semantic reconciliation is unfinished.

| Ref | Exact tip | Behind / ahead canonical | Classification | Reason |
|---|---|---|---|---|
| refs/heads/codex/authority-expiry-diagnostics | 36b79399b9906208cc0784f7f613e8dd5ce5489f | 47	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/heads/codex/canonical-consolidation | ed8bb0f11543c2b82a61cf65fc9ed697aae21df4 | 0	8 | CANONICAL_INPUT | Task-owned integration checkpoint; not yet final qualified canonical source. |
| refs/heads/codex/grant-never-expire | b8be9352780b3d49cc8e4eae45d1be47a57919e0 | 45	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/heads/codex/myfactory-hosted-routing | fac4dede019d0b60aacc1a7c5901a413e38206d4 | 25	8 | SUPERSEDED | Factory routing was integrated through canonical merge/squash. Stateless invite alternative fac4ded conflicts with canonical durable invitation lifecycle; do not reintroduce it. |
| refs/heads/codex/myfactory-relay-live | 86c558d6e52081cfbb425920d560ed8024731bb4 | 62	1 | ALREADY_CONTAINED | Factory-only credential option is present; later invite UI is additive. Current lint ignore lib/**/*.d.mts subsumes the old specific generated declaration ignore. |
| refs/heads/codex/peer-message-answers | 381918e5ce6a24ecdf5ba5d74daec02663728662 | 43	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/heads/codex/relay-beta-trust-onboarding | 9e3903aa19c11337f078297397d5cda821a7d5e8 | 4	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/heads/codex/relay-federation | 614c638d6fc4099db8064540326f5de4438e93a1 | 84	4 | ALREADY_CONTAINED | All four unique commits have patch-equivalent canonical commits, including signed denials and the two-owner HTTPS qualification. |
| refs/heads/codex/relay-owner-preview-consolidation | f8f30ccd1db769aee7751c6eef56ea09a7152290 | 67	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/heads/codex/relay-private-preview | 2b49e1584e9b595f745df4ef5c56c51255c7221b | 98	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/heads/codex/relay-v1-rc-soak | 6ca798d5a677e0b7d9563692fb9ccbe1fa91a4ad | 146	5 | HISTORICAL_EVIDENCE_ONLY | Frozen V1 frontier check requires this ref; soak evidence retained. |
| refs/heads/codex/relay-v1-soak-consolidation | f77a9c15d3d3838e207be53cbc6192a9207ff88f | 79	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/heads/feat/authority-inspection-v1 | 31ab0eec3d02d660f81bc156f1eea4535c2f5764 | 49	1 | ALREADY_CONTAINED | Unique authority-inspection patch is equivalent to canonical implementation; later service adds expiry and message behavior. |
| refs/heads/feat/relay-v1 | 43e0160eb2b9552f71154d18369e4626e0e79339 | 146	0 | ALREADY_CONTAINED | Frozen V1 frontier check requires this branch and release tag. |
| refs/heads/feat/relay-v2 | 23950ebfa7fd08e0fc00c8067183cbcbf1cab9ac | 101	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/heads/feat/relay-v2-telegram-private-beta | 89d6b053196566486648c3bbc7ac36d196a0e0c1 | 62	0 | HISTORICAL_EVIDENCE_ONLY | Unique later commits record older Telegram qualification; active implementation is retained by the newer local-qualification branch and canonical channel baseline. |
| refs/heads/main | e2eb350f5655427d55cc204264020a9295173f96 | 49	0 | CANONICAL_INPUT | Actual origin default branch is main; preserve canonical checkout, including local divergence. |
| refs/remotes/origin/HEAD | 1da025e4dc234acdc1e6546c4770ccf733611967 | 0	0 | CANONICAL_INPUT | Actual origin default branch is main; preserve canonical checkout, including local divergence. |
| refs/remotes/origin/claude/telegram-local-qualification | b4fe4bd390bfbd53069ef92232af09c96d7c5526 | 2	11 | UNIQUE_WORK_TO_INTEGRATE | Offline-tested channel improvements; latest report retains INCOMPLETE live Golden Journey. Keep separate until MyEve channel pair and release boundaries are reconciled. |
| refs/remotes/origin/codex/authority-expiry-diagnostics | 36b79399b9906208cc0784f7f613e8dd5ce5489f | 47	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/codex/canonical-consolidation | ed8bb0f11543c2b82a61cf65fc9ed697aae21df4 | 0	8 | CANONICAL_INPUT | Task-owned integration checkpoint; not yet final qualified canonical source. |
| refs/remotes/origin/codex/fq-relay-6384519e0e01 | 73d9104fbe8a2c102258dc593ce61d0f23d9254f | 183	1 | HISTORICAL_EVIDENCE_ONLY | Unique delta is documentation/evidence; preserve source/report history. |
| refs/remotes/origin/codex/grant-never-expire | b8be9352780b3d49cc8e4eae45d1be47a57919e0 | 45	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/codex/myeve-federation-preprovision | c910c9debc1f92acd60649431a6466243a711c33 | 54	5 | UNIQUE_WORK_TO_INTEGRATE | Versioned commitment signature protocol needs paired MyEve verifier and independent security review. Qualification report explicitly says NO-GO; preserve and defer coordinated protocol rollout. |
| refs/remotes/origin/codex/myfactory-hosted-routing | fac4dede019d0b60aacc1a7c5901a413e38206d4 | 25	8 | SUPERSEDED | Factory routing was integrated through canonical merge/squash. Stateless invite alternative fac4ded conflicts with canonical durable invitation lifecycle; do not reintroduce it. |
| refs/remotes/origin/codex/myfactory-relay-live | e2dfb5b4480f9bc2c2e5c7642dbf38f36a3f8404 | 62	2 | ALREADY_CONTAINED | Factory-only credential option is present; later invite UI is additive. Current lint ignore lib/**/*.d.mts subsumes the old specific generated declaration ignore. |
| refs/remotes/origin/codex/peer-message-answers | 381918e5ce6a24ecdf5ba5d74daec02663728662 | 43	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/codex/prod-relay-release | b453652e3efa7db18e06cd5fe42cba4a518b4c63 | 2	1 | ALREADY_CONTAINED | Every file in the branch delta has the identical blob in the candidate; history differs through cherry-pick/squash. Cleanup remains gated. |
| refs/remotes/origin/codex/relay-beta-identity-lifecycle | 416dee9b2faf4e206deb75ff93f9d284c0c1439d | 1	7 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/codex/relay-beta-trust-onboarding | 9e3903aa19c11337f078297397d5cda821a7d5e8 | 4	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/codex/relay-final-integration | 88bd2e88ce2253b092847c1dc7aaaac55099fb3f | 50	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/codex/relay-owner-preview-consolidation | f8f30ccd1db769aee7751c6eef56ea09a7152290 | 67	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/codex/relay-owner-preview-qualification | 2405e33eca5131d846044c2c811c15126b2d39a2 | 78	14 | SUPERSEDED | Patch equivalence covers qualification changes; unique dashboard fix 5680056 is explicitly reverted by f39288e. Preserve historical performance evidence. |
| refs/remotes/origin/codex/relay-private-preview | 2b49e1584e9b595f745df4ef5c56c51255c7221b | 98	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/codex/relay-signing-envelope-v2 | 31f878a6c420a1b9889bb4921bc8eefb4cb996ce | 52	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/codex/relay-v1-soak-consolidation | f77a9c15d3d3838e207be53cbc6192a9207ff88f | 79	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/codex/telegram-current-integration | 0bcb8777e45e57b52cf8e536b6f5a12c90b811ad | 26	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/feat/authority-inspection-v1 | 31ab0eec3d02d660f81bc156f1eea4535c2f5764 | 49	1 | ALREADY_CONTAINED | Unique authority-inspection patch is equivalent to canonical implementation; later service adds expiry and message behavior. |
| refs/remotes/origin/feat/relay-v1 | 43e0160eb2b9552f71154d18369e4626e0e79339 | 146	0 | ALREADY_CONTAINED | Frozen V1 frontier check requires this branch and release tag. |
| refs/remotes/origin/feat/relay-v2 | 23950ebfa7fd08e0fc00c8067183cbcbf1cab9ac | 101	0 | ALREADY_CONTAINED | Exact ancestry containment in consolidation candidate; cleanup still gated. |
| refs/remotes/origin/feat/relay-v2-telegram-private-beta | e3b981a787476416005a555a5ac9c58b24c00300 | 29	3 | HISTORICAL_EVIDENCE_ONLY | Unique later commits record older Telegram qualification; active implementation is retained by the newer local-qualification branch and canonical channel baseline. |
| refs/remotes/origin/main | 1da025e4dc234acdc1e6546c4770ccf733611967 | 0	0 | CANONICAL_INPUT | Actual origin default branch is main; preserve canonical checkout, including local divergence. |
| refs/tags/relay-v0.1.0 | fccf8a6cb883547f6d53c486ef1f20f099f42c26 | 170	0 | ALREADY_CONTAINED | Existing immutable tag; do not move or delete. |
| refs/tags/relay-v1.0.0-rc.1 | 435960cf5a5de4f4b877fcf2f16bfd25968823b0 | 146	0 | ALREADY_CONTAINED | Existing immutable tag; do not move or delete. |

Full branch unique-commit lists and merge bases: [branch-dispositions.json](branch-dispositions.json). Initial reflogs, unreferenced candidates, migration hashes, evidence indexes and worktree status: [inventory.initial.json](inventory.initial.json).
