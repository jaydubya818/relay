# Events and Agent inbox

Relay stores a provider-neutral event envelope, then routes it to durable per-Agent inbox items. Ingestion requires a source delivery ID and is idempotent within an account and source. Provider payload bodies are not stored inline; `payloadReference` may point to separately governed storage.

Routing validates every recipient against the event account and creates event, inbox, and optional wake-request records in one transaction. Wake requests are durable queue records only in V1. Relay does not automatically launch arbitrary runtimes yet.

Agents can list, get, and acknowledge only their own inbox items when granted the matching capability. Inbox operations use the normal MCP authorization and provider-independent activity path.
