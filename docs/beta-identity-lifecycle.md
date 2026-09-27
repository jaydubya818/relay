# Disposable beta identity lifecycle

Invitations can be revoked only while pending and unexpired. Acceptance and
revocation conditionally update the same PostgreSQL row, so one wins. A repeated
revoke returns the existing revoked state. The Settings page lists pending,
accepted, expired, and revoked invitations with expiry and revocation actor/time.

Accounts created with an accepted beta invitation are marked disposable. These
accounts use **retirement only**, even if they have no peer exchange. Existing
account, request, publication, receipt, and audit references make hard deletion
unsafe. General account deletion is outside this lifecycle.

The account owner reviews dependency counts in Settings and confirms `RETIRE`.
The retirement transaction takes the federation owner lock, marks the account
retired, revokes active sessions, credentials, identities, delegations, grants,
and publications, blocks relationships, cancels pending requests and outbox
events on both sides of a peer exchange, blanks private memory content, and
removes active memberships. It verifies zero live authority before committing a
signed retirement audit record. A crash before commit rolls the transaction
back; a committed retirement is terminal and idempotent at the service layer.
Unsupported external resources or active work block retirement until cleared.

Historical signed receipts and publication provenance remain attributable.
Information already delivered to another peer cannot be recalled. New requests,
delivery, publication, and retrieval are denied after retirement.

The managed Builder retirement gate uses the encrypted invite bound to its Eve
to read back that exact Relay account's terminal state and zero active authority.
The tester retires the account in Relay Settings first. Builder then permits
provider cleanup only after this readback succeeds. The invite bearer grants
readback of its own lifecycle, never account administration.

## Local verification

- Real PostgreSQL: invite revoke/replay and accept-vs-revoke race; owner boundary;
  concurrent retire/replay/grant; incoming Knowledge request and publication
  races; outgoing peer outbox cancellation; signed audit verification.
- Browser at an isolated local Relay server: operator creates and revokes a test
  invitation; invited tester reviews dependency counts, confirms retirement,
  receives a success state, and is redirected to login on fresh navigation.
  Database readback: retired `1`, active sessions `0`, active grants `0`, active
  private-memory objects `0`.
- `pnpm db:check`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, Relay suite and
  focused federation regressions passed. Builder typecheck/build and all 33
  local tests passed, including readback denial before provider deletion.

This is local qualification only. No hosted Ava/Sofie exchange, tester invite,
or managed provisioning was started by this implementation.
