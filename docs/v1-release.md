# Relay V1 release candidate

Relay V1 preserves one invariant: Accounts own durable capabilities, Agents receive scoped authority, and runtimes remain replaceable.

## Capability inventory

The release contains 26 canonical capabilities covering durable memory, GitHub repository reads, Gmail reads, Google Calendar reads, sandbox lifecycle/execution/files, isolated browser sessions, Agent inbox actions, and capability discovery. Dynamic MCP projection remains grant-driven; direct calls are centrally authorized again.

## Production services

Deploy the web/API service, PostgreSQL, the maintenance worker, high-entropy secret management, a conforming sandbox provider, and a conforming browser provider. Docker and Playwright are initial self-hosted adapters, not public contract dependencies. Object storage is required before sensitive external event payload bodies are retained.

## Qualification evidence

- PostgreSQL migrations are checked in, clean-database tested, and idempotent.
- Cross-account, Agent-private resource, credential, OAuth-state, connector-revocation, log-redaction, rate-limit, MCP-projection, and session-attribution tests pass.
- The final automated golden path covers memory, GitHub, Google reads, sandbox, browser, events/inbox, credential replacement, connector disconnect, and Activity.
- Live Docker qualification covers isolation, resource limits, network denial, bounded output, timeout, files, secret absence, and cleanup.
- Live Playwright qualification covers context isolation, interactions, extraction, screenshots, cleanup, and private-network denial.
- Modest concurrency qualification runs 64 simultaneous Agent operations with event retry deduplication and PostgreSQL pool inspection.
- Browser E2E covers all V1 dashboard routes, populated and empty states, inbox state transition, authentication, and local route performance.

Final local results on 2026-09-13:

- 39 default-suite tests passed and 3 live-only tests skipped by default; the same 3 live tests passed separately against Docker and Chromium.
- 2 performance tests and 3 browser E2E tests passed.
- The 64-operation concurrency run measured p50 35.81 ms, p95 38.25 ms, p99 38.64 ms, 0% errors, and a settled PostgreSQL pool of 10 total / 10 idle / 0 waiting connections.
- PostgreSQL overview/activity reads measured p95 1.18 ms over 50 samples.
- Every critical dashboard route remained below 154 ms p95 locally; the slowest was Overview at 153.36 ms.
- Clean-schema migration tests, two consecutive migration applications, two consecutive seed runs, production build/start, liveness, readiness, provider health, MCP routing, web shutdown, worker startup/cycles/shutdown, and resource cleanup passed.

## Live-provider status

