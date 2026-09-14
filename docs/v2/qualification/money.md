# WO-18 qualification record

## Local claims

The focused suite validates:

- immutable merchant/amount/currency/item/credential binding;
- exact purchase reservation and once-only financial approval consumption;
- exclusive protected human control and credential-content suppression;
- changed-total re-prompt behavior;
- confirmed receipt and exact budget reconciliation;
- terminal unknown-effect handling without retry;
- concurrent intents respecting a shared budget hard limit;
- raw test-card rejection and evidence redaction;
- production refusal of the simulated executor;
- account isolation for purchase intents, permits, receipts, computer bindings, and disabled aggregator access.

Commands:

```text
RELAY_TEST_DATABASE_URL=postgresql://127.0.0.1:55432/postgres pnpm exec vitest run tests/v2/money.test.ts --fileParallelism=false
pnpm typecheck
pnpm lint
pnpm db:check
```

## External qualification

- No financial aggregator is selected or enabled. Read-only account/transaction import is disabled until a provider passes security, privacy, permission, webhook, revocation, and data-quality qualification.
- Protected checkout still requires WO-22 production validation of video/screenshot suppression, browser-extension policy, telemetry/log redaction, accessibility behavior, and reconnect/failure handling.
- Independent PCI/security/legal review is required before beta claims are finalized.
- Automated/tokenized payment execution remains excluded from V2.

