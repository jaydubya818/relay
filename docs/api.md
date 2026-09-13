# Relay V0 API contract

Dashboard endpoints use the signed, HTTP-only `relay_session` cookie. Mutations require a same-origin browser request. MCP uses a separate Relay agent bearer credential.

| Method | Endpoint | Authentication | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | None | Basic application and database health |
| POST | `/api/auth/login` | Email/password | Create dashboard session |
| POST | `/api/auth/logout` | Session | Clear dashboard session |
| GET/POST | `/api/agents` | Session | List or create agent; create returns credential once |
| GET/PATCH | `/api/agents/:id` | Session | Inspect identity or enable/disable it |
| POST/DELETE | `/api/agents/:id/credentials` | Session | Rotate or revoke credentials |
| PUT | `/api/agents/:id/capabilities/:capability` | Session | Set ALLOW or DENY |
| GET | `/api/memories` | Session | Search and filter account memory |
| DELETE | `/api/memories/:id` | Session | Forget memory |
| PUT/POST/DELETE | `/api/connections/github` | Session | Connect, test, or disconnect GitHub |
| GET | `/api/activity` | Session | Read filtered activity |
| GET/POST | `/mcp` | Agent bearer | MCP discovery and JSON-RPC operations |

All resource lookups derive `accountId` from authentication; callers cannot choose it. Errors use a stable `code` and human-readable `message`.
