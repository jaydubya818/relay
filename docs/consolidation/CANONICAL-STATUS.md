# Relay canonical status

**WAIT_FOR_ACTIVE_COMPONENTS — Stage 1 candidate, not a completed canonical consolidation.**

Canonical branch: `main`. Verified remote baseline: `1da025e4dc234acdc1e6546c4770ccf733611967`. Implementation checkpoint on `codex/canonical-consolidation`: `ed8bb0f11543c2b82a61cf65fc9ed697aae21df4`. Subsequent documentation commits retain this implementation pin; final exact remote checkpoint is recorded by the handoff.

450 tests PASS / 6 optional live skips; 2 performance tests PASS; typecheck, lint, Drizzle check, V1/V2 frontier and build PASS. 26→29 populated migration and replay PASS. Fresh remote-candidate clone independently repeats 450 PASS / 6 skips, typecheck and build PASS.

Final integration review, canonical merge/push, post-merge regression, fresh **canonical** clone and whole-product composition remain NOT_RUN. Repository merge does not establish live/deployed status. No real provider call, paid operation, deployment or publication was authorized or performed here.

See [capabilities](CAPABILITY-INVENTORY.md), [migration reconciliation](MIGRATION-RECONCILIATION.md), [crosswalk](CANONICAL-INTEGRATION-CROSSWALK.md) and [branch inventory](BRANCH-INVENTORY.md).

Cleanup executed: **0 worktrees / 0 local branches / 0 remote branches**. No milestone tag was created. No unique source was deleted. Keep all active, deferred, unknown-status and historical-required worktrees. Two hosted Relay worktrees cannot yet be classified clean: read-only Git status/diff timed out; no cleanup is permitted for them.