- Docker: `PASSED`.
- Playwright/Chromium: `PASSED`.
- Google OAuth: `PASSED LIVE`. Investigation found that no Google OAuth client had ever been configured for this deployment; the prior report's `invalid_grant` diagnosis was superseded. A dedicated Google Cloud project ("Relay Local Qualification") was created with only the Gmail and Calendar APIs enabled, a Testing-mode OAuth consent screen scoped to exactly four read-only scopes (`openid`, `email`, `gmail.readonly`, `calendar.readonly`), and a Web application OAuth client with redirect URI `/api/connections/google/oauth/callback`. The real product-flow OAuth connect completed live against the account `jaydubya818@gmail.com`, after a data-entry defect (a mis-transcribed `GOOGLE_CLIENT_ID` in `.env.local` — not a Relay code defect) was found and corrected. `relay_email_search`, `relay_email_read`, `relay_calendar_event_list`, `relay_calendar_event_read`, and `relay_calendar_availability_read` all succeeded live for the granted Agent (Claude Agent). The ungranted Agent (Codex Agent) was correctly denied with `CAPABILITY_DENIED` on `email.search`; after granting that capability, the same call succeeded. Disconnecting the connection correctly produced `CONNECTION_REQUIRED` on the next capability call; reconnecting restored `SUCCESS`. Stored access/refresh tokens are opaque ciphertext at rest. `pnpm qualify:google` passed live: `{"qualification":"google-readonly-live","oauthRefresh":200,"gmailProfile":200,"gmailSearch":200,"calendarEvents":200}`.
- GitHub OAuth: `PASSED LIVE`. A registered OAuth App (`Relay Local Qualification`) was configured with a live client ID/secret. The full product-flow OAuth connect completed against the real GitHub account "Jarrett West" (external ID `50925625`, scopes `read:user, repo`). `relay_github_repo_list` succeeded live for the granted Agent (Claude Agent, 50 real repositories returned) and was denied with `CAPABILITY_DENIED` for the ungranted Agent (Codex Agent). Disconnecting the connection correctly produced `CONNECTION_REQUIRED` on the next capability call; reconnecting restored the call to `SUCCESS`. The stored access/refresh tokens are opaque ciphertext at rest (not the raw GitHub token), consistent with encryption-at-rest.
- Claude: `PASSED LIVE` (2026-09-13, Claude Cowork run). Claude Code CLI 2.1.81, authenticated as `jaydubya818@gmail.com`, called the real `relay-v1-qualification` MCP server (user-scoped, `http://localhost:3000/mcp`) via `claude -p`. Full detail in "Final live cross-Agent qualification" below.
- Codex: `PASSED LIVE`. A real Codex CLI qualification was completed against Relay MCP. Jay verified the resulting Agent, Session, Memory, credential-revocation, and Activity records directly in Relay's persisted PostgreSQL state (`relay_e2e_playwright`). Evidence: Agent `agt_f23ff83728944ddd8960fd1bfd75ef08`; Session `ags_aa313b8103d745a483ac8bc2d5850ba4`; Memory `mem_72f67539fe4a47d686f72fb1034979be`; credential prefix `rly_tt5mExEL`; `memory.add`/`memory.write` SUCCESS (2 ms); `memory.search`/`memory.read` SUCCESS (2 ms); credential revoked at `2026-09-13 10:13:19.592-07`; post-revocation `initialize` DENIED; post-revocation `tools/list` DENIED. Relay currently records the client runtime generically as `mcp`, not specifically `codex` — a known attribution limitation. A second real Codex CLI (OpenAI Codex v0.153.3) run, independently re-verified against PostgreSQL by Claude Cowork in this session, is recorded in "Final live cross-Agent qualification" below.

## Final live cross-Agent qualification — 2026-09-13 (Claude Cowork run)

Performed by Claude Cowork with real local process execution on Jay's Mac (Desktop Commander `start_process`/`interact_with_process`, after the device-shell bridge (`device_bash`) was confirmed broken and explicitly replaced per Jay's authorization). All calls below are live against the running `next dev` server on `http://localhost:3000` and the persisted `relay_e2e_playwright` PostgreSQL database.

