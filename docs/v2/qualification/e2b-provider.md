# E2B provider qualification

## Qualified Relay profile

- Adapter/manifest: `e2b@1.0`
- Upstream contract: E2B JavaScript SDK sandbox contract v2.6.2, reviewed 2026-09-13
- Relay assurance: `registered`; E2B's isolation statements are provider claims, not Relay attestation
- Features: ephemeral microVM shell, workspace files, beta pause/resume
- Regions: `us`, `eu`
- Isolation/classification ceiling: microVM / internal
- Not claimed: visual desktop/browser, private networking, persistent Relay computer, secret injection, human takeover, idempotent create, or provider-signed evidence

E2B documents create/connect, shell commands, file operations, kill, timeout management, and beta pause. Connecting to a paused sandbox resumes it. Because pause is explicitly beta, Relay advertises it only as a provider feature under `registered` assurance and keeps the operation behind the provider kill switch.

## Failure contract

- An explicit `429` or other non-authentication 4xx create response proves rejection and is `PRE_EFFECT`.
- Create-time `5xx`, network loss, or timeout is `POSSIBLY_COMMITTED`; Relay stops failover and requires reconciliation.
- Read-only reconciliation uses bounded exponential backoff.
- File paths are rooted below `/home/user`; traversal and absolute paths fail before provider dispatch. Reads and writes are capped at 1 MiB and commands are bounded.
- Provider API credentials come only from the server-side credential source. Execution vault handles are rejected because WO-13 has no qualified E2B secret-broker path.
- The database provider status and adapter kill switch both prevent new dispatch. Active-session termination remains available for incident response.

## Evidence

- `tests/v2/third-party-providers.test.ts`: common provider substitution, shell/files/pause, capability rejection, tenant/session binding, credentials, failure classification, kill switch, termination.
- Live E2B qualification: `BLOCKED_EXTERNAL_CONFIGURATION` (`E2B_API_KEY` absent). No live success, isolation, retention, or SLO claim is recorded.

## Official sources

- <https://e2b.dev/docs/sdk-reference/js-sdk/v2.6.2/sandbox>
- <https://changelog.e2b.dev/security>

Deprecation review: no deprecation affecting the selected v2.6.2 sandbox contract was found in the official reference. `betaPause` remains beta and is recorded as such rather than treated as stable.
