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
- Google OAuth: `BLOCKED_EXTERNAL_CONFIGURATION`. The configured refresh-token exchange returned `invalid_grant`. Issue a new offline refresh token for the configured OAuth client, confirm the Gmail and Calendar APIs and Relay read-only scopes are enabled, then run `pnpm qualify:google`.
- GitHub OAuth: `BLOCKED_EXTERNAL_CONFIGURATION`. Configure a registered OAuth App, its exact Relay callback URL, `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET`.
- Claude: `NOT_RUN`. The installed Claude CLI is not authenticated.
- Codex: `NOT_RUN`. No already-authorized disposable Relay Agent credential was available through the product flow for a live runtime check. Automated MCP runtime/session/credential correlation passed.

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
