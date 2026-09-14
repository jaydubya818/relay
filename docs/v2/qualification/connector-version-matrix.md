# Connector version matrix

| Connector | Relay adapter | Provider API | OAuth model | Qualified status |
|---|---|---|---|---|
| Google Drive | 1.0 | Drive REST v3 | Authorization code + PKCE; `drive.file` | Local pass; live blocked |
| Linear | 1.0 | GraphQL current | Authorization code + PKCE; rotating refresh tokens | Local pass; live blocked |

The release owner must re-run conformance after a provider contract, scope, token lifecycle, or response schema change. A connector definition is immutable; a changed contract publishes a new version and cannot silently replace an active manifest.
