# Execution, result custody and Sofie recovery preparation

**Preparation only. No dispatcher, authorization ledger, admission receipt type or positive route is introduced.** The [canonical owner handoff](canonical-owner-handoff.md) owns the unresolved receiving transaction. Descriptive stages below are not a new persisted state machine.

## Idempotency and recovery acceptance matrix

Reuse existing canonical command/call/reservation IDs and the same intent key for every retry of that intent. Scope by authenticated account/runtime and exact effect-relevant request, including owner/installation/agent/connection/action/descriptor/arguments. Reauthenticate each read/replay; changed material under the same key conflicts. Retention must cover the owner's longest retry, reconciliation, lease and audit horizon; the owner must specify that duration and tombstone behavior rather than allow expired keys to become fresh intent.

| Interruption / fixture boundary | Required behavior | Current qualification |
|---|---|---|
| Before positive admission | No provider call; durable denial as applicable | Existing gateway plus new PostgreSQL denial fixtures pass. |
| Denial signed transaction fails | Receipt and audit both roll back; later request can record one denial | New signer-failure + pool-reconnect fixture. |
| Denial committed, client reply lost | Concurrent replay returns one existing denial; no dispatch or new audit record | Eight concurrent replays after pool reconnect; wrong agent rejected. |
| Lease consumed, command not committed | Canonical owner reconciles call/reservation/command; no fresh lease as a workaround | Required, not qualified. Separate existing transactions identified in handoff. |
| Admission committed, worker not claimed | Read back existing command; owner-defined dispatch fence remains required | Required, not qualified. |
| Dispatch intent persisted, provider call uncertain | UNKNOWN; do not infer that a stale worker lease proves no call occurred | Required, not qualified. |
| Provider success, local result/evidence commit lost | UNKNOWN until authoritative reconciliation; no duplicate provider execution | Required, not qualified. |
| Local timeout followed by late provider success | Previously returned outcome stays UNKNOWN; no implicit retry or later success mutation | New deterministic transport-only fixture. No durable reconciliation claim. |
| Connection revoke committed, upstream acknowledgment absent | Local revoke survives restart/readback and continues denial | PostgreSQL pool-reconnect fixture; no upstream call made. |
| Settlement or acknowledgment lost | Replay canonical settlement/receipt by original identity; never reexecute tool | Required, not qualified. |

Pool reconnect and injected transaction failure exercise durable database behavior. They are **not** process-kill, multi-database restore or real provider crash-recovery qualification. Do not relabel them as such. Transport fixtures call only in-process synthetic stubs; they do not issue permits or exercise the closed production gateway positively.

## Provider-result custody requirements

Current adapter output is an internal `IntegrationResult` labeled `UNTRUSTED_EXTERNAL_DATA`. A synthetic SUCCEEDED transport response is not native MyEve Result/Proof, a signed custody receipt or evidence of canonical admission.

The future canonical result writer must:

- Accept output only from the admitted fenced command/attempt; recheck exact account/owner/installation/agent/Work/connection and execution-binding/action hashes, lease/call/reservation and approval identities. A provider result cannot select its owner, mutate grants or approve another action.
- Use the reviewed tool-specific output projection; discard raw credentials, provider diagnostics and unreviewed fields. Retain the existing 64 KiB projected-result bound. Descriptions, issue titles and other returned text remain untrusted data, including instruction-like content.
- Persist only the permitted projected payload plus canonical digest and the owner's native Result/Proof reference. Keep raw provider bodies out of prompts, audit rows, logs and browser storage. Canonical evidence may attest to origin/binding/custody without declaring provider content true or trusted.
- Commit custody/evidence/command outcome and reconcile reservation/usage using the qualified canonical ordering. Failed evidence/settlement or an ambiguous commit must not report a grounded result prematurely. No parallel integration result table or proof format is added here.
- Authorize durable readback using current canonical owner/runtime/Work access; connection revocation cannot become a cross-owner read bypass. The owner must specify historical-result access and retention/deletion policy. No new retention duration is inferred by this integration.

The added fixture proves projected output excludes the synthetic token, keeps instruction-like text untrusted, binds the result digest and is independent of later mutation of the original provider object. It does not persist a success or assert native Result/Proof qualification.

## Sofie consumer and deterministic Golden Journey fixtures

Keep existing authenticated runtime/lease authority described in [the compatibility contract](../checkpoint-3/sofie-runtime-lease.md). An agent credential is not runtime authentication. Caller-supplied headers cannot choose trusted audience, workload, issuer or verifier. Genuine runtime/lease compatibility remains covered by the existing PostgreSQL tests; no MyEve source or runtime route is changed here.

The prepared success scenario is: owner login → authenticated Sofie Work → “Find my assigned GitHub issues” → exact connection → bounded qualified discovery → canonical policy/receiving admission → one deterministic provider response → native signed Result/Proof → grounded answer → browser reconnect → authenticated durable readback. **Stop at missing admission today.** Never inject an allow flag to manufacture later phases.

| Scenario | Deterministic input / expected consumer behavior |
|---|---|
| Available connection, missing canonical receiver | Existing NOT_DISPATCHED code; “Relay has not enabled this read, so I have not retrieved your issues.” No issue summary. |
| Revoked connection | CONNECTION_REVOKED; no provider request, no reconnect that resurrects the old identity. |
| Stale policy or schema substitution | Deny; refetch permitted metadata only. Do not reinterpret discovery as authorization. |
| Wrong owner/agent/installation/runtime/lease | Deny without foreign metadata/result disclosure. |
| Future qualified success fixture | Reviewed GitHub assigned-issues schema, `{per_page:10}`, projected issue `{number:7,title:"Fix connection retry"}`. Display only after owner-provided canonical Result/Proof and matching digest. Not executed as a composed positive journey. |
| Future provider ambiguity | Show UNKNOWN and correlation reference, no success summary and no automatic execution retry. |
| Instruction-like issue title | Treat as quoted external content, never as a tool instruction or authority change. |
| Browser reconnect | Reauthenticate and read canonical durable status/Result/Proof by existing command identity. Do not submit a new tool action on mount. Positive readback awaits receiving/result contract qualification. |

The current browser catalog/denial journeys are qualified separately. Existing tests cover stale/revoked/unauthorized/substituted bindings. New recovery fixtures extend denial durability and adapter output behavior only. Positive end-to-end execution idempotency, UNKNOWN reconciliation and the Sofie Golden Journey remain on dependency hold.
