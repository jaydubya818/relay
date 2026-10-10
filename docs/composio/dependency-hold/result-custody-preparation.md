# Transport result custody and canonical recovery boundary

The adapter now captures its exact bound result identity before dispatch and checks
every returned result against that snapshot. This is an integrity boundary, not a
new admission, result receipt, authorization registry, or recovery state machine.
The gateway remains closed and the SDK remains `@composio/core@0.22.0`.

The snapshot includes provider/adapter, scope digest, connection and authority
revision, tool/version/schema, arguments, full execution binding, action, policy
decision, lease and approval. A successful transport result must contain a bounded
projected payload with its matching digest and no error. UNKNOWN must contain a
bounded error code and no payload, result digest or retry instruction. Unexpected
metadata, altered bindings, residual redactable secrets and oversized data are
rejected. Returned data is detached and frozen; instruction-like content retains
`UNTRUSTED_EXTERNAL_DATA` classification.

`captureResultIntegrity` deliberately permits checking the integrity of a late
result after lease expiry. It does not authenticate its caller or provider, verify
signatures, authorize readback, change UNKNOWN, settle budgets, or write a native
MyEve Result/Proof. The canonical receiver must perform those operations against
its admitted immutable command/attempt and current recovery authority. A caller
that invents both a snapshot and matching data has demonstrated no authority.

## Receiver-owned implementation requirements

- Reuse canonical task command/call/reservation identifiers and the original
  scoped idempotency key. A changed action must conflict. Do not create a second
  lease debit or authorization table in `lib/integrations`.
- Commit lease consumption, admission command and reservation linkage atomically.
  The preserved `submitDurableRuntimeAction` and `authorizeLeaseCall` use separate
  transactions; wrapping the former from an adapter does not close that window.
- Reuse native `task_commands.effect_state`: `POSSIBLY_COMMITTED` records possible
  effects; existing orchestration fences uncertain starts as `EFFECT_UNKNOWN`.
  These functions currently serve start commands and require the owner's reviewed
  receiving implementation before applying them to Composio execution.
- Persist dispatch intent and fence competing workers before any provider call.
  A worker lease expiring does not prove that a provider call did not happen.
- Preserve budget exposure when an outcome is UNKNOWN. Existing
  `markBudgetReservationUnknown` retains exposure; ordinary RESERVED expiry may
  release it. Existing reconciliation accepts RESERVED rather than arbitrary
  UNKNOWN settlement. The owner must qualify the ordering and recovery transition;
  the adapter cannot guess a release or reset a reservation to enable a retry.
- Commit accepted projected result, native evidence and command outcome using
  the owner's result custody transaction. Existing encrypted artifact storage
  does not itself atomically finalize a command or create MyEve Result/Proof.
- Authenticate reconciliation and readback through current owner/runtime/Work
  authority. Check exact command/attempt, installation, action and evidence
  provenance; retain UNKNOWN on missing, stale, conflicting or unavailable
  evidence. Revocation cannot turn a readback into another execution.

The focused transport tests cover binding substitution, credential exclusion,
size bounds, immutable data, UNKNOWN shape and late inspection. They do **not**
qualify durable UNKNOWN recovery, provider provenance, successful receiver
admission or successful execution idempotency. Those gates still require the
designated authorized nonproduction receiver and independent review.
