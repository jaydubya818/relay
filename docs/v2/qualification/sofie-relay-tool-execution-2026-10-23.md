# Sofie → Relay → tool execution candidate — 2026-10-23

Status: **LOCAL CANDIDATE QUALIFIED**. Live MyEve-to-hosted-Relay tool execution is **NOT_RUN**. This does not change production, Vercel env isolation, credentials, or spending controls.

## Upstream merge

- Relay PR #40 merged to `main` as `fce3f8fe48fae5114acf17704cbbdd549861c3d9` (squash of qualified `e1389c0eebb7314244cdd47463fdeed33971bbdf`).
- `vercel.json` keeps `git.deploymentEnabled.main=false`. The merge did not deploy production.
- Hosted production aliases `https://relay-jaydubya818.vercel.app` and `https://relay-sage-nine.vercel.app` remain healthy (`/api/health` 200, `database: ready`) on the pre-merge deployment. QA-01 (login email prefill) is still live until an authorized production deploy of the merged SHA.

## What this candidate proves locally

Relay's MyEve-facing surfaces, against disposable PostgreSQL, with no paid providers:

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
| MyEve `RelayClient` path `/api/v2/federation` returns 503 `CAPABILITY_DENIED` in private-preview | Pass |
| Local federation discover + identity + ungranted `message.send` + rotate/reconnect/revoke | Pass |

Evidence: `tests/integration/myeve-sofie-relay-tools.test.ts`. Existing budget, isolation, and federation golden-path suites remain the spending-limit and peer-message authority records.

## Contract MyEve must implement for beta tools

MyEve `apps/eve/lib/relay/client.ts` only posts to `/api/v2/federation`. That path requires V2 runtime actions **and** `RELAY_FEDERATION_ENABLED=true`. Private-preview forces runtime actions off, so federation tool execution must stay closed on current production.

The private-preview-safe tool path is HTTPS `/mcp` with `Authorization: Bearer rly_…`:

- `initialize` / `ping` / `tools/list` / `tools/call`
- Grant-filtered tool advertisement
- Capability denials arrive as JSON-RPC errors with HTTP 200 (except 401 credential failures). Reusing `RelayClient.request()` as-is would treat `CAPABILITY_DENIED` as success because `response.ok` is true. MyEve needs an MCP client that reads `error.data.code`.

Do not point Sofie at `/api/v2/mcp`. That surface is V2 action execution and stays disabled in private-preview.

## Next steps to enable Relay tools in the active MyEve beta

These are owner/MyEve steps. They are not authorized by this Relay candidate.

1. Keep production on the current deployment until Jay explicitly deploys `fce3f8f` (or a later SHA). That deploy is what remediates live QA-01; this work does not deploy it.
2. In MyEve, add an MCP client for `{MYEVE_RELAY_ORIGIN}/mcp` using the existing per-agent `rly_` connection credential. Do not send the owner session cookie to `/mcp`. Keep the current federation client unchanged.
3. Pin origin checks already in `relayOrigin()`: HTTPS, no credentials, no path/query/hash. Local HTTP remains a development-only exception.
4. First live grant on a disposable Sofie agent: `memory.read` and `memory.write` only. Do not grant GitHub, Gmail, sandbox, browser, or factory until that memory path is observed in Relay Activity.
5. Exercise `initialize`, `tools/list`, one `relay_memory_add`, one `relay_memory_search`, credential rotation, and revoke against a **preview** Relay, not production. Confirm JSON-RPC denials for ungranted tools.
6. Leave `RELAY_DEPLOYMENT_MODE=private-preview`, `RELAY_V2_ACTIONS_ENABLED=false`, and `RELAY_FEDERATION_ENABLED` unchanged unless a separate production authorization is recorded. Do not raise budget ceilings or attach paid providers for this milestone.
7. After preview evidence, decide whether production Sofie gets memory-only MCP. GitHub/factory remain owner-opt-in and require their existing connection + grant checks.
8. Deep Agent is still absent from deployable Relay/MyEve code. Do not advertise or enable it.

Merging this candidate is not production enablement and not paid execution.
