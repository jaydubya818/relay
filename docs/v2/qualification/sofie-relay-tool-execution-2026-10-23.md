# Sofie → Relay → tool execution candidate — 2026-10-23

Status: **LOCAL SERVER-CONTRACT CANDIDATE**. Live MyEve adapter, HTTPS transport, and tester-chat execution are **NOT_RUN**. This does not change production aliases, Vercel env isolation, credentials, or spending controls.

## Upstream merge

- Relay PR #40 merged to `main` as `fce3f8fe48fae5114acf17704cbbdd549861c3d9` (squash of qualified `e1389c0eebb7314244cdd47463fdeed33971bbdf`).
- Post-merge GitHub Actions `40010427081` completed successfully on that SHA.
- Serving production is `dpl_BYbeQYt8hyFbsouAQiAgje1VJZCG` at `fce3f8f` (`target: production`, READY). Rollback anchor remains the previous production snapshot `dpl_EFzeN3YFu3ggVgrVKLAusNMV18Km` (`source: cli`, no git SHA in deployment metadata). No rollback, alias change, credential change, or project-setting change was made.
- Production trigger for `dpl_BYbeQYt8hyFbsouAQiAgje1VJZCG` remains **UNVERIFIED**. This agent ran `gh pr merge 40 --squash` at 12:18:50 PM PDT / 19:18:50Z; GitHub `mergedAt` is 12:18:53 PM PDT. The deployment `createdAt` is 12:27:04 PM PDT / 19:27:04Z. This log contains no Vercel CLI/MCP/API create or promote. Git source fields (`source: null`, github/`main`/`fce3f8f`, `githubDeployment=1`) and `vercel[bot]` deployment `7286965084` at 12:28:26 PM PDT do not distinguish automatic Git from an explicitly requested Git-backed deploy. `git.deploymentEnabled.main=false` was already on `fce3f8f`. The earlier claim that a prior CLI snapshot caused auto-promotion is withdrawn.
- After promotion, `/api/health` remains 200 with `database: ready`. The public login page no longer carries an email `value` attribute (live QA-01). Unique deployment URLs stay behind Vercel SSO (`prod_deployment_urls_and_all_previews`).
- This agent did not change Vercel/Neon credentials, databases, or spending flags. `DATABASE_URL` / Neon variables remain Production-only except the existing synthetic preview branch `codex/fq-relay-6384519e0e01`, which is not this candidate. PR #43 preview is not a production target and has no all-preview database URL.
- `#43` adds `ignoreCommand` for a later git push to `main`. That skip is not live on production until `#43` is merged; this coordination does not merge it.

## What this candidate proves locally

