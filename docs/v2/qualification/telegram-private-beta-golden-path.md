# Telegram private-beta golden path

Status: **INCOMPLETE — transport hardening and enrollment foundation implemented; execution integration and live qualification pending**.
Overall Relay: **NOT_READY_FOR_LIMITED_BETA**.

## Baseline

- Inspected 2026-09-20; fetched origin and tags before changes.
- Canonical main, local HEAD, and origin/main: `7ea29b2886d2b8bad7b1a1ca1c3e8df1d39ee9ee`.
- Canonical worktree: `/Users/jaywest/relay`; initially clean on main.
- Feature branch: `feat/relay-v2-telegram-private-beta`.
- Feature worktree: `/Users/jaywest/Documents/ChatGPT/New project/relay-worktrees/feat/relay-v2-telegram-private-beta`; initially clean at the canonical SHA.
- Local and remote tag objects agree: `relay-v0.1.0` = `fccf8a6cb883547f6d53c486ef1f20f099f42c26`; `relay-v1.0.0-rc.1` = `435960cf5a5de4f4b877fcf2f16bfd25968823b0`.
- No owner-preview secrets copied into the worktree. No deployment changed.
- `vercel.json` specifies `iad1`. Preserve qualified Neon `us-east-1` placement. The older `operations/private-preview.md` reference to `sfo1` is stale and is not deployment authority.

## Existing primitives and missing integration

| Stage | Existing code | Required addition/qualification |
|---|---|---|
| Channel | `lib/v2/communications.ts`, `providers/communications.ts` | Private-chat enrollment gate, bounded HTTP ingress, durable rate limits, retry cap |
| Identity | `identity.ts`, `passports.ts`, account memberships and Agents | Owner-created one-use challenge; stable Telegram user/chat binding to one account/Agent |
| Events | `orchestration.ts`: verified event, routes, task commands, control outbox | Bind routing to enrollment; recover accepted-but-unrouted messages; exclude unknown identities before persistence |
| Inbox | `lib/inbox.ts` | Reuse canonical task/event path; do not add another inbox |
| Authority | `policy/service.ts`, `approvals.ts`, `leases.ts` | Exact bounded research/submission action through existing policy, approval, workload and lease checks |
| Budgets | `budgets.ts` reservations and reconciliation | Per-task wall time, action/step/retry/artifact caps alongside token/spend reservations |
| Execution | `execution-providers.ts`, `providers/relay-managed.ts` | Wire the real adapter to the worker; restart cleanup and ownership fencing |
| Evidence | `evidence/audit.ts`, `artifacts.ts`, dashboard Activity | Configure durable signer/key resolver/object store; link binding, event, task, effect and reply receipts |
| Approvals UI | `app/api/v2/operator/approvals/route.ts`, canonical dashboard | Real Telegram-created fixture and understandable action context; no seeded approval |
| Worker | `scripts/worker.ts`, `lib/worker.ts` | Current executable only performs browser/sandbox maintenance; no task executor is wired |
| Deployment | `deployment.ts`, `platform-bindings.ts`, `Dockerfile.worker` | Private-preview unconditionally denies runtime actions; separate qualified execution profile and worker needed |

Repository search found `TemporalGateway` as an interface consumed by orchestration, but no concrete hosted gateway. `task-workflow.ts` supplies a reducer/contract, not a running workflow service. No application bootstrap calls `configureV2PlatformBindings`. The only provided signer/key-wrapper implementations are local and explicitly refuse production. The managed adapter retains sessions/tombstones in memory; current cleanup and restart behavior cannot be claimed to satisfy the mission merely because its component tests pass.

These are integration/deployment gaps, not permission to weaken preview denial, replace durable signing with temporary keys, or declare the beta ready.

## Dependency-ordered implementation plan

