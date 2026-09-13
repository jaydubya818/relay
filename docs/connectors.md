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

## Google Workspace

Google Workspace uses the same account-owned connection model. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `NEXT_PUBLIC_RELAY_URL`, then register:

```text
https://relay.example.com/api/connections/google/oauth/callback
```

Relay requests offline access with one-time account/user-bound state, S256 PKCE, and only `gmail.readonly`, `calendar.readonly`, OpenID, and email identity scopes. Access and refresh tokens are encrypted at rest. Expired access tokens refresh server-side; a rejected refresh marks the connection unhealthy and requires reconnection.

V1 exposes `email.search`, `email.read`, `calendar.event.list`, `calendar.event.read`, and `calendar.availability.read`. Mail sending, deletion, calendar writes, and provider credentials owned by individual Agents are intentionally excluded.

## Live qualification

Live OAuth requires registered GitHub and Google OAuth applications whose callbacks exactly match the Relay deployment URL. Unit and integration qualification cannot substitute for final provider checks.
