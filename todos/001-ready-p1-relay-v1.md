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

- [ ] PostgreSQL and Drizzle replace SQLite production persistence with migrations and isolated tests.
- [ ] Multiple human users and accounts are isolated with durable secure sessions.
- [ ] GitHub OAuth is primary while optional PAT development setup remains contained.
- [ ] Sandbox and browser capabilities use provider-neutral contracts with ownership, grants, TTL, cleanup, and Activity.
- [ ] Durable events route idempotently into Agent inboxes.
- [ ] Google email/calendar reads are account-owned and grant-projected.
- [ ] MCP exposes only authorized V1 tools.
- [ ] Security, load, E2E, migration, health, and provider contract tests pass.
- [ ] Live qualification evidence is recorded where credentials and local providers permit.
- [ ] Documentation and deployment configuration are complete.

## Work Log

### 2026-09-12 — Baseline and architecture

**By:** Codex

**Actions:**
- Qualified V0: typecheck, lint, build, 9 non-E2E tests, and 2 E2E tests passed.
- Recorded ADR-015 approving PostgreSQL + Drizzle, Docker sandboxes, and isolated Playwright browser contexts behind provider-neutral interfaces.

**Learnings:**
- Warm dashboard route p95 remains 33.9–40.9 ms; this is the V1 regression baseline.
- Local PostgreSQL binaries and Docker Desktop are installed, but neither service was running at baseline inspection.
