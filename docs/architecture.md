# Relay architecture

## Product boundary

The Relay account owns durable state: shared memory, external connections, agent identities, grants, and activity. An agent is a durable identity, not a model or runtime. Claude, Codex, or another runtime can be replaced while the Relay identity and account state remain.

```text
Agent runtime
    │  Bearer credential
    ▼
Relay MCP (/mcp)
    │
    ▼
Agent authentication ──► Account + identity
    │
    ▼
Dynamic tool projection
    │
    ▼
Central authorization
    │
    ▼
Capability executor ───► Activity ledger
    │
    ├── Memory / events / inbox ─► account-scoped PostgreSQL records
    ├── GitHub / Google adapters ─► encrypted account connections
    ├── SandboxProvider ─► Docker adapter
    └── BrowserProvider ─► Playwright adapter
```

## Main decisions

- **Small deployable system:** Next.js hosts the dashboard, JSON APIs, domain services, and HTTP MCP endpoint; a separate stoppable maintenance worker expires provider resources.
- **PostgreSQL persistence:** Drizzle provides the typed schema, query layer, transactions, and checked-in SQL migrations. Every tenant-owned query carries the authenticated account ID.
- **Separate authentication planes:** users receive signed, HTTP-only dashboard sessions. Agents receive independently hashed `rly_` credentials with status, revocation, last-used time, and optional expiry fields.
- **Central authorization:** every MCP tool call goes through `executeCapability`, which checks a capability grant before invoking a service and records success, denial, failure, and duration.
- **Account-owned connections:** one generic Connection record and separate encrypted credential are shared by all agents in the account. Grants control use.
- **Provider adapters:** GitHub and Google implement the connector interface. Docker and Playwright implement canonical execution/browser interfaces. Provider-specific fields never enter public capability contracts.
- **No sensitive payload audit:** Activity stores identity, capability, provider, action, result status, duration, timestamp, and request correlation—not bearer tokens, provider tokens, or memory content.

## Data model

The schema also includes durable Agent sessions, sandboxes, browser sessions, normalized events, transactional Agent inbox items, and queued wake requests. The capability registry is migration-managed with domain, description, risk, schemas, provider metadata, and status.

## Performance

Dashboard pages use indexed account/timestamp read models and bounded result sets. The Overview reports provider health independently from global readiness.

## Provider-neutral execution

Sandbox and browser services depend on canonical `SandboxProvider` and `BrowserProvider` contracts. Docker resource IDs and Playwright objects remain inside their adapters. Agent grants, MCP contracts, and Activity records identify Relay capabilities and resources rather than provider-specific operations.

## Extension points

The provider adapters and capability registry allow future connectors and managed execution providers without changing the Account/Agent authority model. Distributed rate limiting remains a production deployment concern.