In-process Relay route handlers (`mcpPost` / `federationPost` via `Request`), against disposable PostgreSQL. This is server-contract coverage only. It does not import or execute MyEve `RelayClient`, open HTTPS, consume MyEve tester chats (#99 / `5895b129`), or grant production tools.

| Check | Result |
| --- | --- |
| `/mcp` GET discovery | Pass |
| Bearer `rly_` authenticate, `initialize`, `ping` | Pass |
| Invalid / revoked credential → HTTP 401 `INVALID_CREDENTIAL` / `REVOKED_CREDENTIAL` | Pass |
| Sofie principal is owner-account + agent name bound | Pass |
| `tools/list` advertises only granted tools; no Deep Agent tool | Pass |
| Authorized `relay_memory_add` / `list` / `search` returns JSON-RPC `result.content` | Pass |
| Retry of the same memory search does not change owner isolation | Pass |
| Ungranted GitHub / factory → JSON-RPC `CAPABILITY_DENIED` (HTTP 200, code `-32003`) | Pass |
| Granted GitHub without a connection → `CONNECTION_REQUIRED`; mocked GitHub list succeeds | Pass |
| Cross-account memory and GitHub connection isolation | Pass |
| Rotate then reconnect; revoke then deny | Pass |
| Private-preview keeps V2 runtime actions closed even if `RELAY_V2_ACTIONS_ENABLED=true` | Pass |
| `/api/v2/mcp` `tools/call` denied while actions are closed | Pass |
| In-process `POST /api/v2/federation` returns 503 `CAPABILITY_DENIED` in private-preview | Pass |
| In-process federation discover + identity + ungranted `message.send` + rotate/reconnect/revoke | Pass |

Evidence: `tests/integration/myeve-sofie-relay-tools.test.ts`. HTTP 200 JSON-RPC `CAPABILITY_DENIED` is proven on Relay's handler, not through MyEve's adapter. Existing budget, isolation, and federation golden-path suites remain the spending-limit and peer-message authority records.

## Client handshake / error contract (for the MyEve adapter owner; not implemented here)

MyEve `apps/eve/lib/relay/client.ts` only posts to `/api/v2/federation`. That path requires V2 runtime actions **and** `RELAY_FEDERATION_ENABLED=true`. Private-preview forces runtime actions off, so federation tool execution must stay closed on current production.

The private-preview-safe tool path is HTTPS `/mcp` with `Authorization: Bearer rly_…`:

- `initialize` / `ping` / `tools/list` / `tools/call`
- Grant-filtered tool advertisement
- Capability denials arrive as JSON-RPC errors with HTTP 200 (except 401 credential failures). Reusing `RelayClient.request()` as-is would treat `CAPABILITY_DENIED` as success because `response.ok` is true. MyEve needs an MCP client that reads `error.data.code`.

Do not point Sofie at `/api/v2/mcp`. That surface is V2 action execution and stays disabled in private-preview.

## Next steps (owner-gated; not started here)

Preserve production on `#40` / `fce3f8f` / `dpl_BYbeQYt8hyFbsouAQiAgje1VJZCG`. Preserve the two active MyEve tester chats on `#99` / `5895b129` and their chat-only bounds. Do not consume tester turns.

Real MyEve adapter plus transport-level identity/error/reconnect coverage is a distinct gap. HTTP 200 JSON-RPC error handling must be proven through that adapter. Coordinate the MyEve adapter implementation owner before starting it. Do not duplicate Relay implementation or grant production tools.

Safe disposable recipe, when that owner is ready: local/preview Relay only; Bearer `rly_` to `/mcp`; `initialize` / `tools/list` / one memory write / one search / rotate / revoke; no owner-session cookie on `/mcp`; no V2 actions or federation flags; no Deep Agent.

Merging this candidate is not paid execution and does not enable V2 actions.

## GHSA-mrhx-c7xc-m3w5 (dependency metadata, 2026-10-23)

Primary advisory: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5 (updated 2026-10-23T18:26:52Z). Range: npm `zod` `< 4.6.6`, first patched `4.6.6`. Latest official patched line at inspection: `4.6.7`. This is not a production incident and this record does not reproduce exhaustion.

**Tree at `43298bd` (before this correction):** direct pin `zod@3.25.76`; nested `@vercel/cli-config@0.2.3` → `zod@4.1.11`. No other zod copies.

**Official upstream:** the published fix is colinhacks/zod#6652 in the v4 parser, first released as `4.6.6`. There is no official Zod 3 backport; latest `zod@3` remains `3.25.76`, and the maintainer closed the v3 follow-up as “new versions of v3 are no longer being published.” Unofficial GitHub forks are not used.

**`b4e96fa` gap:** pinning `4.6.7` while importing `zod/v3` satisfied the advisory version range only. Official #6652 / `a0ebf97` changes `packages/zod/src/v4` only. The npm `4.6.7` `v3` `ZodArray._parse` body is SHA-256 `273e22bfded98b8856da82ecf4504ed7add7256eeb58b1fca05fd543ef745835`, identical to `3.25.76`. A lockfile/import version test or green `pnpm audit` is not runtime remediation for the v3 path.

**This source correction (`22aed7d`):** keep pin and `pnpm.overrides.zod` at official `4.6.7`. Application schemas now import the v4 default export (`zod`), which is the patched parser (`capSize` in `v4/core/schemas.js`). Compatibility edits: `z.record(value)` → `z.record(z.string(), value)`; split `agentPassportObjectSchema` so policy `pick()` does not use v3 `innerType()`; MCP tool args go through a `Record<string, unknown>` guard because v4 `ZodTypeAny` output is `unknown`. Deprecated `z.string().datetime()` and `z.ZodError` remain on the v4 classic API. This is a deliberate supported v4 API migration, not an unchanged dependency surface, and not a private-package patch.

**Local qualify of `22aed7d`:** `pnpm typecheck`, `pnpm lint`, `pnpm test:ci` (560 passed, 6 skipped), and `pnpm build` succeeded. Auth, isolation, capability-denial, passport, money, federation, and Sofie in-process MCP suites are included. This is not an audit-as-fix claim: `tests/unit/zod-advisory-tree.test.ts` requires v4 `_zod` instances, installed `capSize`, records the unpatched v3 parser SHA, and a two-element `.max(1)` `too_big` result.

**Residual risk, kept explicit:** #6652 only rejects oversized **bounded** arrays/sets/maps before walking elements. Unbounded containers remain uncapped even on 4.6.6+ (maintainer). This PR does not add new collection caps, does not ignore the advisory, and does not weaken gates. The v3 subpath is still present inside the 4.6.7 tarball and remains unpatched; application code must not import it.

Production aliases, grants, tester chats, and billing are unchanged by this source preparation. Merge/deploy of `#43` remain held.
