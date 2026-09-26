# Relay first-beta invitation deployment checklist

Status: **NO-GO** until the exact release revision, production database lineage, Builder origin, and fresh-owner acceptance are verified. Current Relay main contains `drizzle/0024_beta_invites.sql`, the owner invitation UI, and invite-only signup. [PR #24](https://github.com/jaydubya818/relay/pull/24) keeps the one-use token out of query strings. The old UI-audit worktree has a different `0024_tester_invitations.sql` design and must not be used as this release source.

## Current production facts (read-only, September 26, 2026)

- Relay alias: `https://relay-jaydubya818.vercel.app`; Vercel reports the production deployment Ready. Its CLI deployment metadata has no Git commit SHA, so the exact source revision must be established before diffing or replacing it.
- `RELAY_FEDERATION_ENABLED=true`, `RELAY_CRYPTO_BACKEND=vercel-secret`, `RELAY_DEPLOYMENT_MODE=production`, `RELAY_ALLOW_SIGNUP=false`, and `NEXT_PUBLIC_RELAY_URL` is the alias above. These are config observations, not proof that an external peer exchange works.
- Current Relay main uses `RELAY_BETA_INVITER_EMAILS` (falling back to `RELAY_ADMIN_EMAIL`) plus `RELAY_ALLOW_SIGNUP=false`; it does not use the older branch's `RELAY_REQUIRE_INVITE`, `RELAY_TESTER_INVITE_ISSUER_EMAIL`, or `RELAY_TESTER_BUILDER_URL`. The invite route and `beta_invites` migration are not known to be deployed at the live alias.
- A read-only connection to the configured production database did not complete from this audit host. The temporary pulled environment file was removed. Migration lineage and pre-deploy counts are **unverified**.
- Relay main at `221a9e7` contains the invitation implementation. On the isolated PR #24 candidate, local auth tests (7/7), typecheck, lint, migration consistency, build, and a synthetic clean-browser signup/replay check passed. This does not establish production database lineage or Builder readiness. Relay PR #20 was closed without merging and is separate Factory work.

## Invariants

- Existing owner accounts, users, sessions, Agent registrations, grants, and Factory routing keep working.
- Open public signup stays disabled. Only the configured issuer can create a one-use invitation to an exact email. Invitation creation does not grant an Agent any capability.
- The additive migration creates `beta_invites`, its account and issuer foreign keys, and two indexes. It does not change existing rows. The invite stores the issuing account for audit; redemption creates a separate new account.
- Consuming an invitation creates exactly one new owner account and user; a failed or replayed redemption creates none.
- A rollback never deletes a newly created beta account or drops the invitation audit table automatically.

## Read-only pre-deploy audit

Run against the exact production database with a read-only role or `BEGIN READ ONLY`. Record results privately with the deployment ID; do not put URLs or credentials in this report.

```sql
BEGIN READ ONLY;
SELECT current_database() AS database_name, now() AS checked_at;
SELECT to_regclass('drizzle.__drizzle_migrations') AS migrations_table,
       to_regclass('public.beta_invites') AS invitation_table;
SELECT count(*) AS account_count FROM public.accounts;
SELECT count(*) AS user_count FROM public.users;
SELECT count(*) AS agent_count FROM public.agents;
-- Run only if the migrations table exists:
SELECT count(*) AS migration_count, max(id) AS latest_migration_id,
       max(created_at) AS latest_migration_timestamp
FROM drizzle.__drizzle_migrations;
ROLLBACK;
```

Stop if the database is not the configured Relay production database, if the migration table is missing/unexpected, if the applied lineage cannot be matched to this candidate's `drizzle/meta/_journal.json`, or if the invitation table already exists with an unknown shape. Save a provider backup/snapshot and verify its restore path before running any migration. Do not infer lineage from the highest numeric ID alone: compare the stored migration hashes with the candidate SQL files.

## Release steps

1. Record the exact current deployment ID and recover its source revision. Use current Relay main plus the narrowly reviewed PR #24, not the older UI-audit branch. Run typecheck, lint, auth/database tests, migration rehearsal on a clone of the production schema, and production build on the exact SHA.
2. Verify Builder's deployed HTTPS origin, `/api/template-version`, and pinned production delivery signing key ID/version/public key. Set `RELAY_BETA_INVITER_EMAILS` to the pilot operator's exact email. Keep `RELAY_ALLOW_SIGNUP=false` and `NEXT_PUBLIC_RELAY_URL` on the verified Relay origin. Provide the Builder URL directly in the guided packet; merged Relay has no `/setup` page.
3. Apply the migrations in order during a recorded window. Do not run `0024_beta_invites` by hand if Drizzle's lineage does not match. Deploy the exact built revision and record deployment ID and target before promoting its alias.
4. Verify existing owner login and Factory receipt lookup. Have the configured issuer create one synthetic exact-email invitation. Confirm an unprivileged owner cannot issue one. Redeem in a clean browser, confirm one new empty account and one consumed invitation, and verify wrong email/replay fail. Confirm the link fragment disappears from the address bar and never appears in the request URL.

Within five minutes of promotion, rerun the account/user/agent counts. Expected account and user deltas are **zero before redemption** and **exactly +1 each after the one synthetic redemption**; the Agent delta remains zero until that owner registers one. The new invitation table starts empty; after one issue and redemption, it has one row with non-null `consumed_at` and a non-null hash. Use aggregates, not plaintext tokens:

```sql
BEGIN READ ONLY;
SELECT count(*) AS invitations,
       count(*) FILTER (WHERE consumed_at IS NOT NULL) AS consumed,
       count(*) FILTER (WHERE token_hash IS NULL OR token_hash = '') AS missing_hash
FROM public.beta_invites;
SELECT count(*) AS account_count FROM public.accounts;
SELECT count(*) AS user_count FROM public.users;
SELECT count(*) AS agent_count FROM public.agents;
ROLLBACK;
```

## Stop, rollback, and 24-hour watch

Stop promotion if migration hashes differ, login breaks, a nonissuer can invite, a wrong-email or replayed link succeeds, an invitation returns another owner's data, the Builder pin differs, or the hosted Agent exchange leaks private Knowledge. Do not weaken auth or publish the invitation link to debug.

If code fails after the additive migration, remove the public alias from the bad deployment or redeploy the previous known-good revision. Stop issuing invitations and preserve the table and any accounts already created for audit. Current main has no invite-revocation UI; use a reviewed database operation if an issued, unconsumed link must be invalidated. Do not restore the whole database merely to undo an additive table. A data-integrity failure requires a separate restore decision from the pre-deploy snapshot.

Watch Vercel 4xx/5xx and function logs for login, invitation creation/redemption, setup, federation, and Factory receipts at promotion, +1 hour, +4 hours, and +24 hours. Any unauthorized invitation or cross-account disclosure is an immediate stop. A new beta user should receive the one-use link only after all checks above and the external MyEve/Factory acceptance in MyEve's `docs/federation/first-beta-release-packet.md` are complete.
