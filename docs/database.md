# PostgreSQL development and migrations

PostgreSQL is Relay's production datastore. Drizzle schema definitions live in `lib/db/schema.ts`; generated, reviewable SQL migrations live in `drizzle/`.

## Local setup

Create a local database and configure Relay:

```bash
createdb relay
cp .env.example .env.local
pnpm db:migrate
pnpm db:seed
```

Set `RELAY_DATABASE_URL` to the database connection string. `DATABASE_URL` is accepted as a deployment-platform fallback. Production startup fails when neither is configured.

## Migration workflow

After changing `lib/db/schema.ts`:

```bash
pnpm db:generate
pnpm db:check
pnpm db:migrate
```

Commit the schema, generated SQL, and Drizzle metadata together. Apply migrations as a separate release step before starting new application instances. Migration application is idempotent and tracked by Drizzle in PostgreSQL.

## Tests

Database-backed tests create isolated temporary PostgreSQL databases, apply the real migration set, run, then drop those databases. The default test administrator URL is `postgresql://127.0.0.1:55432/postgres`; override it with `RELAY_TEST_DATABASE_URL`.

```bash
pnpm test:database
```

Tests require permission to create and drop databases. Never point `RELAY_TEST_DATABASE_URL` at a production cluster.

## V0 development data

Relay does not silently import SQLite files. V0 data migration must be an explicit, offline operation with a source backup, an empty PostgreSQL target, deterministic ID preservation, and row-count verification. The development seed can be recreated safely; production-like V0 data must use the dedicated migration command once that command has been qualified.