1. Harden Telegram parsing/authentication and provider errors. Reproduce defects and retain focused regression results in separate fix commits.
2. Add additive enrollment schema on the existing communication connection: short-lived hashed challenges, one active binding, owner/Agent references, revocation. Implement authenticated owner create/list/disconnect operations and pairing concurrency/isolation tests.
3. Add disabled-by-default HTTPS ingress. Authenticate before trusting stable numeric IDs; accept private direct text only. Reject groups, channels, forwarded/edited messages, callbacks, attachments, oversized/malformed requests. Bound the stream before parsing. Resolve all account/Agent authority server-side. Durably limit requests and converge duplicate updates/messages.
4. Normalize enrolled requests into canonical messages/events/tasks. Support bounded conversational public research and the controlled qualification submission only, plus pairing/status/cancel. No arbitrary capability names, targets for consequential actions, or unlimited chat history.
5. Wire a Relay-managed worker to existing command/outbox/fencing primitives. Resolve the existing Temporal contract rather than quietly introducing a second queue. Configure approved signing/storage bindings. Preserve the owner-preview deployment denial and current web/database regions.
6. Execute public research in a disposable browser under normal policy, budget and lease authority; capture bounded relevant source evidence. Proposed default bounds: 60 seconds runtime, 4 pages, 12 browser actions, 2 safe pre-effect retries, 1 MiB total evidence. Model interpretation, if used, needs an explicitly configured provider and hard token/spend caps; it cannot grant authority.
7. Create the consequential fixture through Telegram, targeting an isolated qualification application. Pause in canonical approval; bind target, payload, Agent, capability, budget and expiry. Approval/rejection happens through the owner UI. Revalidate every authority before the exact POST, with a stable effect key at the controlled target.
8. Deliver concise outcomes to the same active binding using canonical communication receipts. Preserve `EFFECT_UNKNOWN` for ambiguous Telegram sends; never blindly retry them. Implement cancellation, revocation checkpoints, bounded recovery and cleanup reconciliation.
9. Add the minimal Connections UI, operational failure/wait/stale/cleanup visibility and runtime stop controls. Define/enforce retention separately for transport metadata, content, task, approval, evidence and artifacts.
10. Run fresh/upgrade migrations, focused and full regressions, then live scenarios A–I and the approval negative matrix. Record exact source/deployment/identity/receipt references, clean disposable resources, push focused commits, and create a PR only when qualification is green. No automatic merge.

## External prerequisites and pending owner input

- Approved worker host/execution deployment profile; provisioning any new paid resource needs owner authorization.
- Dedicated authorized beta bot, private test identity and selected owner/Agent. No Telegram credential configuration names were found in the local repository `.env.local` or current process environment. This is not a claim about uninspected remote secret stores.
- Approved durable signing/key resolution and evidence storage configuration; current production bindings are absent from application bootstrap.
- Human authentication and actual owner approval/rejection during live tests.

Never paste or record bot tokens, credentials, cookies, signing private keys or OAuth secrets. Register the webhook only after the deployed endpoint passes readiness and security checks. No webhook has been registered in this mission.

## Qualification evidence ledger

| Evidence | Current result |
|---|---|
| Exact implementation source SHA | `cd2c298de18b16367054d692c5cc38d6095eee7c`; subsequent documentation-only commit recorded by Git |
| Deployment ID, endpoint, worker host | NOT_DEPLOYED |
| Bot identity / private Telegram identity | NOT_CONFIGURED |
| Relay owner / Agent / grants | NOT_SELECTED |
| Pairing and tenant isolation | 8 database-backed pairing tests passed; full end-to-end tenant matrix NOT_RUN |
| Inbound event, update/message references, correlation IDs | NOT_RUN |
| Research, runtime/computer/browser identity, evidence, budgets | NOT_RUN |
| Real approval fixture / approval UI | NOT_RUN_NO_FIXTURE |
| Approved action / rejection / mutation / expiry / revocation | NOT_RUN |
| Outbound result / denial receipts | NOT_RUN |
| Duplicate / restart / recovery | NOT_RUN |
| Cancellation / revocation / hostile content / abuse | Pairing revocation and 16 input-boundary tests passed; execution cancellation, hostile website and full abuse matrix NOT_RUN |
| Cleanup / monitoring / emergency stop | 5 existing local browser/Docker component tests passed; Telegram task cleanup/monitoring/stop NOT_RUN |
| Migration / fresh / upgrade / repeat | Additive `0021_telegram_pairing`; fresh database exercised by pairing tests; dedicated canonical 0020 → 0021 upgrade/repeat test passed; metadata check passed |
| Automated regression | Serial suite: 211 passed, 5 skipped; separate upgrade test: 1 passed; opt-in component run: all 5 previously skipped tests passed |
| Live scenarios | 0 executed; 0 passed; 0 failed; A–I pending |
| Typecheck / lint / production build / performance | All passed locally; performance 2/2; hosted performance NOT_RUN |
| PR / merge | Not created: mandatory live acceptance remains incomplete / not merged |

