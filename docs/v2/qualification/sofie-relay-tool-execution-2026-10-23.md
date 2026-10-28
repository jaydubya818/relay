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

**Local qualify of `22aed7d`:** `pnpm typecheck`, `pnpm lint`, `pnpm test:ci` (560 passed, 6 skipped), `pnpm test:performance`, and `pnpm build` succeeded. Auth, isolation, capability-denial, passport, money, federation, and Sofie in-process MCP suites are included. This is not an audit-as-fix claim: `tests/unit/zod-advisory-tree.test.ts` requires v4 `_zod` instances, installed `capSize`, records the unpatched v3 parser SHA, and a two-element `.max(1)` `too_big` result.

**Independent review of `22aed7d`:** APPROVE, no findings, for the GHSA v4-parser requirement. Compatibility edits do not change auth, owner isolation, capability denial, accounting, or `INVALID_INPUT` mappings. Residual unbounded-container risk and the unpatched v3 tarball subpath remain explicit. Merge of `#43` stays held.

**Residual risk, kept explicit:** #6652 only rejects oversized **bounded** arrays/sets/maps before walking elements. Unbounded containers remain uncapped even on 4.6.6+ (maintainer). This PR does not add new collection caps, does not ignore the advisory, and does not weaken gates. The v3 subpath is still present inside the 4.6.7 tarball and remains unpatched; application code must not import it.

Production aliases, grants, tester chats, and billing are unchanged by this source preparation. Merge/deploy of `#43` remain held.

## Production dependency inventory (after `ccd3287`, source-only)

Root audited `ccd3287` with `pnpm audit --prod` (exit 1): one critical, three high, two moderate. Inventory only; not a reachability or live-incident claim. That audit is historical for this later tree.

Official smallest supported corrections, staying on Next 15.5 maintenance:

| Advisory | Module at `ccd3287` | Official patched line | This tree |
| --- | --- | --- | --- |
| GHSA-2464-fhr4-w9xw (critical) | `next@15.5.24` | `next@15.5.28` | `15.5.28` |
| GHSA-p3m5-59mp-jv5r (high) | `next@15.5.24` | `next@15.5.28` | `15.5.28` |
| GHSA-4jqv-mc3x-m676 / GHSA-mcj8-r9mp-w47p (moderate cache) | `next@15.5.24` | `next@>=15.5.27` | `15.5.28` |
| GHSA-68fv-2mgg-jv7q (high) | `source-map-js@1.2.1` via `postcss@8.5.23` | `>=1.2.2` | override `1.2.2` |
| GHSA-wq5f-xc86-pv6w (high) | `sharp@0.35.4` via Next | `>=0.35.5` | `next>sharp` `0.35.5` |

`next@15.5.28` `optionalDependencies.sharp` is `^0.34.3 || ^0.35.5`. Pinning `0.35.5` is the supported 0.35 patch. A Next 16 / sharp 0.36 framework migration is not required. Existing `next>postcss: 8.5.23` is unchanged. `eslint-config-next` stays on the same 15.5.28 line. No advisory ignore, no `patchedDependencies`, no auth/OIDC downgrade, no exploit reproduction.

**Local qualify of `2ea19ce`:** `pnpm typecheck`, `pnpm lint`, `pnpm test:ci` (564 passed, 6 skipped), `pnpm build` (`Next.js 15.5.28`). Performance assertions passed (2/2); local process exit 1 was leftover `DROP DATABASE … FORCE` `57P01` pg events, not assertion failures. `pnpm audit --prod` is empty after the pins; that is corroboration of the version range, not a substitute for the lockfile/import contract in `tests/unit/production-advisory-tree.test.ts`. GitHub quality and owner-browser re-run on this SHA.

**Independent review of `2ea19ce`:** APPROVE, no findings, for the production-pin requirement. Official 15.5.28 / sharp 0.35.5 / source-map-js 1.2.2 match the GHSA first-patched lines. Residual notes only: optional/transitive metadata resolution is lockfile-durable; `.npmrc` audit-ignore is absent and not asserted. Merge of `#43` stays held.

`ccd3287` evidence remains historical and is not a PASS for this changed dependency surface.

## Canonical unified lineage reconciliation (same PR, 2026-10-23)

