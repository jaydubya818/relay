# Relay V2 private-preview deployment

This profile gives the Product Owner an HTTPS-hosted, owner-only Relay dashboard without claiming limited-beta readiness. It is not a production execution profile. V2 runtime action submission is unconditionally disabled in `private-preview` mode, signup is disabled, and third-party providers, communications, connectors, money movement, customer runners, and durable production evidence signing remain unavailable.

## Topology

- Vercel hosts the Next.js dashboard and HTTP API in `sfo1`.
- A dedicated managed PostgreSQL database is the durable account store. It must require TLS and have automated backups.
- A separately hosted worker runs `pnpm worker` from `Dockerfile.worker`. It shares only the database and Relay application secrets needed for expiry/cleanup work.
- Vercel and the worker receive secrets from their platform secret stores. No `.env` file is committed or copied into an image.

## Required configuration

Set these independently in the Vercel Preview and Production environments and in the worker service where applicable:

```text
RELAY_DEPLOYMENT_MODE=private-preview
RELAY_V2_ACTIONS_ENABLED=false
RELAY_ALLOW_SIGNUP=false
RELAY_DATABASE_URL=postgresql://...?...&sslmode=require
RELAY_DATABASE_POOL_SIZE=1
RELAY_SESSION_SECRET=<at least 32 random characters>
RELAY_ENCRYPTION_KEY=<at least 32 random characters>
RELAY_ADMIN_EMAIL=<owner email>
RELAY_ADMIN_PASSWORD=<at least 16 random characters>
NEXT_PUBLIC_RELAY_URL=https://<relay host>
RELAY_ISSUER_URL=https://<relay host>
```

OAuth and managed-execution settings stay unset. Never copy V1 credentials into this environment. Validate the configuration locally through a trusted secret-injected shell with `pnpm deploy:check`; the validator prints failures by variable name and never prints values.

## Deployment sequence

1. Create a dedicated managed PostgreSQL project in the chosen region. Enable TLS, automated backups, and deletion protection.
2. Save baseline database inventory, run `pnpm db:migrate`, and run `pnpm db:bootstrap-owner` from a trusted administrative job. The bootstrap creates only the configured owner, is idempotent for an exact match, refuses ambiguous pre-existing state, and never prints the password. Never run `pnpm db:seed` in a hosted environment; that command is for local demo data.
3. Create and connect the Vercel project, configure the required environment variables, and deploy this repository.
4. Deploy `Dockerfile.worker` to a service that supports an always-running process. Use one instance for the preview and confirm its structured `maintenance_cycle` log.
5. Verify `/api/health` and `/api/health/ready`, sign in as the configured owner, and confirm signup returns 403.
6. Confirm an authenticated V2 REST action and MCP `tools/call` both fail with `CAPABILITY_DENIED`; no outbox/task record may be created.
7. Bind the observed GitHub Actions `quality` check to `main`, require the branch to be up to date, and protect the deployment environment.

## Go/no-go checks

Go only when the following are all true:

- The Git commit deployed is recorded and its CI `quality` job passed.
- Readiness reports database, migrations, and events as ready.
- Signup is disabled and only the owner account exists.
- Runtime actions fail closed because the environment is `private-preview`.
- The worker completes a maintenance cycle without repeated errors.
- A database backup exists and an isolated restore has been rehearsed.
- No V1 credential, database, OAuth application, or deployment is used.

Stop or roll back on authentication errors, cross-account results, migration mismatch, missing TLS, repeated worker failure, unexpected task/outbox creation, or any secret in logs. Rollback disables the Vercel deployment, stops the worker, preserves the database and evidence, and rotates any exposed secret. Do not reverse applied additive migrations merely to roll back application code.

## Qualification boundary

This deployment can close CI and private-preview hosting configuration only. It cannot close WO-22 production KMS/HSM, object storage, Temporal, provider/channel/connector, customer-runner, penetration-test, independent security review, accessibility/comprehension, payment-scope, production recovery, or limited-beta decision gates.