- **Claude Code → Relay MCP, live**: Claude Code CLI 2.1.81 (authenticated as `jaydubya818@gmail.com`) called the user-scoped `relay-v1-qualification` MCP server (agent `agt_374e01a36b704905a250929442eba9ca`, "Relay Claude V1 Qualification") via `claude -p`. It wrote a SHARED/FACT memory (`mem_92d58df265d74536bac4af3ed922fc4e`: "Relay V1 live qualification confirms Project Atlas uses Node 24.") and an AGENT_PRIVATE/OTHER memory (`mem_9973418ca16641ffacdfeb794cd4496c`: "RELAY-V1-PRIVATE-CLAUDE-ONLY"), then listed memories and confirmed both were retrievable by itself. Session `ags_1f2d665880b041d1969f9a7816496d4e`.
- **Claude → Codex shared-memory continuity, live**: OpenAI Codex CLI v0.153.3 called the `relay-v1-continuity` MCP server (agent `agt_692503af5be047b08669364bde60aa39`, "Relay Codex V1 Continuity Qualification", freshly rotated credential) via `codex exec`. It searched SHARED memory, found the Project Atlas fact, and correctly reported "Node.js 24" in its final answer, verbatim. Session `ags_a2db91140b0b47288328751eaf41662a`.
- **Claude-private memory isolation from Codex, live**: in the same Codex run, Codex then attempted `relay_memory_get` on Claude's private memory ID (`mem_9973418ca16641ffacdfeb794cd4496c`) despite holding `memory.read`. Relay returned `{"code":"INVALID_INPUT","capability":"memory.read","message":"Memory not found."}` — the private memory is invisible to another Agent even without an explicit deny, not merely ungranted. Activity recorded as `FAILED`.
- **Cross-Agent GitHub grant/deny/grant, live**: using freshly rotated credentials for the original "Claude Agent" (`agt_2fdc03e54091485190f0a3b281c22e4b`, `github.repo.read=ALLOW`) and "Codex Agent" (`agt_95d1f67b698f40dc903d01cace03a884`, `github.repo.read=DENY`), direct MCP JSON-RPC `tools/call` for `relay_github_repo_list` against the real, already-connected GitHub account "Jarrett West" returned: Claude Agent → `SUCCESS` (real repository data); Codex Agent → `{"code":"CAPABILITY_DENIED","capability":"github.repo.read"}`. The grant was then flipped to `ALLOW` via `PUT /api/agents/.../capabilities/github.repo.read`, and the identical call for Codex Agent → `SUCCESS`. The grant was reverted to `DENY` immediately afterward to restore the documented baseline. Sessions `ags_e506f96da0c04c06ae7c9f5ec2cdd4eb` (Claude) and `ags_c52f6256d99f4507b3a7940d93a65411` (Codex).
- **Temporary credential revocation, live**: all credentials minted for this qualification pass — the "Relay Claude V1 Qualification" cred, the "Relay Codex V1 Continuity Qualification" cred, and the rotated "Claude Agent"/"Codex Agent" GitHub-test creds — were revoked via `DELETE /api/agents/.../credentials`. A subsequent `initialize` call with a revoked credential returned `401` with `{"code":"REVOKED_CREDENTIAL","message":"This Relay credential has been revoked."}`, confirmed for two independent revoked credentials.
- **PostgreSQL durable evidence, live**: `agent_sessions` and `activities` were queried directly and match every call above exactly, in order: two `memory.write` SUCCESS + one `memory.read` SUCCESS on the Claude qualification session; `memory.read` SUCCESS (search) / FAILED (denied private get) / SUCCESS / SUCCESS / FAILED on the Codex continuity session; `github.repo.read` SUCCESS on the Claude Agent session; `github.repo.read` DENIED then SUCCESS on the Codex Agent session; and two `agent.authenticate` DENIED entries timestamped at the revocation-proof calls. No implementation defect was found.
- **Final regression, live**: run with `NODE_ENV=test` (the ambient shell exports `NODE_ENV=production` globally, which is unrelated to Relay and was overridden inline, not modified). `pnpm typecheck` and `pnpm lint` passed. `pnpm test` passed 39/39 non-live tests (3 live-only tests skipped by default, as designed). `pnpm test:performance` passed both tests, including the 64-operation concurrency benchmark (p50 35.64 ms, p95 37.08 ms, p99 37.49 ms, 0% errors, pool 10/10 idle). `pnpm build` (production) completed successfully. Docker/Playwright live-provider and browser-E2E qualification were not re-run in this pass since they were already qualified live earlier the same day (see "Final external qualification" above) and Jay's instructions were not to re-run already-qualified provider qualification.

## Final external qualification — 2026-09-13

Qualification baseline HEAD: `c2460e5c7e59151ddf7d0ca1b5c04a25ce38999b`. The release-report update is the commit containing this section.

No implementation defect was found. The final external status is:

- Docker sandbox: `PASSED` against the real local Docker provider.
- Playwright browser: `PASSED` against real Chromium isolated contexts.
- GitHub OAuth: `PASSED LIVE`. Live product-flow OAuth connect, capability ALLOW/DENY enforcement, disconnect/reconnect, and encrypted-token-at-rest storage were all verified against the real GitHub account "Jarrett West" (external ID `50925625`). See Live-provider status for evidence detail.
- Google OAuth: `PASSED LIVE`. See Live-provider status for full evidence: a dedicated Google Cloud OAuth client scoped to Gmail/Calendar read-only was created, the live product-flow connect succeeded for `jaydubya818@gmail.com`, Agent capability ALLOW/DENY enforcement and disconnect/reconnect were verified live, and `pnpm qualify:google` passed. No Relay implementation defect was found; OAuth validation was not weakened.
- Claude MCP: `PASSED LIVE` (2026-09-13, Claude Cowork run). Claude Code is authenticated as `jaydubya818@gmail.com` and completed a real MCP round trip against Relay. See "Final live cross-Agent qualification" above.
- Codex MCP: `PASSED LIVE`. A real Codex CLI qualification was completed against Relay MCP. Jay verified the resulting Agent, Session, Memory, credential-revocation, and Activity records directly in Relay's persisted PostgreSQL state, and Claude Cowork independently re-verified a second live Codex CLI run against PostgreSQL in this session (see "Final live cross-Agent qualification" above). Relay persisted the runtime generically as `mcp`, which remains a known attribution limitation.
- Live cross-Agent golden path: `PASSED LIVE` (2026-09-13, Claude Cowork run). Live Claude Code and Codex CLI identities exercised shared-memory continuity, private-memory isolation, and cross-Agent GitHub grant/deny/grant against the real, already-connected GitHub account. See "Final live cross-Agent qualification" above.