No historical component test count is counted as a golden-path pass. No local mock counts as live Telegram evidence. Every one of the 25 mandatory acceptance assertions in the mission must be evidenced before `PASSED_LIVE`.

## Release boundary

- Owner preview: previously qualified at the recorded canonical SHA; unchanged by this mission so far.
- Telegram private-beta golden path: **INCOMPLETE**.
- Telegram approval technical UX: **NOT_RUN_NO_FIXTURE**.
- WO-22 overall/provider/topology qualification and deployment-environment enforcement remain open.
- WO-02 independent security review and penetration testing remain outstanding; this mission does not replace them.
- Formal accessibility/approval comprehension: **REQUIRES_HUMAN_REVIEW**.
- Limited-beta cohort decision: **REQUIRES_PRODUCT_OWNER_DECISION**.
- Overall readiness: **NOT_READY_FOR_LIMITED_BETA**.


## Implemented scope and verification (2026-09-20)

The implementation is deliberately inactive support code: no Telegram HTTP endpoint, owner pairing UI, worker or deployment configuration is enabled. Do not register a webhook against this branch. In particular, `authenticateTelegramWorkUpdate` returns authenticated identity context, not execution authorization: future admission must durably bind that context and recheck revocation before each effect. It does not yet publish an event or grant a capability. The original general communications ingestion function is not a private-beta enrollment boundary and must not be exposed as one.

Enrollment uses the existing account-owned communication connection and Agent identity. A human OWNER creates a 256-bit challenge; only its SHA-256 hash is persisted, for five minutes. Issuing another challenge invalidates the previous one. A verified private `/start` message consumes it under a per-connection transaction lock. An active-connection unique index admits one identity/Agent pairing per bot connection. Reused, expired, replaced, wrong or concurrently consumed challenges fail closed. No account or Agent is created by Telegram. Disconnect revokes the binding and canonical connection, invalidates pending challenges and prevents future canonical sends. Actual in-flight execution cancellation remains unimplemented.

The private input parser bounds raw bytes to 32 KiB and text to 4096 characters, rejects malformed UTF-8/JSON and unsupported contexts, and uses stable numeric sender/chat IDs. Display names, usernames and JSON authority claims do not select the account or Agent. Group/channel/edited/callback/forwarded/attachment/reply-context messages are unsupported. The streaming body helper enforces the cap without trusting Content-Length. The future HTTP endpoint still needs a request deadline, durable rate limits and default-off readiness checks.

Schema blast radius: two additive enrollment tables, their indexes/foreign keys, the Drizzle journal and generated snapshot. The approximately 15,000-line snapshot is generated full-schema metadata, not a broad application refactor. No existing migration was rewritten; no hosted migration was run. No retention duration has been enabled: content/evidence retention and challenge pruning must be finalized before ingress goes live.

### Focused defect evidence

| Classification | Reproduction before fix | Correction / verification |
|---|---|---|
| Test harness path defect | Vitest failed to resolve `@/` under a path containing spaces; no tests collected | `fileURLToPath` replaces encoded URL pathname; commit `dc296d5`; tests now collect and pass |
| EVIDENCE_DEFECT / EXTERNAL_PROVIDER_FAILURE containment | Three new transport tests failed: non-JSON 502 propagated parser text; Telegram rejection exposed provider description; malformed 200 propagated parser text | Commit `7097f00`; classify 5xx before parsing, contain parser errors, use fixed rejection text, preserve ambiguous effects; 6/6 provider tests passed |
| Pairing fixture correction | First pairing run: 28 passed, 1 failed because the test used nonexistent Agent status `REVOKED` | Use actual `DISABLED` state; create/activate test Agents through passport APIs; final focused run 30/30 passed |

