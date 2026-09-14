# Relay V2 Events and Task Orchestration

## Authority and delivery model

PostgreSQL in the hosted Relay control plane is authoritative for accepted events, immutable route versions, task state, command attempts, fencing, outbox messages, and dead letters. Temporal provides durable workflow execution but is not an authorization source. The deterministic workflow ID is `relay/{accountId}/task/{taskId}` and the `relay.task.v1` workflow disables Temporal-level retries; Relay's classified command ledger owns retry policy and evidence.

Inbound adapters must verify the provider signature over the original bytes before calling `ingestVerifiedEvent`. Relay then validates the strict event envelope, serializes ingestion per account/source, deduplicates by account/source/dedupe key, records provider sequence reordering, selects only active immutable route versions, and atomically creates tasks, initial state history, commands, outbox messages, and audit evidence. An acknowledged event therefore cannot exist without its durable routing result.

Delivery is at least once. Consumers must deduplicate on the outbox `idempotencyKey`; a publisher crash after broker acceptance and before `publishedAt` can produce a duplicate, never an acknowledged-event loss. This is intentional and safer than pretending cross-system exactly-once delivery.

## State, retries, and fencing

Workers claim commands under a database transaction and receive a monotonically increasing task fence plus a short coordinator lease. Every state mutation checks account, task or command ID, worker identity where applicable, fence, expected state, and lease freshness. A recovered worker receives a new fence; the old coordinator cannot mutate the task.

Before an external effect, workers persist one of:

- `PRE_EFFECT`: no external effect began; automatic retry is safe.
- `IDEMPOTENT_SAFE`: the provider operation has a stable idempotency key; automatic retry is safe.
- `POSSIBLY_COMMITTED`: the effect may have happened; Relay never retries automatically and moves the task to the dead-letter queue for reconciliation.

Poison work and retry exhaustion also enter the DLQ. Permanent failures end as `FAILED`. Retryable pre-effect/idempotent failures use bounded exponential backoff and return the task to `QUEUED`. Replay is an explicit account-authorized operation that creates a new child task linked to the immutable failed task; each DLQ entry can be replayed once.

Cancellation is committed to Relay first and atomically emits a durable `task.cancel.requested` outbox message. Best-effort immediate Temporal cancellation improves latency, while the outbox closes the delivery gap if Temporal is unavailable.

## Fault-recovery runbook

1. Inspect task history, current fence, command effect state, attempt count, and DLQ evidence within the affected account.
2. Run the expired-command reaper. It may requeue only `PRE_EFFECT` or `IDEMPOTENT_SAFE` work below its attempt ceiling.
3. Do not manually change `POSSIBLY_COMMITTED` to retryable. Reconcile the provider effect and attach evidence first.
4. Restore the outbox publisher and republish unpublished rows. Downstream consumers deduplicate by the stable key.
5. For poison or reconciled entries, use explicit DLQ replay. Relay creates a new task and preserves the parent link.
6. If a stale worker continues reporting, revoke its later workload identity under WO-08/WO-14; its old fence already prevents state mutation.

## Qualification matrix

| Fault | Required convergence |
|---|---|
| Duplicate provider delivery | Same event and logical task IDs; no additional command |
| Lower provider sequence | Event retained and marked reordered; routes remain deterministic |
| Concurrent workers | Exactly one claim for one command |
| Worker death before effect | Command requeued with a higher task fence |
| Worker death after ambiguous effect | DLQ with `EFFECT_UNKNOWN`; no automatic retry |
| Poison handler input | DLQ with preserved evidence |
| Broker/publisher failure | Unpublished outbox remains durable and replayable |
| Temporal unavailable during cancellation | Authoritative task remains cancelled; cancellation outbox remains pending |
| Cross-account identifier substitution | Empty/not-found result; no route, task, history, outbox, or DLQ disclosure |

WO-22 must re-run these cases inside the complete cross-boundary tenant-isolation and failover suite. Live Temporal cluster failover and production queue SLOs remain deployment qualification, not a reason to weaken the local deterministic contract.
