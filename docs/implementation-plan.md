# Relay V0 implementation plan

Authoritative repository: `/Users/jaywest/relay`

Reference-only sources:

- `/Users/jaywest/factory-pilot`
- `/Users/jaywest/factory-pilot/.mission-control/worktrees/aeha4n8e9x37-ojwqn3k9`

`/Users/jaywest/MissionControl` is explicitly out of scope and must not be modified.

## Audit

- The standalone repository did not exist and was initialized on `main`.
- The preserved candidate contains a runnable minimal Next.js shell, health route, TypeScript configuration, and dependency lockfile.
- It has no persistence, authentication, agent identity, authorization, MCP, connector, activity, product UI, or automated tests.
- Reuse is limited to validated framework versions and the simple health-route pattern.

## Delivery checklist

- [x] Runnable application foundation, database, dashboard shell, health, and tests
- [x] Domain persistence and migrations
- [x] Dashboard authentication
- [x] Agent identities, one-time credentials, revocation, and capability grants
- [x] Scoped shared/private memory and forget flow
- [x] Authenticated MCP endpoint with dynamic tool projection
- [x] Account-owned encrypted GitHub connection and read tools
- [x] Activity ledger including denials and latency
- [x] Overview, Agents, Memory, Connections, Activity, Developer, and Settings UI
- [x] Full golden-path, security, E2E, and performance qualification
- [x] README, architecture, API, MCP, and security documentation
