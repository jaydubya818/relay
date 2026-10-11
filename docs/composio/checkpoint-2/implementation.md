# Bounded implementation notes

Accepted ancestor: 69133673ae1915395b4cc010e4b6d3b8b1917f5b. Branch: codex/relay-composio-integration. SDK remains @composio/core@0.22.0.

The implementation separates provider metadata from canonical authorization. New integration_connections and integration_receipts tables contain no grants or credentials. They reference existing accounts, principals, memberships and agents; services use canonical account retirement fencing, active membership/agent checks, existing credential authentication, existing grants and the signed audit chain. This is an additive provider extension, not a competing policy registry. Existing native/MCP/connector routes, tables, grants and behavior are untouched.

The change spans persistence/schema, gateway/owner services, the catalog page and one server action/client form, tests/fixture setup, CI, and contract/evidence documentation. Each group is necessary to qualify the end-to-end bounded flow. No canonical MyEve, Relay V2, frozen API, dependency version, migration directory or external-alpha files are modified.

The optional catalog is `/connections/integrations`, exposed from Connections only with RELAY_INTEGRATIONS_PREVIEW=true. It is off by default. It shows four curated apps, search and connected filters, exact assigned Agent, recorded scopes, custody, recorded health, local revocation, provider revocation status and recent audit activity. Live setup is visibly unavailable. Missing storage produces an explicit failure state, not a fabricated empty account. Listing is bounded to 100 connection records and 10 audit entries. Existing canonical evidence bindings are required for mutation; the catalog does not create signing keys.

Provider-confirmed persistence is an internal completion port. There is no new OAuth callback or browser creation route. Production OAuth consent/state/expiry, provider scope attestation, canonical migration rollout and custody approval remain prerequisites before exposing this port to live setup. Synthetic fixture callers supply consent and provider confirmation explicitly.

The gateway authenticates the existing Relay agent credential before discovery/read requests. Discovery intersects local grants and connection state with a server-only bounded restriction projection. Its default source is absent; it does not independently verify MyEve policy. All execution requests terminate in durable NOT_DISPATCHED evidence. Canonical runtime-client/lease authentication and positive cross-system admission must be integrated in a later reviewed change before installing a public Sofie consumer endpoint.

Revocation and event receipts are durable, scope-bound and idempotent. Local revocation precedes provider revocation; UNKNOWN/PENDING provider outcomes retain local denial. Verified-event storage receives only a digest after verification and authoritative resolution; no ingress is activated. Replayed events cannot restore authority.

Hosted workflows explicitly include only the approved integration branch in their existing triggers. They perform qualification without a deployment step. Both hosted jobs use a fresh checkout and frozen-lockfile install. No new local clone or dependency installation was needed during the disk-recovery hold.
