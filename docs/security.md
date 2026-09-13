# Relay V0 security model

## Enforced controls

- Dashboard users authenticate separately from agents.
- Dashboard sessions are signed, HTTP-only, SameSite=Lax cookies and production cookies are Secure.
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

`RELAY_SESSION_SECRET` and `RELAY_ENCRYPTION_KEY` must be independent high-entropy secrets in production. Rotate both through a documented operational process. Terminate TLS before Relay, restrict database file access, back up encrypted storage, and monitor repeated authentication failures and capability denials.

## Known V0 limitations

- SQLite is suitable for the standalone V0 and single-node operation, not horizontally scaled writes.
- Rate limiting is process-local, not distributed.
- Dashboard authentication is a seeded single-account email/password flow; password reset, MFA, invitations, and organizations are deferred.
- Connector encryption uses an application-managed key rather than a cloud KMS.
- GitHub uses a fine-grained personal access token rather than a full OAuth installation flow.
- Forgotten memory remains tombstoned for audit/storage cleanup; it is excluded from active retrieval.
- The MCP endpoint implements the V0 JSON-RPC methods needed for Relay clients, not every optional MCP transport feature.
