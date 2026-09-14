# WO-19 delegation invariant report

## Qualified invariants

- One newly allocated child task has at most one parent delegation.
- Self-delegation is rejected; depth is capped at 8 and active fan-out at 16.
- Cross-account parent tasks, child Agents, Passports, leases, memories, budgets, artifacts, results, and queries fail closed.
- Child Passport eligibility intersects every promised capability.
- Pending promises plus issued descendant calls cannot exceed live parent call authority.
- Claiming an authority is single-winner and mints a normal parent-linked WO-08 lease.
- Revoking a parent lease recursively revokes all descendant leases.
- Only exact declared memory IDs appear in child context; undeclared and foreign private memory is absent.
- Delegated budgets are scoped to the authoritative delegation lineage and actual use charges all ancestors.
- Completion/revocation removes remaining child authority and returns a durable parent-task event.
- Signed provenance reconstructs every parent/child link, authority, budget, context hash, result hash, and evidence reference without exporting context contents.

## Qualification commands

```text
RELAY_TEST_DATABASE_URL=postgresql://127.0.0.1:55432/postgres pnpm exec vitest run tests/v2/delegations.test.ts tests/v2/budgets.test.ts tests/v2/leases.test.ts --fileParallelism=false
pnpm v2:frontier:check
pnpm typecheck
pnpm lint
pnpm db:check
```

The focused suite includes rejection matrices for cycles, pending-authority amplification, wrong delegation budget scope, repeated authority claim, parent lease revocation, undeclared memory, cross-tenant queries, and cascade revocation.

## Deferred production evidence

WO-22 must load-test depth/fan-out creation, recursive revocation latency, outbox delivery, worker loss during authority claim, and signed provenance export at production scale. Cross-account/organization delegation remains outside V2.

