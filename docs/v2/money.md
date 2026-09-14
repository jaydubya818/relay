# Relay V2 money boundary

WO-18 lets Relay represent read-only financial data and control purchase intent without becoming a wallet, payment processor, bank, or credential store.

## Supported V2 flow

1. An Agent proposes a canonical `money.purchase.request@1.0` action containing the merchant identity, exact amount, currency, line items, tax/shipping tolerance, task, idempotency key, and an opaque payment-credential reference.
2. Relay reserves `requested amount + tolerance` against an account/Agent/task purchase budget before accepting the intent.
3. Policy must require a financial approval. A human approves the immutable action once; task/session financial approval is rejected by the approval service.
4. The same human begins protected checkout on a computer already bound to the task. Relay atomically consumes the approval, fences Agent input, rotates the control fence, suppresses observation, and returns only the credential label—not its vault handle.
5. The human reviews the merchant, currency, and exact checkout total. Any change revokes the checkout permit, pauses the computer, releases the reservation, and requires a new action and approval. The declared tolerance is contingency budget headroom, not silent authority to accept a changed total.
6. The human commits payment outside Relay and records either a confirmed provider reference/receipt or `EFFECT_UNKNOWN`. Relay reconciles a confirmed amount; an ambiguous outcome marks the reservation and affected budgets unknown and cannot be retried.
7. Relay pauses after checkout. Agent control resumes only through WO-15 policy and integrity checks.

There is no production `purchase.execute` implementation in V2. The simulated executor is test-only and refuses production use.

## Financial imports

The financial aggregator registry accepts only adapters explicitly represented as `QUALIFIED` and exposes a read-only method. Relay ships with no enabled aggregator. Until product/security selects and qualifies one, account and transaction import fails closed with `CONNECTION_REQUIRED`.

Imported records are account-scoped and redacted before provider metadata is persisted. They do not grant payment authority and contain no usable account credentials.

## Invariants

- Raw PAN, CVV/CVC, routing numbers, bank-account numbers, IBANs, and Luhn-valid payment numbers are rejected from money APIs.
- The evidence redactor removes payment-key fields and Luhn-valid payment numbers before persistence.
- Credential references contain only an opaque vault handle. Handles are never returned to the Agent or protected-checkout response.
- Purchase intent, approval, reservation, task, Agent, runtime, control session, permit, and receipt are bound to one account.
- Checkout permits are hashed at rest, human-principal-bound, short-lived, single-use, and control-fence-bound.
- Only exact merchant, currency, and total equality can reach `COMMIT_READY`.
- `EFFECT_UNKNOWN` is terminal for execution and requires human reconciliation.

## States

`PENDING_APPROVAL → READY_FOR_CHECKOUT → HUMAN_CHECKOUT → COMMIT_READY → {COMPLETED | EFFECT_UNKNOWN}`

Any material checkout change transitions `HUMAN_CHECKOUT → REVIEW_REQUIRED`. A pre-effect cancellation or changed checkout releases reserved budget. `REVIEW_REQUIRED`, `COMPLETED`, `EFFECT_UNKNOWN`, and `CANCELLED` do not permit payment execution.

