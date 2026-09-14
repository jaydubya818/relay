# ADR-015 — Relay V1 Execution Providers

- Status: Accepted
- Date: 2026-09-12

## Context

Relay V1 needs production persistence plus governed sandbox and browser capabilities. These capabilities must remain portable: Account ownership, Agent grants, MCP projection, and Activity records cannot depend on a particular infrastructure vendor.

## Decision

Use PostgreSQL with Drizzle for production persistence, Docker as the initial `SandboxProvider`, and isolated Playwright browser contexts as the initial `BrowserProvider`.

Relay's canonical service and MCP contracts depend only on provider-neutral interfaces:

- `SandboxProvider`: `create`, `exec`, `readFile`, `writeFile`, `listFiles`, `destroy`, and `health`
- `BrowserProvider`: `create`, `navigate`, `click`, `type`, `extract`, `screenshot`, `close`, and `health`

Docker container IDs, Playwright objects, and other provider-specific fields remain inside adapters and persistence metadata. They are not exposed through Relay capability contracts or Activity metadata.

## Rationale

- Self-hostable
- Low development friction
- Deterministic local qualification
- Avoids premature vendor coupling
- Validates Relay's provider-neutral abstractions
- Enables managed providers without changing Agent or MCP contracts

## Consequences

- PostgreSQL becomes the production datastore; SQLite is retired from production use.
- Docker and Playwright are implementation dependencies, not domain concepts.
- Contract tests must exercise services against provider fakes and prove that no Docker or Playwright types appear in public contracts.
- Provider health is reported independently and cannot make core Relay readiness fail.

## Future

Evaluate `E2BSandboxProvider` and `BrowserbaseProvider` only after the V1 capability contracts and golden paths are qualified. Adding either provider must not require a domain, Agent authorization, Activity, or MCP contract redesign.
