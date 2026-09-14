# Relay V2 developer platform

## Contract

Relay exposes a versioned REST API and a stateless MCP surface over the same authorization path. A successful action submission means the command and wake-up event are durable in the authoritative control plane; it does not mean the external effect occurred.

Every non-discovery request is bound to an account, authenticated runtime client, intended OAuth resource, workload, audience, canonical ActionIntent, and capability lease. OAuth access tokens are verified for the exact resource and tenant. Relay never accepts downstream provider tokens and never passes Relay bearer tokens to connectors.

## MCP negotiation

The preferred stateless protocol is `2026-07-28`, discovered with `server/discover` and routed with `MCP-Protocol-Version`, `MCP-Method`, and, for tool calls, `MCP-Name`. Compatibility adapters retain `initialize` for `2025-11-25` and `2025-06-18`. Unsupported post-negotiation versions fail closed. The compatibility matrix is in [runtime-compatibility.md](runtime-compatibility.md).

## Durable action semantics

`POST /api/v2/runtime/actions` requires `Idempotency-Key`. Concurrent requests with the same runtime client and key serialize. A replay with the same canonical action returns the original command without consuming another lease call; a different action returns `409`. Status reads require the same tenant and runtime identity. Worker crashes after a possibly committed external effect use the existing `POSSIBLY_COMMITTED`/dead-letter path and are never blindly retried.

## OAuth and deployment bindings

The protected-resource document is published at `/.well-known/oauth-protected-resource`. Production must bind an OAuth verifier, audit signer, and lease key resolver through the deployment composition root. Authorization servers must implement resource indicators and issue audience-restricted access tokens. Durable credentials remain in the control-plane vault; runtimes receive only short-lived bounded authority.

## Versioning

The API date version is returned in `Relay-API-Version`. Additive response fields are compatible. Removing or changing fields, authorization semantics, idempotency semantics, or error meanings requires a new dated API version and a migration window.
