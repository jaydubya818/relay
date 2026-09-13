# Relay V1

Relay is a universal capability plane for AI agents.

Connect your digital capabilities once and make them available to any authorized agent through a shared MCP/API layer.

Models provide intelligence. Relay provides continuity, state, tools, permissions, and access to the digital world.

## Proven foundation

Two independent agent identities can connect to one Relay MCP endpoint with separate credentials and permissions. One agent can write shared memory that another authorized agent retrieves, private memory stays private, GitHub is connected once at the account level, denied calls are rejected, and every capability call is audited.

## Requirements

- Node.js 22.5 or newer
- pnpm 9
- PostgreSQL 14 or newer
- Docker for the initial self-hosted sandbox provider
- Chromium installed through Playwright for the initial browser provider
- Registered GitHub/Google OAuth applications for live connector use

## Quick start

```bash
cd /Users/jaywest/relay
cp .env.example .env.local
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The local seed creates:

- Dashboard email: `admin@relay.local` (or `RELAY_ADMIN_EMAIL`)
- Dashboard password: `relay-local-only` (or `RELAY_ADMIN_PASSWORD`)
- Claude Agent with memory and GitHub read grants
- Codex Agent with memory read and an explicit GitHub deny

`pnpm db:seed` prints newly issued agent credentials once. Treat them as secrets.

## Architecture

Relay is a Next.js web/API service plus a stoppable maintenance worker, backed by PostgreSQL through Drizzle. Capability authorization is centralized across memory, connectors, execution resources, browsers, events, and inbox tools. Provider credentials are account-owned and AES-256-GCM encrypted; Agent credentials are hashed and cannot be recovered.

See [docs/architecture.md](docs/architecture.md) for the request path and domain boundaries.

## Connecting an agent

Use the credential printed by the seed or created in the Agents UI:

```json
{
  "mcpServers": {
    "relay": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer rly_YOUR_AGENT_CREDENTIAL"
      }
    }
  }
}
```

Each runtime should use its own Relay agent identity. Details and raw request examples are in [docs/mcp.md](docs/mcp.md).

## Testing

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:database
pnpm test:mcp
pnpm test:security
pnpm test:performance
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
RELAY_LIVE_DOCKER=1 RELAY_LIVE_PLAYWRIGHT=1 pnpm vitest run tests/sandbox/docker-live.test.ts tests/browser/playwright-live.test.ts
```

Live OAuth qualification requires registered provider applications and valid refresh/authorization state. `pnpm qualify:google` performs only read-only Gmail and Calendar checks and never prints tokens or message bodies.

## Security model

Dashboard sessions and Agent credentials are separate. All dashboard mutations enforce same-origin requests, all Agent tool calls pass through centralized authorization, tenant-owned records are filtered by `accountId`, revoked credentials fail immediately, provider tokens are encrypted, and logs omit bearer tokens and capability payloads. See [docs/security.md](docs/security.md) for limitations and production requirements.

## Project documents

- [Architecture](docs/architecture.md)
- [API contract](docs/api.md)
- [MCP guide](docs/mcp.md)
- [Security model](docs/security.md)
- [PostgreSQL development and migrations](docs/database.md)
- [Connector operations](docs/connectors.md)
- [Sandbox provider and security](docs/sandboxes.md)
- [Browser provider and security](docs/browser.md)
- [Events and Agent inbox](docs/events.md)
- [Operations](docs/operations.md)
- [Deployment](docs/deployment.md)
- [V1 release candidate](docs/v1-release.md)
- [ADR-015: V1 execution providers](docs/adr/ADR-015-relay-v1-execution-providers.md)
- [Implementation plan and audit](docs/implementation-plan.md)
