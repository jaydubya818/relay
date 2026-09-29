# Historical pre-scope status — superseded

# Relay canonical status

**LOCAL CANDIDATE QUALIFIED — CANONICAL MERGE BLOCKED.**

Canonical branch: `main`; unchanged remote SHA `1da025e4dc234acdc1e6546c4770ccf733611967`. Qualified consolidation checkpoint: `5053693d5d6352caad4c98df9c8d22b297d5f9c8` on `codex/canonical-consolidation`. Evidence-only descendants do not imply canonical merge.

- PostgreSQL suite: **450 PASS / 6 optional live skips**; performance **2 PASS**. Typecheck, lint, Drizzle check, V1/V2 frontier and production build PASS.
- Preserved populated 26→29 migration/replay PASS, with account data and original ledger retained.
- Independent fresh remote-candidate clone repeats **450 PASS / 6 skips**, typecheck and build PASS.
- Credentialed optional browser/sandbox/provider journeys remain unrun. No hosted service was changed.

## Required decisions before canonical merge

1. The requested two-owner shared-business journey cannot pass from the available implementation. Product Expansion explicitly leaves membership, shared Goal/Result audiences, revocation and Rooms as unallocated schema proposals. Private-owner isolation passes, but it is not shared-business acceptance. Product-owner decision pending: explicitly defer this release gate for consolidation, or implement/qualify the shared scope before merge. No authority model was invented during cleanup.
2. Final independent review of the combined candidate remains PENDING. Component reviews are retained but do not replace this gate. This session requires explicit authorization before delegating; a request for one read-only reviewer is pending. No review agent has been started.

No canonical merge/push, post-merge qualification, milestone tag or cleanup has occurred. These gates remain required after the decisions. The disconnected Work Canvas preview is not a production approval, email, publication or sharing implementation. Live provider execution and deployment remain NOT_RUN and are outside this consolidation authorization.

## Preservation and cleanup

Cleanup executed: **0 worktrees, 0 local branches, 0 remote branches**. No existing tag moved or milestone tag created. Primary checkout dirty state is preserved in private recovery archives; it was not reset or cleaned. Candidate checkouts are committed and remotely verified at handoff. Active/historical source remains durable. Two hosted Relay worktree inspections timed out and remain DO_NOT_DELETE. Initial ref inventory is a timestamped audit snapshot, supplemented by SOURCE-UPDATES.md; no destructive final manifest has been executed.

See [source manifest](PRIVATE-ALPHA-SOURCE-MANIFEST.md), [capability crosswalk](CANONICAL-INTEGRATION-CROSSWALK.md), [migration ledger](MIGRATION-RECONCILIATION.md), [qualification index](EVIDENCE-INDEX.md), and [development policy](DEVELOPMENT-POLICY.md).
