# Relay V2 same-account Agent delegation

WO-19 supports attached, same-account parent/child task delegation. It does not support cross-account delegation, public reputation, detachable children, or implicit access to the parent's context.

## Creation

A parent workload calls `agents.task.delegate@1.0` under an online capability lease. The immutable action binds:

- active parent task and Agent;
- explicit active child Agent;
- bounded objective;
- named parent leases and maximum delegated calls;
- exact memory IDs in the context manifest;
- named parent budgets and child ceilings; and
- account-local idempotency key.

Relay consumes one call from the delegation authorization lease and creates a new child task. Every child task has one parent delegation. Tasks are always newly allocated, so an existing task cannot be reparented into a cycle. Depth is limited to 8 and active fan-out to 16.

## Authority intersection

An authority record snapshots the parent lease capability/resource and a call ceiling. Relay accepts it only when:

- the parent lease is active and bound to the same parent account, Agent, and task;
- the child Passport is eligible for the exact capability;
- live parent calls, already-issued child calls, pending promised calls, and the new promise fit under the parent maximum; and
- the child later presents its own workload identity, policy decision, task-bound action, and any required delegation-derived budget reservation.

Claiming authority mints a normal WO-08 child lease whose resource is equal to or narrower than the parent resource. Claim is single-winner. Parent lease revocation recursively revokes every descendant lease.

## Context

V2 context transfer is intentionally restricted to explicit durable memory IDs. Relay resolves them from the authoritative account store. Private memory must have been created by the parent Agent; the child Passport must allow confidential `memory` access. The child context API returns only snapshot entries in the signed manifest. No general memory search or ambient parent context is available.

Provenance exports include context hashes, not context contents.

## Budgets

Each delegated ceiling creates a `DELEGATION`-scoped child budget beneath an account/parent-Agent/parent-task/current-parent-delegation budget. Sibling promised ceilings, consumed amount, and currently reserved amount cannot exceed the parent at creation. Actual child reservations traverse and charge the entire parent chain under WO-09's account lock. Delegation lineage is resolved from Relay records, never caller-declared task or Agent IDs.

## Completion and revocation

Completion requires a terminal child task and optionally references same-account evidence artifacts. Relay redacts and hashes the result, revokes remaining child leases and authorities, disables child budgets, and emits `delegation.result.ready` to the parent task.

Revoking a delegation recursively revokes its descendant delegations, child leases, task commands, and budgets and cancels active child tasks. V2 children are never detachable.