No real Telegram transport failure was reproduced: the provider regression uses controlled HTTP responses. A live rerun remains pending bot configuration. No approval database rows were fabricated.

### Commands and exact results

All database tests used disposable local PostgreSQL 17 on `127.0.0.1:55439`, not Neon or owner-preview data.

- `pnpm vitest run tests/v2/telegram-input.test.ts tests/v2/telegram-pairing.test.ts tests/v2/communication-providers.test.ts --fileParallelism=false`: 3 files, 30 tests passed.
- `RELAY_TEST_DATABASE_URL=postgresql://127.0.0.1:55439/postgres pnpm test:ci`: 45 files passed, 3 skipped; 211 tests passed, 5 skipped, 0 failed. The migration test was added afterward and run separately.
- `... pnpm vitest run tests/v2/telegram-migration.test.ts --fileParallelism=false`: 1 file / 1 test passed. Applies canonical migrations 0000–0020, inserts a sentinel account, upgrades to 0021, repeats migration and proves the sentinel remains.
- `RELAY_LIVE_PLAYWRIGHT=1 RELAY_LIVE_DOCKER=1 ... pnpm vitest run tests/browser/playwright-live.test.ts tests/sandbox/docker-live.test.ts tests/v2/relay-managed-provider-live.test.ts --fileParallelism=false`: 3 files / 5 tests passed. These cover all 5 skipped tests above; they are real local components, not live Telegram tests.
- Distinct non-performance tests across the serial, upgrade and opt-in runs: **217 passed**. The focused 30 are already included and must not be added again.
- `pnpm test:performance`: 2 files / 2 tests passed; dashboard read-model p95 **1.126167 ms**, concurrency p95 **36.697750 ms**, 64 operations, error rate 0.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm db:check`, `pnpm v2:frontier:check`, `git diff --check`: passed. Test/build commands required ordinary sandbox escalation for dependency-cache writes, loopback PostgreSQL, Chromium/Docker or tsx IPC; no approval rejection occurred.
- Hosted browser dashboard/accessibility/performance and live Telegram A–I: **NOT_RUN**. No new hosted p95 or approval-comprehension claim.

### Remaining work before any golden-path verdict

Implementation plan units 3–10 remain, plus the owner-facing portion of unit 2. These include durable ingress/rate limits/event admission, task interpretation, worker/gateway integration, production cryptographic bindings, per-task budget enforcement, execution and cleanup recovery, canonical approval creation/resumption, controlled target, same-identity replies, cancellation, retention, Connections UI and operational controls. Passing enrollment tests does not close these requirements.

The smallest external inputs requested are the non-secret configuration locations for the approved bot, selected owner/Agent, worker host and durable signer/storage bindings. If they do not exist, the owner must create/authorize the dedicated bot and approve the required hosting/signing resources. The separate execution profile question remains unanswered; the qualified private-preview fail-closed behavior is unchanged. Never substitute production-like claims using local signing keys.

Provider references checked: [Telegram webhook secret-token contract](https://core.telegram.org/bots/api#setwebhook) and [Telegram pairing deep links](https://core.telegram.org/bots/features#deep-linking).


## Cleanup and source-control handoff

- No Relay-labeled Docker sandbox containers remained (`docker ps -a --filter label=relay.resource=sandbox` returned no rows).
- No test Chromium/headless-shell executable remained in the process-name check.
- The disposable PostgreSQL cluster was stopped and removed; pre-existing PostgreSQL instances were untouched.
- The temporary dependency symlink was removed from the worktree after verification. Reinstall dependencies before subsequent tests.
- No temporary bot credentials, bot webhooks, hosted environments or approval fixtures were created, so there was nothing to revoke in those systems.
- Focused commits: `dc296d5` test path correction; `7097f00` Telegram transport defect correction; `cd2c298` enrollment/input/migration foundation. This document records the evidence separately.
- Feature branch may be pushed for preservation. A PR is intentionally withheld until required golden-path qualification is green. No merge is authorized.
