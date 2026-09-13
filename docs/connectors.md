# Connector operations

Relay connections belong to Accounts. Agents receive capability grants; they never receive or store provider credentials.

## GitHub

GitHub OAuth is the production connection path. Configure:

```text
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
GITHUB_OAUTH_SCOPES=repo read:user
NEXT_PUBLIC_RELAY_URL=https://relay.example.com
```

Register this callback URL with GitHub:

```text
https://relay.example.com/api/connections/github/oauth/callback
```

Relay generates one-time, account-and-user-bound OAuth state plus an S256 PKCE challenge. State expires after ten minutes and is consumed atomically. Access and refresh tokens are encrypted before storage. Returned tokens are validated against GitHub before the account connection is changed. Expiring tokens are refreshed server-side; failed refresh marks the connection unhealthy and requires reconnection.

The default `repo` OAuth scope is broad because classic GitHub OAuth apps do not offer fine-grained repository-read scopes. Relay's capability layer still exposes read operations only. Deployments requiring repository selection should evaluate a GitHub App after the V1 OAuth contract is qualified.

A fine-grained PAT can still be entered as an explicitly labeled development fallback. It is not the primary production onboarding path.

Disconnecting deletes encrypted credentials immediately and changes the account connection to `DISCONNECTED`. Existing Agent grants remain visible but calls fail with `CONNECTION_REQUIRED` until the Account reconnects.

## Live qualification

Live OAuth requires a registered GitHub OAuth application whose callback exactly matches the Relay deployment URL. Unit and integration qualification cannot substitute for this final provider check.
