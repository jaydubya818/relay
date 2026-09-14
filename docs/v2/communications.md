# Slack and Telegram communications

WO-16 qualifies a deliberately narrow communications slice: signed Slack Events API and Telegram Bot API inbound messages become Relay events, and an Agent may send an approved text reply through an account-owned bot identity. SMS, iMessage, Teams, WhatsApp, Discord, reactions, edits, interactive components, and attachment download or upload are not part of V2.

## Authority and data flow

1. An operator registers a Slack workspace/app installation or Telegram bot against one Relay account. Relay persists only opaque credential and webhook-secret handles.
2. The channel adapter resolves the webhook secret server-side, authenticates the raw request, normalizes bounded text and attachment metadata, and maps the provider conversation/thread to an account-scoped Relay thread.
3. Owned-identity messages are stored as suppressed and never enter the event router. Provider event identifiers are unique per connection, so provider retries converge.
4. The adapter publishes `communication.message.received` through the durable WO-10 event router. The route, not the channel adapter, selects the active Agent and creates the task.
5. Outbound text is bound to an active capability lease by the exact thread and text action hash. A previously unknown recipient additionally requires an approval decision embedded by the approval/lease services.
6. The provider adapter returns the provider message ID and receipt. Relay persists the final state, action, task, lease, approval decision, and idempotency key as one evidence chain.

Every read and mutation includes `account_id`. Connection, thread, lease, task, and message bindings are rechecked before an external send. A cross-account request fails before a communication row or provider effect is created.

## Delivery safety

- Slack uses the current signing-secret protocol: HMAC-SHA256 over the exact raw body with a five-minute timestamp window. Deprecated verification tokens are not accepted.
- Telegram requires the configured `X-Telegram-Bot-Api-Secret-Token` value. `update_id` is the inbound deduplication key.
- Slack `client_msg_id` carries Relay's outbound idempotency key. Telegram exposes no equivalent send idempotency parameter, so timeouts and 5xx responses are `EFFECT_UNKNOWN`, never automatic retries.
- HTTP 429 is explicitly pre-effect and may retry only after the provider delay. A database advisory lock and state transition allow one worker to claim that retry.
- A transport timeout or 5xx response requires provider reconciliation. Reconciliation may move a message to `SENT` or `DELIVERED`; an unknown result remains unknown.
- Attachments are metadata-only in WO-16, capped at 20 items and 25 MiB metadata size per item. Their presence raises classification to confidential. Relay does not dereference provider URLs in this path.

## Provider constraints

Slack requires acknowledgement within three seconds and retries failed deliveries. The HTTP ingress must acknowledge after durable acceptance and perform routing asynchronously in a hosted deployment. Slack's Web API rate-limit response and `Retry-After` header are authoritative. Telegram retries unsuccessful webhook deliveries and supplies both webhook secret-token verification and rate-limit retry parameters.

Provider references used for the qualified contract:

- [Slack request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/)
- [Slack Events API delivery and retries](https://docs.slack.dev/apis/events-api/)
- [Slack `chat.postMessage`](https://docs.slack.dev/reference/methods/chat.postMessage/)
- [Slack Web API rate limits](https://docs.slack.dev/apis/web-api/rate-limits/)
- [Telegram Bot API](https://core.telegram.org/bots/api)

## Explicit qualification boundary

Local tests qualify authentication, replay rejection, deduplication, event-to-task routing, loop suppression, attachment classification, new-recipient approval enforcement, tenant isolation, outbound idempotency, rate-limit retry races, ambiguous-effect containment, reconciliation, and provider message receipts. Live Slack workspace and Telegram bot tests require customer/provider credentials and remain `BLOCKED_EXTERNAL_CONFIGURATION` until WO-22. No live delivery or latency claim is made by WO-16.
