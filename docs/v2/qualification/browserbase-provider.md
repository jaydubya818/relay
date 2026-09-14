# Browserbase provider qualification

## Qualified Relay profile

- Adapter/manifest: `browserbase@1.0`
- Upstream contract: Browserbase REST Sessions API v1, reviewed 2026-09-13
- Relay assurance: `registered`
- Features: ephemeral visual browser, live observation, session replay evidence
- Regions: `us-west-2`, `us-east-1`, `eu-central-1`, `ap-southeast-1`
- Isolation/classification ceiling: process / internal
- Not claimed: pause/resume, persistent computer, shell/files, private networking, human takeover, idempotent create, or provider-signed evidence

Browserbase documents `POST /v1/sessions`, `GET /v1/sessions/{id}`, `GET /v1/sessions/{id}/debug`, and HLS session replay. Replay playlists contain signed segment URLs that expire after six hours and must be fetched again. The API key is required only on Relay's server-side provider client; Browserbase explicitly warns that calling replay APIs from a browser exposes the key. Relay therefore returns neither API keys nor connection/signing URLs in provider receipts. Live URLs are fetched on demand and are never treated as durable authority.

## Failure contract

- An explicit `429` or other non-authentication 4xx create response proves rejection and is `PRE_EFFECT`.
- Create-time `5xx`, network loss, or timeout is `POSSIBLY_COMMITTED`; Relay stops failover and reconciles by provider session ID where one is known.
- Read-only status/live/replay calls use bounded exponential backoff and honor a bounded retry delay.
- Expired replay material is refreshed from the backend; it is not cached as durable evidence authority.
- The database provider status and adapter kill switch both prevent new dispatch. Active-session termination remains available for incident response.

## Evidence

- `tests/v2/third-party-providers.test.ts`: common provider substitution, capability rejection, tenant/session binding, credentials, live-link refresh, failure classification, kill switch, termination.
- Live Browserbase qualification: `BLOCKED_EXTERNAL_CONFIGURATION` (`BROWSERBASE_API_KEY` absent). No live success, isolation, retention, or SLO claim is recorded.

## Official sources

- <https://docs.browserbase.com/reference/api/create-a-session>
- <https://docs.browserbase.com/reference/api/get-a-session>
- <https://docs.browserbase.com/reference/api/session-live-urls>
- <https://docs.browserbase.com/platform/browser/observability/session-replay>

Deprecation review: the older embedded rrweb replay path is deprecated. Relay targets the current HLS Session Replay API and does not implement the deprecated path.
