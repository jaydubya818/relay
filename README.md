# Relay

Relay is a universal capability plane for AI agents.

Connect your digital capabilities once and make them available to any authorized agent through a shared MCP/API layer.

Models provide intelligence. Relay provides continuity, state, tools, permissions, and access to the digital world.

## What V0 proves

Two independent agent identities can connect to one Relay MCP endpoint with separate credentials and permissions. One agent can write shared memory that another authorized agent retrieves, private memory stays private, GitHub is connected once at the account level, denied calls are rejected, and every capability call is audited.

## Requirements

- Node.js 22.5 or newer (Relay uses the built-in SQLite API)
- pnpm 9
- A fine-grained GitHub token only when exercising the live connector

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

Relay is a single Next.js application with server-rendered dashboard pages, server-side domain services, an HTTP MCP endpoint, and a durable SQLite database for V0. Capability authorization is centralized in the executor shared by memory and provider tools. Provider credentials are account-owned and AES-256-GCM encrypted; agent credentials are SHA-256 hashed and cannot be recovered.

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
pnpm test:mcp
pnpm test:security
pnpm test:performance
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

The GitHub integration suite uses a mock provider boundary; connect a fine-grained token in the dashboard for live qualification.

## Security model

Dashboard sessions and agent credentials are separate. All dashboard mutations enforce same-origin requests, all agent tool calls pass through centralized authorization, tenant-owned records are filtered by `accountId`, revoked credentials fail immediately, provider tokens are encrypted, and logs omit bearer tokens and memory bodies. See [docs/security.md](docs/security.md) for V0 limitations and production requirements.

## Project documents

- [Architecture](docs/architecture.md)
- [API contract](docs/api.md)
- [MCP guide](docs/mcp.md)
- [Security model](docs/security.md)
- [Implementation plan and audit](docs/implementation-plan.md)
