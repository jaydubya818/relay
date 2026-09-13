---
status: ready
priority: p1
issue_id: "001"
tags: [relay-v1, postgres, auth, providers, events, mcp]
dependencies: []
---

# Relay V1 production capability plane

## Problem Statement

Relay V0 proves the Account → Agent → grant → MCP model on one SQLite-backed node. V1 must make that model durable and deployable while adding governed execution, browser, event, inbox, and read-only Google capabilities.

## Findings

- V0 is qualified and protected by `relay-v0.1.0` at `9fbdca418c37f0187cb4ea3a30ff0fc21cac39d9`.
- The current persistence layer uses synchronous `node:sqlite` queries throughout the service layer, so PostgreSQL requires an explicit async conversion.
- Provider-neutral connector boundaries already exist and should be extended to sandbox and browser execution.
- Docker and Playwright are approved only as initial adapters, not canonical domain dependencies.

## Proposed Solutions

### Approved: provider-neutral, self-hostable V1

Use PostgreSQL + Drizzle, `DockerSandboxProvider`, and `PlaywrightBrowserProvider` behind canonical provider interfaces. Preserve permission-driven MCP projection and provider-independent Activity.

### Rejected for V1: managed execution providers

E2B and Browserbase would reduce infrastructure work but introduce premature vendor coupling before Relay's contracts are qualified.

## Recommended Action

Deliver V1 in focused, independently qualified commits: persistence, auth/connectors, sandbox/browser, events/inbox, Google reads, UI/observability, then full golden-path and live qualification.

## Acceptance Criteria

- [x] PostgreSQL and Drizzle replace SQLite production persistence with migrations and isolated tests.
- [x] Multiple human users and accounts are isolated with durable secure sessions.
- [x] GitHub OAuth is primary while optional PAT development setup remains contained.
- [x] Sandbox and browser capabilities use provider-neutral contracts with ownership, grants, TTL, cleanup, and Activity.
- [x] Durable events route idempotently into Agent inboxes.
- [ ] Google email/calendar reads are account-owned and grant-projected.
- [ ] MCP exposes only authorized V1 tools.
- [ ] Security, load, E2E, migration, health, and provider contract tests pass.
- [ ] Live qualification evidence is recorded where credentials and local providers permit.
- [ ] Documentation and deployment configuration are complete.

## Completion Pass

- [ ] Google OAuth is account-owned, encrypted, refreshable, and revocable.
- [ ] Gmail and Calendar read-only capabilities are grant-projected and audited.
- [ ] Overview, Agent, Connections, Sandboxes, Browsers, Events, and Activity surfaces are complete.
- [ ] Security, concurrency, idempotency, session-correlation, and final golden-path suites pass.
- [ ] Browser E2E and route performance qualification pass.
- [ ] Clean-database migrations, production start, readiness, MCP, cleanup, and worker shutdown pass.
- [ ] Release documentation and explicit live-provider evidence/blockers are complete.

## Work Log

### 2026-09-12 — Baseline and architecture

**By:** Codex

**Actions:**
- Qualified V0: typecheck, lint, build, 9 non-E2E tests, and 2 E2E tests passed.
- Recorded ADR-015 approving PostgreSQL + Drizzle, Docker sandboxes, and isolated Playwright browser contexts behind provider-neutral interfaces.

**Learnings:**
- Warm dashboard route p95 remains 33.9–40.9 ms; this is the V1 regression baseline.
- Local PostgreSQL binaries and Docker Desktop are installed, but neither service was running at baseline inspection.

### 2026-09-13 — Phase 1 PostgreSQL

**By:** Codex

**Actions:**
- Replaced the synchronous SQLite persistence layer with pooled PostgreSQL access through Drizzle.
- Added a 19-table V1 schema, generated migration, canonical capability seed data, and database transaction tests.
- Converted V0 domain services, routes, dashboard reads, test helpers, and E2E setup to async PostgreSQL access.
- Added isolated per-test databases and a guarded E2E database reset.
- Qualified typecheck, lint, 8 V0 regression tests, 2 database tests, 1 performance test, 2 E2E tests, idempotent migration, seed, and production build.

**Learnings:**
- PostgreSQL read-model p95 is 0.71 ms locally; warm browser route p95 remains below 49 ms.
- The V0 SQLite data is development-only. Relay will not silently import it; an explicit offline migration remains required before any non-development V0 dataset is moved.

### 2026-09-13 — Phase 2 production authentication

**By:** Codex

**Actions:**
- Added explicit OWNER/MEMBER human roles without merging User and Agent identity.
- Added guarded account registration, normalized email login, opaque hashed database sessions, secure production cookie naming, and server-side logout revocation.
- Added authentication and browser tests for account isolation, duplicate registration, login, session persistence, and logout.

**Learnings:**
- Open production registration remains opt-in through `RELAY_ALLOW_SIGNUP`; local development registration remains available.
- Password reset, MFA, and member invitations remain known limitations and are not being hidden behind placeholder UX.

### 2026-09-13 — Phase 3 GitHub OAuth

**By:** Codex

**Actions:**
- Added account/user-bound one-time OAuth state, ten-minute expiry, S256 PKCE, encrypted verifier storage, token exchange, token validation, encrypted access/refresh storage, refresh handling, reconnect, and disconnect.
- Made OAuth the primary Connections UI action while retaining PAT entry as an explicitly labeled development fallback.
- Added OAuth replay, cross-account callback, scope visibility, and encrypted-token tests.

**Learnings:**
- Live GitHub OAuth qualification is blocked until `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` identify a registered app with the Relay callback URL. The existing `GITHUB_PAT` cannot qualify the OAuth redirect flow.

### 2026-09-13 — Phase 4 governed sandbox capability

**By:** Codex

**Actions:**
- Added the provider-neutral `SandboxProvider` contract and isolated the Docker CLI implementation behind the provider registry.
- Added private Agent ownership, explicit sharing, account isolation, TTL cleanup, CPU/memory/process constraints, bounded output, command timeout, workspace file IO, network policy, MCP projection, and provider-independent Activity.
- Qualified the contract with a fake provider and a live Docker container, including binary IO, network isolation, absence of Relay environment variables, timeout, and destroy cleanup.

**Learnings:**
- Alpine BusyBox reports command timeout with exit 143; the adapter normalizes provider timeout semantics into Relay's `timedOut` result and BLOCKED Activity state.
- Docker socket access remains an operator-level deployment responsibility and is never exposed through Relay's capability contract.

### 2026-09-13 — Phases 5–11 capability-plane foundation

**By:** Codex

**Actions:**
- Added the provider-neutral `BrowserProvider` contract and isolated Playwright adapter with one context per session, ownership/grants, TTL cleanup, bounded extraction, screenshots, and public-network enforcement.
- Qualified real Chromium context isolation and private-address blocking.
- Added idempotent durable event ingestion, transactional inbox routing, queued wake requests, scoped inbox MCP tools, and registry-backed capability search.
- Added durable Agent sessions and correlated provider-independent Activity with session and governed resource IDs.
- Added migration-aware readiness, separate provider health, and provider-neutral operations/deployment guidance.

**Learnings:**
- Live Docker and Playwright adapters are qualified locally. GitHub OAuth still needs a registered OAuth app; Google read capabilities and the remaining V1 UI/golden-path work are not yet complete.
