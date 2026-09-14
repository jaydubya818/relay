# WO-20 interoperability qualification

Status: `PASSED_LOCAL`

## Exercised contracts

- Codex-labelled TypeScript reference client submitted a canonical action through the public client abstraction.
- Claude-labelled Python reference client is dependency-free, syntax-validated, and shares the published REST/OpenAPI contract. Live product certification is explicitly deferred.
- A generic MCP client discovered the stateless `2026-07-28` server, listed authenticated tools, submitted an action, and received structured output.
- Legacy MCP `2025-11-25` and `2025-06-18` initialization adapters negotiated successfully.
- OAuth resource/audience, tenant, runtime registration, lease audience, workload, and canonical-action bindings fail closed.
- Concurrent idempotent submission persisted one command and one outbox wake-up while consuming one lease call.
- Runtime action state is a structured durable result and uses the existing effect-unknown/dead-letter safety path after disconnect or ambiguous effects.

## Commands

```text
pnpm typecheck
pnpm lint
pnpm exec vitest run tests/v2/developer-platform.test.ts --fileParallelism=false
python3 -c 'import ast; ast.parse(open("sdks/python/relay_v2/client.py").read())'
```

## Tenant boundary coverage added in WO-20

REST commands, MCP access, OAuth token resources, runtime registrations, command status reads, and action outbox messages are account-scoped. The focused suite proves wrong-tenant runtime authentication fails without revealing the command and wrong-resource tokens fail. These cases remain inputs to the cross-boundary WO-22 gate.

## Deferred external qualification

Published-package signing, live Claude/Codex vendor certification, hosted authorization-server conformance, and independent security review require external environments or owners. They do not weaken the local contract and remain release qualification inputs where applicable.
