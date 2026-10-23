# Sofie → Relay → tool execution candidate — 2026-10-23

Status: **LOCAL SERVER-CONTRACT CANDIDATE**. Live MyEve adapter, HTTPS transport, and tester-chat execution are **NOT_RUN**. This does not change production aliases, Vercel env isolation, credentials, or spending controls.

## Upstream merge

- Relay PR #40 merged to `main` as `fce3f8fe48fae5114acf17704cbbdd549861c3d9` (squash of qualified `e1389c0eebb7314244cdd47463fdeed33971bbdf`).
- Post-merge GitHub Actions `40010427081` completed successfully on that SHA.
- Serving production is `dpl_BYbeQYt8hyFbsouAQiAgje1VJZCG` at `fce3f8f` (`target: production`, READY). Rollback anchor remains the previous production snapshot `dpl_EFzeN3YFu3ggVgrVKLAusNMV18Km` (`source: cli`, no git SHA in deployment metadata). No rollback, alias change, credential change, or project-setting change was made.
- Cause of the #40 promotion: the merge was a GitHub push onto `main`, which this project tracks as the Production branch. Vercel Git creates a Production deployment on merge to that branch and, with default `github.autoAlias`, assigns the public aliases. `vercel.json` on `fce3f8f` already had `git.deploymentEnabled.main=false` (since `88bd2e8`, 2026-09-20). That file-level skip did not prevent this Git production deploy. The snapshot being replaced was CLI-origin, not a prior Git production deploy, so the Git app applied production-branch auto-deploy rather than honoring the repo exclusion for this promotion. Dashboard Git settings were not modified to confirm the production-branch toggle.
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
