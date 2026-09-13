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
- Claude: `NOT_RUN`. The installed Claude CLI is not authenticated.
- Codex: `PASSED LIVE`. A real Codex CLI qualification was completed against Relay MCP. Jay verified the resulting Agent, Session, Memory, credential-revocation, and Activity records directly in Relay's persisted PostgreSQL state (`relay_e2e_playwright`). Claude Cowork was unable to independently re-query those records in this session because local shell execution (`device_bash`) remained unavailable. Evidence: Agent `agt_f23ff83728944ddd8960fd1bfd75ef08`; Session `ags_aa313b8103d745a483ac8bc2d5850ba4`; Memory `mem_72f67539fe4a47d686f72fb1034979be`; credential prefix `rly_tt5mExEL`; `memory.add`/`memory.write` SUCCESS (2 ms); `memory.search`/`memory.read` SUCCESS (2 ms); credential revoked at `2026-09-13 10:13:19.592-07`; post-revocation `initialize` DENIED; post-revocation `tools/list` DENIED. Relay currently records the client runtime generically as `mcp`, not specifically `codex` — a known attribution limitation.

## Final external qualification — 2026-09-13

Qualification baseline HEAD: `c2460e5c7e59151ddf7d0ca1b5c04a25ce38999b`. The release-report update is the commit containing this section.

No implementation defect was found. The final external status is:

- Docker sandbox: `PASSED` against the real local Docker provider.
- Playwright browser: `PASSED` against real Chromium isolated contexts.
- GitHub OAuth: `PASSED LIVE`. Live product-flow OAuth connect, capability ALLOW/DENY enforcement, disconnect/reconnect, and encrypted-token-at-rest storage were all verified against the real GitHub account "Jarrett West" (external ID `50925625`). See Live-provider status for evidence detail.
- Google OAuth: `PASSED LIVE`. See Live-provider status for full evidence: a dedicated Google Cloud OAuth client scoped to Gmail/Calendar read-only was created, the live product-flow connect succeeded for `jaydubya818@gmail.com`, Agent capability ALLOW/DENY enforcement and disconnect/reconnect were verified live, and `pnpm qualify:google` passed. No Relay implementation defect was found; OAuth validation was not weakened.
- Claude MCP: `BLOCKED_EXTERNAL_CONFIGURATION`; Claude Code is installed but reports `loggedIn: false`.
- Codex MCP: `PASSED LIVE`. A real Codex CLI qualification was completed against Relay MCP. Jay subsequently verified the resulting Agent, Session, Memory, credential-revocation, and Activity records directly in Relay's persisted PostgreSQL state. Claude Cowork was unable to independently re-query those records in this session because local shell execution remained unavailable. Relay persisted the runtime generically as `mcp`, which remains a known attribution limitation.
- Live cross-Agent golden path: `NOT_RUN`; it depends on live Claude and Codex identities plus GitHub and Google connections.

The release-candidate tag was not created because all required live qualification did not pass. After the external credentials and authorization are supplied, repeat the live runtime and cross-Agent path before creating `relay-v1.0.0-rc.1`.

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

`relay-v1.0.0-rc.1` after explicit Product Owner approval. This completion pass does not merge or tag automatically.

## Post-deploy monitoring and validation

For the first 24 hours, the release owner should watch readiness and provider-health responses, worker `maintenance_failed` events, capability failure/denial rates, PostgreSQL pool waiting connections, p95 dashboard latency, and expired resources that remain active. Healthy means readiness stays green, provider failures remain isolated, pool waiting remains at zero under ordinary load, and cleanup converges each cycle. Roll back the web and worker release if migration readiness fails, cross-account/security checks regress, the pool remains saturated, or resource cleanup repeatedly fails; keep the forward-compatible database migration applied unless a separately reviewed rollback proves safe.