All required live qualification has now passed, including the live cross-Agent golden path (see "Final live cross-Agent qualification" above). The release-candidate tag was still not created in this pass, per explicit instruction to stop short of tagging; `relay-v1.0.0-rc.1` is recommended pending explicit Product Owner approval.

Final regression remained green: typecheck and lint passed; 39 default-suite tests passed with 3 live-only tests skipped by default; 2 performance tests, 3 browser E2E tests, and all 3 separately enabled live Docker/Chromium tests passed. Total qualified tests remain 47 with zero failures. Migrations applied twice, seed completed idempotently, the production build and startup passed, liveness/readiness/provider health returned 200, MCP rejected an invalid credential canonically, and the worker completed cleanup cycles and handled SIGINT.

Current browser route results over 20 warm samples:

| Route | p50 | p95 | p99 |
| --- | ---: | ---: | ---: |
| `/` | 151.58 ms | 158.38 ms | 170.20 ms |
| `/agents` | 37.59 ms | 42.35 ms | 42.84 ms |
| `/memory` | 34.24 ms | 37.90 ms | 38.78 ms |
| `/connections` | 35.41 ms | 39.49 ms | 39.87 ms |
| `/sandboxes` | 32.72 ms | 38.10 ms | 38.28 ms |
| `/browsers` | 32.64 ms | 37.42 ms | 39.58 ms |
| `/events` | 33.67 ms | 37.93 ms | 38.61 ms |
| `/activity` | 35.12 ms | 39.25 ms | 40.37 ms |
| `/developer` | 32.55 ms | 43.75 ms | 68.13 ms |

## External OAuth setup

GitHub requires a registered OAuth App with `/api/connections/github/oauth/callback`. Google requires enabled Gmail and Calendar APIs, an OAuth consent screen, read-only scopes, and `/api/connections/google/oauth/callback`. Live checks must be reported as blocked—not passed—when these external requirements are unavailable.

## Known limitations

- Password reset, email verification, MFA, invitations, enterprise RBAC, and distributed rate limiting are deferred.
- Wake requests are queued but do not launch arbitrary runtimes.
- Playwright sessions are process-local; a restart invalidates live contexts.
- Docker socket security and cleanup-worker supervision are operator responsibilities.
- Gmail and Calendar are read-only.
- Managed execution/browser providers, multi-region operation, billing, marketplace, messaging, wallet, and computer capabilities are deferred beyond V1.

## Proposed tag

`relay-v1.0.0-rc.1` after explicit Product Owner approval. All V1 acceptance criteria, final regression, and live qualification (including the live cross-Agent golden path) have passed as of 2026-09-13. This completion pass does not merge or tag automatically.

## Post-deploy monitoring and validation

For the first 24 hours, the release owner should watch readiness and provider-health responses, worker `maintenance_failed` events, capability failure/denial rates, PostgreSQL pool waiting connections, p95 dashboard latency, and expired resources that remain active. Healthy means readiness stays green, provider failures remain isolated, pool waiting remains at zero under ordinary load, and cleanup converges each cycle. Roll back the web and worker release if migration readiness fails, cross-account/security checks regress, the pool remains saturated, or resource cleanup repeatedly fails; keep the forward-compatible database migration applied unless a separately reviewed rollback proves safe.
