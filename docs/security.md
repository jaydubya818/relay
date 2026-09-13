# Relay security model

## Enforced controls

- Dashboard users authenticate separately from agents.
- Human users have explicit account membership and OWNER/MEMBER roles; User identity remains separate from Agent identity.
- Dashboard sessions use opaque 256-bit tokens. Only token hashes are stored in PostgreSQL; cookies are HTTP-only, SameSite=Lax, Secure in production, and use the `__Host-` prefix in production.
- Logout revokes the server-side session before clearing the browser cookie.
- Dashboard mutations reject cross-origin requests.
- Agent credentials use 192 bits of randomness, a recognizable `rly_` prefix, SHA-256 hashes at rest, one-time display, revocation, rotation, and last-used tracking.
- Agent disable and credential expiry/revocation are evaluated on every request.
- Capability grants have explicit ALLOW/DENY effects. Missing grants deny by default.
- MCP tools are projected from grants, and direct calls still pass centralized authorization.
- Every domain query scopes records to the authenticated account.
- GitHub credentials live in a separate table encrypted with AES-256-GCM and are never returned by ordinary APIs.
- Provider tokens, bearer tokens, and memory bodies are omitted from structured logs and Activity metadata.
- Agent calls have a bounded per-process rate limit.
- Tool and dashboard inputs are validated and bounded.

## Production requirements

`RELAY_SESSION_SECRET` and `RELAY_ENCRYPTION_KEY` must be independent high-entropy secrets in production. Rotate both through a documented operational process. Terminate TLS before Relay, restrict PostgreSQL access, back up encrypted storage, and monitor repeated authentication failures and capability denials. Public account registration is disabled in production unless `RELAY_ALLOW_SIGNUP=true` is set deliberately.

## Known limitations

- Rate limiting is process-local, not distributed.
- Password reset, email verification, MFA, and member invitations are not yet implemented. V1 account creation establishes one OWNER; additional membership management remains deployment-admin controlled until an invitation flow is qualified.
- Connector encryption uses an application-managed key rather than a cloud KMS.
- GitHub uses a fine-grained personal access token rather than a full OAuth installation flow.
- Forgotten memory remains tombstoned for audit/storage cleanup; it is excluded from active retrieval.
- The MCP endpoint implements the V0 JSON-RPC methods needed for Relay clients, not every optional MCP transport feature.
