# Six baseline skips: local qualification

All six tests were individually enabled and passed. These are local provider and
MyEve component checks, not designated Composio receiving admission or positive
external integration qualification. The normal suite retains explicit opt-in
guards for these environment-dependent tests; no new skips were introduced.

| Test file | Count | Required flags |
| --- | --- | --- |
| `tests/browser/playwright-live.test.ts` | 3 PASS | `RELAY_LIVE_PLAYWRIGHT=1` |
| `tests/sandbox/docker-live.test.ts` | 1 PASS | `RELAY_LIVE_DOCKER=1`, pinned `RELAY_SANDBOX_IMAGE` below |
| `tests/v2/relay-managed-provider-live.test.ts` | 1 PASS | Both flags above and pinned image |
| `tests/v2/channel-myeve.integration.test.mjs` | 1 PASS | `RELAY_MYEVE_TESTS=1`, `RELAY_MYEVE_SOURCE`, `RELAY_TEST_DATABASE_URL` |

Run each file with `pnpm exec vitest run <file> --fileParallelism=false` using
the repository's Node version. Browser fixtures use data URLs, context isolation,
TTL cleanup and private-network denial. Docker fixtures use disposable networkless
containers and synthetic files. The existing local `node:24-alpine` image was
pinned by `RELAY_SANDBOX_IMAGE=sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1`;
no image was pulled and no daemon setting changed. Test cleanup destroys only the
containers it creates.

MyEve source was an immutable Git archive of preserved compatibility commit
`9200bd3826350ad586bb5640ca08557da7d1b984`, with existing local dependencies reused
read-only. It was not the canonical owner's moving working tree. Both Relay and
MyEve use separate disposable `relay_test_*` databases on the task-owned local
PostgreSQL cluster. The initial test failed because it installed MyEve in an
alternate schema while canonical SECURITY DEFINER functions pin `search_path` to
`public`. The corrected fixture uses a dedicated database and guarded cleanup,
preserving the source migrations and their security boundaries. All pinned
migrations run; they include restricted NOLOGIN role declarations on the synthetic
cluster. The test's adapters are in-process synthetic implementations and send
no provider or message traffic.

Original schema-failure evidence is retained separately from corrected PASS logs.
Database cleanup also runs when setup fails. These checks establish the stated
local component behavior; they do not qualify the separate canonical receiving
transaction, durable Composio UNKNOWN reconciliation or positive Sofie journey.
