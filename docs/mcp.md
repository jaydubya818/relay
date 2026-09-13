# Relay MCP

Relay exposes one HTTP JSON-RPC endpoint at `/mcp`.

## Authentication

```http
Authorization: Bearer rly_YOUR_AGENT_CREDENTIAL
Content-Type: application/json
```

Credentials are created per agent, displayed once, hashed at rest, independently rotatable, and immediately revocable.

## Methods

- `initialize`: negotiates protocol version `2025-06-18`.
- `ping`: verifies the authenticated endpoint.
- `tools/list`: returns only tools whose capabilities are allowed for the agent.
- `tools/call`: validates input, authorizes the capability centrally, executes it, and records Activity.

V1 capability groups:

- `relay_memory_add` → `memory.write`
- `relay_memory_search`, `relay_memory_get`, `relay_memory_list` → `memory.read`
- `relay_github_repo_list`, `relay_github_repo_get` → `github.repo.read`
- `relay_email_search`, `relay_email_read` → Gmail read-only capabilities
- `relay_calendar_event_list`, `relay_calendar_event_read`, `relay_calendar_availability_read` → Calendar reads
- `relay_sandbox_*` → governed sandbox lifecycle, execution, and file operations
- `relay_browser_*` → isolated browser lifecycle, navigation, interaction, extraction, and screenshot
- `relay_agent_inbox_*` → durable per-Agent inbox reads and acknowledgement
- `relay_capabilities_search` → active capability registry discovery

Every `tools/call` resolves a durable Agent session by account, Agent, runtime, and credential. Activity links the capability call to that session and any canonical resource ID.

## Example

```bash
curl http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer rly_YOUR_AGENT_CREDENTIAL' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

```bash
curl http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer rly_YOUR_AGENT_CREDENTIAL' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"relay_memory_add","arguments":{"content":"Project Atlas uses Node 24.","type":"FACT","scope":"SHARED"}}}'
```

## Errors

JSON-RPC errors include machine-readable `error.data`:

```json
{
  "code": "CAPABILITY_DENIED",
  "capability": "github.repo.read",
  "message": "This Relay agent is not permitted to use github.repo.read."
}
```

Other stable codes are `INVALID_CREDENTIAL`, `REVOKED_CREDENTIAL`, `CONNECTION_REQUIRED`, `PROVIDER_ERROR`, `RATE_LIMITED`, `INVALID_INPUT`, and `INTERNAL_ERROR`.
