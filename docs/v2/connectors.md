# Google Drive and Linear connectors

WO-17 qualifies two reference connectors, not a general HTTP proxy. Both execute inside Relay's trusted connector broker. An Agent/runtime receives resource-shaped results and provider receipts, never OAuth access tokens, refresh tokens, authorization codes, PKCE verifiers, or client secrets.

## Qualified capability surface

| Provider | OAuth scopes | Reads | Writes | Resource boundary |
|---|---|---|---|---|
| Google Drive v3 | `openid`, `email`, `drive.file` | Search/read app-accessible files | Create binary files; update app-created or explicitly selected files | User-selected root folder IDs plus selected file IDs |
| Linear GraphQL | `read`, `write` | Search/read issues | Create issues; update title/description only | Selected team IDs |

Drive delete, move, permission/share changes, trash, broad metadata/read scopes, native Workspace-document conversion, and arbitrary upload are excluded. Linear delete, status/workflow changes, assignment, labels, projects, comments, and arbitrary GraphQL are excluded. Google Picker or an equivalent authenticated resource-selection UI is required to make folders/files app-accessible before connection completion.

Google recommends the non-sensitive `drive.file` scope with Picker for per-file access. The v3 API is current. Relay does not use deprecated v2 fields or `supportsTeamDrives`; current shared-drive operations use `supportsAllDrives` where required. Google documents pre-generated file IDs as safe for retry: a completed duplicate create returns conflict rather than making a second file. Relay therefore pre-generates IDs for Drive creates and reconciles ambiguous results by ID.

Linear's public OAuth surface exposes `read` and `write`, so least privilege cannot be expressed by OAuth scope alone. Relay enforces team IDs at its PEP and permits only the fields above. Every issue create carries a stable Relay reference through the broker contract. Since Linear does not document mutation idempotency, a timeout/ambiguous response is never automatically retried; reconciliation searches that reference within the already-authorized team.

## Connection lifecycle

1. An OWNER, ADMIN, or OPERATOR chooses provider resources and begins a ten-minute OAuth flow.
2. Relay generates an account/principal/provider-bound, single-use state. A credential broker owns PKCE and returns only an opaque verifier handle.
3. Callback processing atomically consumes state before exchange. The broker stores provider tokens and returns only an opaque credential handle, provider identity, actual scopes, and accessible resource IDs.
4. Relay rejects unexpected scopes, inaccessible selected resources, missing signed connector definitions, and wrong-provider restriction shapes.
5. Every connector call verifies the signed/versioned manifest, active account connection, exact task/action/lease hash, resource boundary, current scopes, selected-resource accessibility, call limit, and stable idempotency key before effect.
6. Scope loss or selected-resource access loss changes the connection to `ERROR` and fails closed. Reconnect replaces the handle and permission snapshot. Revoke asks the broker to revoke/delete credential material and immediately disconnects Relay authority.

Connector definitions declare exact capabilities, OAuth scopes, provider hosts, reconciliation support, and credential-handle-only access. Definitions are signed and reverified before each operation. Provider resources and operations are account scoped; an idempotency key reused with different authority or parameters is rejected.

## Evidence and classifications

Operations retain canonical parameter hashes, bounded canonical parameters needed for reconciliation, task/action/lease bindings, provider resource IDs, effect state, and redacted provider receipts. Token-like values are prohibited from connector manifests, runtime inputs, results, logs, and durable operation evidence. Provider content follows the task's data classification and downstream evidence-retention policy.

Official contracts used:

- [Google Drive API scope selection](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Drive file search](https://developers.google.com/workspace/drive/api/guides/search-files)
- [Google Drive create and pre-generated IDs](https://developers.google.com/workspace/drive/api/guides/create-file)
- [Google Drive v2/v3 comparison](https://developers.google.com/workspace/drive/api/guides/v3versusv2)
- [Linear OAuth 2.0](https://linear.app/developers/oauth-2-0-authentication)
- [Linear GraphQL issue create/update](https://linear.app/developers/graphql)
- [Linear rate limiting](https://linear.app/developers/rate-limiting)
- [Linear webhooks and signing](https://linear.app/developers/webhooks)

Linear's refresh-token system migration completed April 1, 2026; the broker contract assumes current rotating refresh-token behavior. Legacy access-token revocation fields are not used.
