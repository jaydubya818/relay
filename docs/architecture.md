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
    ├── Memory service ─► account-scoped PostgreSQL records
    └── GitHub adapter ─► encrypted account connection ─► GitHub API
```

## Main decisions

- **One deployable application:** Next.js hosts the dashboard, JSON APIs, domain services, and Streamable HTTP MCP endpoint. This is the smallest operationally coherent V0.
- **PostgreSQL persistence:** Drizzle provides the typed schema, query layer, transactions, and checked-in SQL migrations. Every tenant-owned query carries the authenticated account ID.
- **Separate authentication planes:** users receive signed, HTTP-only dashboard sessions. Agents receive independently hashed `rly_` credentials with status, revocation, last-used time, and optional expiry fields.
- **Central authorization:** every MCP tool call goes through `executeCapability`, which checks a capability grant before invoking a service and records success, denial, failure, and duration.
- **Account-owned connections:** one generic Connection record and separate encrypted credential are shared by all agents in the account. Grants control use.
- **Provider adapter:** GitHub implements the connector interface (`health`, `capabilities`, `execute`). Provider-specific fields do not leak into the canonical connection schema.
- **No sensitive payload audit:** Activity stores identity, capability, provider, action, result status, duration, timestamp, and request correlation—not bearer tokens, provider tokens, or memory content.

## Data model

The schema contains Account, User, Agent, AgentCredential, Capability, CapabilityGrant, Memory, Connection, ConnectionCredential, and Activity. The capability registry is seeded by migration with domain, description, risk, and enabled state. Foreign keys enforce ownership relationships; service queries also require the authenticated account ID to prevent cross-account direct-object access.

## Performance

Dashboard pages use server read models with indexed account/timestamp queries, persistent layout navigation, and bounded result sets. External provider health is never called during ordinary dashboard navigation.

## Provider-neutral execution

Sandbox and browser services depend on canonical `SandboxProvider` and `BrowserProvider` contracts. Docker resource IDs and Playwright objects remain inside their adapters. Agent grants, MCP contracts, and Activity records identify Relay capabilities and resources rather than provider-specific operations.

## Extension points

The provider adapters and capability registry allow future connectors and managed execution providers without changing the Account/Agent authority model. Distributed rate limiting remains a production deployment concern.
