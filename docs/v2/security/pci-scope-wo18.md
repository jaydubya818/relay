# WO-18 PCI scope assessment

Status: implementation assessment; independent security/legal validation remains required before any payment-provider expansion.

## Scope decision

Relay V2 does not capture, transmit, process, or store raw cardholder data or sensitive authentication data. It does not render a Relay-owned payment form, proxy card fields, expose a credential to an Agent/runtime, or execute a payment. The human enters credentials directly into the merchant/payment-provider surface while Relay observation is suppressed and Agent input is fenced.

Relay stores only:

- a tenant-bound opaque vault reference and human-readable label;
- canonical purchase intent and approval evidence;
- merchant/provider references;
- redacted receipt metadata; and
- budget reservation/reconciliation records.

The opaque reference is not usable by the model/runtime and has no V2 production execution path. The reference must point to a separately controlled broker or user-owned browser credential facility; it is not a substitute for a qualified tokenized payment integration.

## Preventative controls

- Money APIs reject explicit PAN, CVV/CVC, routing, bank-account, account-number, and IBAN keys.
- Luhn-valid 13–19 digit payment numbers are rejected even under benign keys.
- Shared evidence redaction removes sensitive payment keys and detected payment numbers.
- Protected checkout atomically changes the controller from Agent to human and enables content suppression.
- Checkout responses omit the vault handle.
- Production rejects the simulated executor.
- No unattended payment connector, transfer, custody, credit, or raw credential endpoint exists.

## Residual risks and required operations

- A merchant page, browser extension, screenshot subsystem, crash dump, or telemetry agent could capture payment data outside the Relay application boundary. Production qualification must verify content suppression end to end and prohibit capture during protected entry.
- Human receipt metadata may contain unexpected sensitive strings. Rejection and redaction are defense in depth, not permission to submit card data.
- PCI applicability depends on the eventual deployment, merchant/payment-provider integration, and contractual flow. Security/legal must confirm classification before beta and repeat the assessment if Relay adds tokenized execution.
- Any future automated payment adapter is a new security boundary and requires a separate WorkOrder, provider qualification, PCI review, secret-broker design, fraud controls, dispute/refund handling, and explicit Product Owner approval. It is not authorized by WO-18.