MyEve `a82fbfacb6a9300d1880db022efd922bb8ffabc8` (`codex/beta-qa-adoption-20261023` / PR #101) composed against selected Relay `f7264e0a8df036c5fb505b61c55ad978f5a81f9e` failed before the real contracts: `f7264e0` lacked `lib/v2/policy/ordering.ts` (`advanceRelayPolicyFence` / `flushRelayPolicyFences` / `forwardOwnerPolicyFence`) and `V2PlatformBindings.remoteCapabilityPreparation`. Official unpaid run `40046116881` / job `120728121159` is that import gap. Production `fce3f8f` is unchanged. This is not an incident claim.

**Reused canonical identity, not a competing tree.** Merge-base with this PR is `f340f1a29d09d3cc114577270972a91774a31fa2`. Canonical `231b286c909856914c9eeb369dd4d320006e410c` descends `b25a90c3ebeaeff731c26690e289331142dae904` and includes `12dec6dd1ecb2628fded8393cc2cd8da7fcd493e` (complete action identity/replay) and `5f77f85bc64af81f79bc93ec78287c6816360ec8` (canonical MyEve fixture isolation). First merge commit on this PR: `6f881e4e0d71a567d1047d0827a1fa2416d12328` (parents `f7264e0` + `231b286`).

**Conflict files (4):** `lib/v2/passports.ts`, `package.json`, `pnpm-lock.yaml`, `vercel.json`. Drizzle `0000`–`0028` (59 files): 0 hash mismatches. No SQL rewrite, no new production migration.

| Keep from this PR | Take from `231b286` | Not taken |
| --- | --- | --- |
| Sofie/MCP tests, QA remediations, `ignoreCommand` | policy-fence/admission, remote-capability preparation, native receiving, identity/replay, UNKNOWN retention, default-denial | `patchedDependencies` / `.pnpmfile.cjs` for `@next/eslint-plugin-next@15.5.27` |
| `zod@4.6.7` v4 default export; passport `agentPassportObjectSchema.pick()` (no `innerType()`) | Vitest `4.1.12`, Vite `7.3.7`, `typescript-eslint` `8.48.0`, engines `>=22.12.0`, brace-expansion / esbuild overrides | Next `15.5.27` |
| `next` / `eslint-config-next` `15.5.28`, `next>sharp` `0.35.5`, `source-map-js` `1.2.2`, `undici@8.12.3` | ordered fence routes and tests | private plugin patch that swapped `fast-glob` for `tinyglobby` |

Vite `7.3.7` is a direct devDependency as well as an override: the inherited lockfile did not re-resolve the override alone (`7.3.6` remained until the direct pin).

**`3ca9a59` is HISTORICAL / UNSELECTED, not a freeze.** Docs blob `c74d2604dc3c9968d10ce7b50a719ee778c0517d` lines 119/123 recorded **673 passed / 8 skipped** and “two nested-brace glob patterns … stay skipped” as current. Those two skips were 3ca-only. `67a8fc6` inherited that same docs blob (`c74d2604`); the 673/8 text was a handoff mismatch against 67a source, which has **no such skips**.

## Publication guard, Node 24 owner-browser, withdrawn braces advisory (`67a8fc6`)

**`vercel.json` blob `711756ef6c31dc0d94fb9eff8ad2668a426c52bc`:** `git.deploymentEnabled["cursor/sofie-relay-tool-execution-e098"]=false`. Existing keys preserved. 6f blob `83b7cc40d9e7325a70fe42b7ef6785ae41e9a0dd` remains historical and did not contain this branch. `ignoreCommand` still only matches `main`.

**Owner-browser workflow:** Node `22.5.0` → `24`. Official browser `40047434097` SUCCESS on `6f881e4` at Node 22.5.0 is retained and is **not** supported-runtime qualification.

**Official 6f quality `40047434000` / job `120732260306`:** 674 PASS / 6 SKIP / 1 FAIL at `tests/security/braces-depth.test.mjs` expecting plugin `15.5.27` / `{ tinyglobby: "0.2.17" }` / lockfile absence of `fast-glob`/`micromatch`/`braces`. Install, audit, frontier, dbcheck, types, lint PASS; performance/build SKIPPED. That fail is retained history.

**Unavoidable public-replacement conflict:** official `@next/eslint-plugin-next@15.5.28` depends on `fast-glob@3.3.1` (lock also has `micromatch@4.0.8` and `braces@3.0.3`). npm `16.4.3` still depends on `fast-glob@3.3.1`. There is no supported public tinyglobby replacement on the Next 15.5.28 line. Graph-absence required the 15.5.27 `patchedDependencies` hook, which this tree does not take. Do not restore 15.5.27, alias, or audit-ignore.

**GHSA-vfj7-8cjw-p6xm** withdrawn 2026-10-23T12:53:02Z (not practically exploitable). Do not call `braces@3.0.3` an active high finding. Successor test records official 15.5.28 identity, no `patchedDependencies`/aliases/`auditConfig`, `typescript-eslint@8.48.0` tinyglobby, and ordinary glob compatibility. Nested-pattern exhaustion cases are retired with that withdrawn advisory, not skipped. Empty `pnpm audit` is not chain-absence.

**Retired-case accounting (ordinary `test:ci`):** 6f official `40047434000` = 674 PASS + 6 SKIP + 1 FAIL (681). 3ca local = 673 PASS + 8 SKIP (681; the extra 2 skips are UNSELECTED). 67a retirement of 6 exhaustion cases + 1 metadata pass = **669 PASS + 6 SKIP** (675). No new skips on 67a.

**Official runs (do not treat cancelled 67a quality as PASS):**

| Run | SHA | Result |
| --- | --- | --- |
| Quality `40047434000` / `120732260306` | `6f881e4` | 674 PASS / 6 SKIP / 1 FAIL (history) |
| Browser `40047434097` | `6f881e4` | SUCCESS at Node 22.5.0 (history; not this runtime) |
| Quality `40049825143` | `67a8fc6` | **cancelled** mid-`test:ci` |
| Browser `40049825062` / `120739812233` | `67a8fc6` | SUCCESS, Node **v24.21.0**, 18 passed |
| Quality `40050392088` / `120741661102` | `f05a563` (67a source + docs) | SUCCESS: frozen install, audit, frontier, dbcheck, types, lint, **669 passed / 6 skipped**, performance 2/2, Next.js 15.5.28 build |
| Browser `40050392065` | `f05a563` | SUCCESS, Node **v24.21.0**, 18 passed |

Graph-absence security qualification stays **HOLD** for independent review of the 67a successor contract. Empty `pnpm audit` is not chain-absence. 3ca 673/8 is not current.

**`createRequire` contract for a82's missing imports:** `advanceRelayPolicyFence` / `flushRelayPolicyFences` / `forwardOwnerPolicyFence` resolve as functions from `lib/v2/policy/ordering.ts`; `configureV2PlatformBindings` accepts `remoteCapabilityPreparation`. Relay's own composed harness uses `createRequire`. a82 ESM `import()` loader seam stays with the MyEve sole writer. This tree does not repin MyEve.

Merge/deploy, grants, testers, billing, and production aliases stay held. Broader MissionControl remains deferred.
