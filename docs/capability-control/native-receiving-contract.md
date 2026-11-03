# Canonical native receiving contract

Canonical admission remains `relay.native-admission.v1` through `admitNativeCommand`. `createNativeReceiver` is its concrete host and worker. It uses existing Task commands, lease call receipts, policy outbox and audit records. It introduces no capability registry, execution ledger, production configuration or automatic execution gateway.

## Installation inputs

Bind exact authenticated canonical owner, Relay owner principal, organization, account, installation, backend, incarnation and enrollment version. Work resolves from active canonical Tasks, owner-created matching routes, and authenticated VERIFIED events with `relay.native-work.v1` and `data.nativeWork` containing ownerId, organizationId, installationId, workId, missionId and workGeneration. No caller lineage is accepted without those records. Signed MyEve/Relay policy mirrors acknowledge the exact durable version only against independent current policy witnesses.

Install a durable linearizable recovery witness scoped to this installation/backend/incarnation outside the receiver database backup domain. It stores one monotonic integer, no Work or authority. Compare-and-advance precedes local dispatch-intent commit. Restore or ambiguous commit yields a mismatch and quarantines further dispatch. Never initialize/reset this witness from a restored database. An independently qualified new incarnation and authoritative UNKNOWN reconciliation are required for recovery; this source does not manufacture either.

## Consumer composition

Pin consumer `80f759c3eeca318811113856ae9bc4d62c1aa271`, `createNativeConsumerPort`, separately from the canonical source. The consumer retains all 27 frozen owner contract groups. Its reviewed connection SELECT is executed by the receiver under account fencing and a PostgreSQL deadline. The synchronous resolver receives rows, never a transaction handle. Qualified descriptors are installed server-side; the adapter independently checks remote descriptor and connected-account identity before transport.

Consumer source selection is an explicit module boundary, not permission to overwrite either source tree or merge two independent authority implementations. The composed test checks the exact source and clean relevant files before loading the consumer integration modules against the canonical database ABI. The composed fixture applies the exact pinned consumer's qualification SQL to a disposable canonical database, including its foreign keys and binding constraints. This does not authorize an installed migration. Installed packaging and custody still need source-bound qualification.

## Execution and recovery

Use `receiver.admit(input)` so admission uses bounded installed cryptographic ports. Before dispatch, verify Work, owner, agent, current witnessed policies, connection, descriptor, consumed signed lease and applicable approval/reservation. Ordinary disable preserves admitted bounded authority; later relevant pause/revoke controls fence it. Original authority and worker expiry are checked immediately before send. The command records POSSIBLY_COMMITTED before any provider call. One attempt only; retries/readback cannot issue new authority or dispatch UNKNOWN.

Bound witness/provider waits, cancel local SELECTs in PostgreSQL, propagate receiver cancellation through the adapter, and discard late provider output after timeout. Timeout never means STOPPED. Revocation fences active writers; signed scoped monotonic resource evidence distinguishes STOP_UNKNOWN, STOP_CONFIRMED and CLEANUP_CONFIRMED. Pre-effect commands can confirm no resource exists. Delivery and recovery remain available after account retirement; new admission and dispatch do not.

Result custody requires an exact account/command-kind/worker/fence match and PROCESSING status. A concurrent cancellation that wins this comparison cannot be overwritten by a late result; no result receipt or audit entry commits, and the earlier ambiguous dispatch intent remains.

UNKNOWN accounting exposure is preserved. This receiver does not release, reconcile or alter monetary ceilings, approval use counts, or reservations. Connected-app admission is zero monetary authority and still requires the existing CONNECTOR_CALLS reservation.

## Operational limits

Recovery-witness quarantine gates dispatch, not admission. A restored installation can consume a lease/approval/reservation for a command that subsequently cannot dispatch; this is retained evidence, not renewed execution authority. Pre-send denials after committed dispatch intent conservatively remain UNKNOWN. Provider operations serialize under the account lock; each external wait has a deadline, but the entire transaction can contain multiple such waits. These limits do not authorize bypass or automatic reconciliation.

## Qualification and holds

Focused local PostgreSQL: 69 tests passed across admission, receiver, leases and orchestration, including concurrent retry, ordinary disable, revocation replay, exact owner, approval, restore, deadline, crash, late-result, cleanup and legacy-writer isolation. Exact consumer composition: positive admission through real PostgreSQL and canonical lease/command to mocked SDK, duplicate suppression, disable denial and prior-result preservation passed. No remote provider calls.

Full regressions, fresh source qualification, exact-SHA hosted CI, browser composition, final independent review and installed witness/custody remain gates. Public execution stays disabled. No merge, deployment, real installation migration, paid operation, credentials change or tester activation is authorized.
