# WO-16 communications qualification pack

Status: LOCAL PASS; LIVE PROVIDER BLOCKED_EXTERNAL_CONFIGURATION

## Qualified locally

- Slack raw-body HMAC validation, invalid-signature rejection, and five-minute replay-window rejection.
- Telegram webhook secret-token validation and `update_id` deduplication.
- One provider retry produces one Relay event and one routed task.
- Account-owned bot echoes are suppressed without recursive task creation.
- Connection, thread, message, event/task routing, lease, approval, and query boundaries reject tenant substitution.
- A new recipient cannot create a message or external effect without approval-linked lease authority.
- An approved reply is sent once for one account-scoped idempotency key and records the provider message ID and final-state receipt.
- Provider 429 handling respects retry hints; a concurrent retry race has one winner.
- Timeout/5xx effects become `EFFECT_UNKNOWN`, cannot enter the rate-limit retry path, and require explicit reconciliation.
- Attachment metadata is bounded and classified without fetching untrusted provider URLs.

## Commands

```text
pnpm typecheck
pnpm lint
RELAY_TEST_DATABASE_URL=postgresql://127.0.0.1:55432/postgres pnpm vitest run tests/v2/runners.test.ts tests/v2/communication-providers.test.ts --fileParallelism=false
RELAY_DATABASE_URL=postgresql://127.0.0.1:55432/postgres pnpm db:check
RELAY_TEST_DATABASE_URL=postgresql://127.0.0.1:55432/postgres pnpm test -- --fileParallelism=false
pnpm v2:frontier:check
```

Record exact results in `docs/v2-implementation.md` after the final run.

## Live channel matrix (WO-22 gate)

| Vector | Slack | Telegram | Current result |
|---|---|---|---|
| Signed inbound and provider retry | Real workspace/app | Real bot webhook | BLOCKED_EXTERNAL_CONFIGURATION |
| Reply and provider message ID | `chat.postMessage` | `sendMessage` | BLOCKED_EXTERNAL_CONFIGURATION |
| Rate limit and retry delay | 429/`Retry-After` | 429/`retry_after` | BLOCKED_EXTERNAL_CONFIGURATION |
| Echo suppression | Bot event | Bot-authored update where delivered | BLOCKED_EXTERNAL_CONFIGURATION |
| Delivery/latency SLO | Hosted ingress | Hosted ingress | BLOCKED_EXTERNAL_CONFIGURATION |

The live pack must use isolated test identities, retain redacted request/receipt evidence, and remove webhook credentials after qualification.
