# Relay V2 Budget Engine

## Scope

Relay budgets are authorization and usage-control records. They are not invoices, bank ledgers, wallets, exchange-rate services, credit facilities, or a substitute for a payment provider's authoritative balance.

WO-09 supports six independently metered dimensions: tokens, model spend, connector calls, compute seconds, computer seconds, and purchase amount. Monetary dimensions use an explicit ISO 4217 currency. All quantities are PostgreSQL `numeric(30,9)` values and cross the service boundary as decimal strings; binary floating-point values are not accepted.

## Hierarchy and reservations

A budget is scoped to an account, Agent, task, or delegation. A child inherits the dimension, unit, and currency of its parent. Reservations are charged to the selected leaf and every ancestor in a single transaction. A per-account PostgreSQL advisory transaction lock serializes creation, reservation, reconciliation, release, expiry, and balance-status changes. Conditional updates still enforce each hard ceiling at the database boundary.

Child creation cannot exceed the parent's current unreserved and unconsumed remainder. Children do not pre-allocate or duplicate parent capacity: actual reservations consume the entire ancestor chain. Soft ceilings emit durable, account-scoped warning events but do not silently change a hard decision.

Reservation and usage idempotency keys are unique within an account. Reuse with identical inputs returns the original result; reuse with changed inputs is rejected. Releases and expiry restore reserved capacity. Reconciliation converts reserved capacity to exact observed usage. If actual usage exceeds the reservation and no longer fits the hierarchy, Relay records the truthful usage, marks affected balances and the reservation `UNKNOWN`, emits drift events, and prevents consequential use until reconciled.

## Execution binding

Capability definitions declare zero or more metering dimensions. A metered capability lease cannot be issued without an active reservation bound to the same account, Agent, task, and action intent and to a declared dimension. Binding is one-to-one and atomic with lease issuance.

The online policy-enforcement point verifies the reservation remains active and unexpired before each call. Purchase execution additionally requires every applied budget balance to be `CURRENT` and observed within five minutes. Released, expired, stale, unknown, disabled, or cross-account budget state fails closed.

## Operational targets

- Reservation decision: p95 below 100 ms and p99 below 250 ms under the production concurrency target, measured separately from upstream policy evaluation.
- Meter ingestion acknowledgement: p95 below 250 ms while preserving the idempotency record durably.
- Reconciliation freshness: 99% of provider usage records reconciled within five minutes; unreconciled or conflicting consequential usage transitions to `UNKNOWN`.
- Expiry recovery: expired reservations released within 60 seconds by the WO-10 scheduler; authorization still rejects them immediately using their stored expiry.
- Alerting: hard-limit denial, soft-limit warning, unknown balance, and reconciliation overage are observable by account and dimension.

## Tenant boundary

Every budget, reservation, usage record, and warning event carries `account_id`. Service reads and mutations pair resource identifiers with the caller's account. Agent ownership is resolved from Relay persistence before reservation. Tests cover cross-account resource IDs, principal membership, queries, status mutations, and event visibility. WO-22 must include this boundary in the complete cross-boundary isolation suite.
