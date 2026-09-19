# Relay V1 RC1 soak runbook

## Purpose and scope

Use this runbook for several days of normal Claude Code and Codex work against `relay-v1.0.0-rc.1`. The soak is an operational qualification of the already-qualified V1 capability plane. It does not authorize V2 work, new capabilities, changes to the RC1 tag, or a merge to `main`.

Record defects on the soak branch. Do not repair the tagged commit in place.

## Daily startup checklist

1. Confirm the checkout and immutable RC state:

   ```sh
   git status --short --branch
   git rev-parse relay-v1.0.0-rc.1^{}
   ```

   The tag must resolve to `43e0160eb2b9552f71154d18369e4626e0e79339`.

2. Load the ignored local environment and start the existing PostgreSQL service using its installed service manager:

   ```sh
   source .env.local
   pg_isready -h 127.0.0.1 -p 55432 -d relay_e2e_playwright
   ```

   Do not print OAuth credentials or Relay secrets. Run `pnpm db:migrate` only when moving to a newer reviewed build; the soak check verifies that the checkout and database migrations match.

3. Confirm no Relay process is using port 3000. Stop any existing Relay dev or production process cleanly before building; do not run `next build` while `next dev` or `next start` is using the same `.next` directory.

   ```sh
   lsof -nP -iTCP:3000 -sTCP:LISTEN
   ```

   Build the RC once per checkout, then start Relay in one terminal:

   ```sh
   pnpm build
   pnpm start
   ```

4. Start the cleanup worker in a second terminal:

   ```sh
   source .env.local
   pnpm worker
   ```

   Keep the worker log. A recent `maintenance_cycle` record establishes process liveness. Any `maintenance_failed` record requires investigation.

5. From a third terminal, check the service:

   ```sh
   curl --fail --silent http://localhost:3000/api/health
   curl --fail --silent http://localhost:3000/api/health/ready
   curl --fail --silent http://localhost:3000/api/health/providers
   curl --fail --silent http://localhost:3000/mcp
   pnpm soak:check
   ```

6. Connect Claude Code using the existing user-scoped Relay MCP configuration:

   ```sh
   claude mcp list
   claude
   ```

   In Claude Code, run `/mcp`, confirm Relay is connected, list the projected tools, and perform one granted memory read or write. Keep the Relay credential in the user-level MCP configuration or an environment variable, never in this repository.

7. Connect Codex using its existing Relay MCP configuration:

   ```sh
   codex mcp list
   codex
   ```

   Confirm Relay is connected, list the projected tools, and perform one granted memory read or write. If a local Codex MCP entry must be recreated, configure the URL as `http://localhost:3000/mcp` and reference the credential through an environment variable; do not put the raw credential in a command transcript or tracked file.

8. During normal use, confirm memory continuity across restarts and that private memory remains visible only to its owning Agent. Exercise GitHub and Google reads with only the Agent grants already created for V1 qualification.

## Daily shutdown checklist

1. Finish in-flight Claude Code and Codex calls.
2. Run `pnpm soak:check` while Relay and the worker are still running and save the sanitized output with the day’s notes.
3. Confirm the worker emitted a recent successful `maintenance_cycle` and no unresolved `maintenance_failed` event.
4. Stop the worker with `Ctrl-C`, then stop Relay with `Ctrl-C`. Do not force-kill either process during normal use.
5. Confirm no expired active resources remain. The soak check must report zero expired active sandboxes and browser sessions.
6. Stop PostgreSQL only if it is dedicated to Relay and no other local process depends on it.

## Soak health check

Run:

```sh
pnpm soak:check
```

The command is non-destructive. It loads `.env.local`, checks database reachability and exact migration hashes, calls Relay health/readiness/MCP/provider endpoints, verifies the current account’s encrypted GitHub and Google credentials through Relay's normal provider health flow, and checks persisted cleanup/session state. An expired OAuth access token may be refreshed and re-encrypted through the existing product path; the command does not create or delete user data, Agents, grants, sessions, or resources. It never prints credentials or external account identities.

When the database contains more than one account and `RELAY_ADMIN_EMAIL` does not select the soak account, set `RELAY_SOAK_ACCOUNT_ID` in the shell. `RELAY_SOAK_SESSION_STALE_HOURS` may override the default 24-hour stale-session threshold.

A warning is an evidence prompt, not automatically an RC blocker. Expected authorization denials and intentional credential revocations can produce warnings. Every failure must be investigated. Because V1 does not persist a worker heartbeat, also confirm a recent `maintenance_cycle` log; zero leaked resources alone does not prove the worker process is running.

## Operational signals to watch

| Signal | Primary evidence | Escalate when |
| --- | --- | --- |
| Authentication denials | Activity: `agent.authenticate`, `DENIED`; MCP client output | unexpected, repeated, or a valid credential is rejected |
| Provider failures | Activity with provider and `FAILED`; connection status; provider health | repeatable, cross-provider, or not recovered by the documented reconnect flow |
| Capability denials | Activity `DENIED`; projected `tools/list` | a granted capability is denied or an ungranted capability appears |
| Unexpected revocations | credential `revoked_at`; Activity credential reference | any credential changes state without an operator action |
| Failed events | `agent_inbox.status = FAILED`; worker logs | delivery is lost, repeated, or blocks normal work |
| Stale Agent sessions | active session past expiry or inactive beyond 24 hours | cleanup does not converge or identity becomes inconsistent |
| Cleanup failures | worker `maintenance_failed`; expired active resource counts | any repeatable failure or resource survives a successful cleanup cycle |
| Sandbox/browser leaks | expired resources still `CREATING`, `RUNNING`, or `STOPPED` | any persisted leak after one worker cycle |
| OAuth refresh failures | connection `ERROR`; provider health; `CONNECTION_REQUIRED` logs/errors | refresh or reconnect cannot restore access, or token material is exposed |
| MCP initialization failures | Activity `initialize` with `DENIED`/`FAILED`; client logs | repeated failures with a valid, unrevoked credential |

Also watch readiness failures, PostgreSQL pool waiting connections, and repeated latency changes. Preserve timestamps, request IDs, Agent/session IDs, capability, provider, status, and latency; never copy raw credentials or OAuth tokens into defect evidence.

## RC-blocking defects

Stop the soak and block promotion for any P0/P1 defect, including:

- Cross-account isolation failure.
- Credential revocation failure or reuse after revocation.
- Private memory leakage.
- Incorrect capability grant enforcement.
- Provider reconnect failure.
- Durable state loss.
- Corrupted Agent or session identity.
- Repeatable crash under normal use.
- Sandbox or browser cleanup leakage.
- OAuth token storage, encryption, refresh, logging, or disclosure defect.

Treat any security, authorization, isolation, identity, durable-state, secret-handling, or repeatable availability regression as blocking even if it is not listed above.

## Issues that can wait for V1.1 or V2

These are non-blocking unless they obscure, trigger, or compound a blocking defect:

- Cosmetic UI issues.
- Generic runtime attribution (`mcp` instead of `codex`).
- Minor performance variance within qualified thresholds.
- Missing convenience UX.
- Capabilities intentionally deferred from V1.

Do not implement deferred items during this soak.

## Defect evidence template

```md
### RELAY-RC1-YYYY-MM-DD-NN — short title

- Severity: P0 / P1 / P2 / P3
- RC blocking: YES / NO / UNKNOWN
- First observed (timezone):
- Relay commit/tag:
- Runtime/client and version: Claude Code / Codex
- Agent ID (non-secret):
- Session ID (non-secret):
- Capability/provider:
- Request/activity ID (non-secret):
- Preconditions:
- Reproduction steps:
- Expected result:
- Actual result:
- Frequency:
- Sanitized logs/activity evidence:
- Cleanup or containment performed:
- Regression test needed:
```

Never include a raw Relay credential, OAuth token, cookie, authorization header, or decrypted provider secret.

## Promotion criteria

Promote RC1 to final V1 only after several representative daily-use days and a final clean regression run:

- [ ] No P0/P1 defects during soak
- [ ] No security/isolation regression
- [ ] Claude daily usage healthy
- [ ] Codex daily usage healthy
- [ ] GitHub reconnect/refresh healthy
- [ ] Google refresh healthy
- [ ] memory continuity healthy
- [ ] private-memory isolation preserved
- [ ] credential revocation still works
- [ ] resource cleanup healthy
- [ ] final regression green

Promotion is a separate reviewed action. This runbook does not authorize moving `relay-v1.0.0-rc.1`, creating the final tag, merging to `main`, or beginning V2.

## Soak evidence

### 2026-09-13 — patched-branch daily cycle

- Window: 2026-09-13 14:12–15:28 PDT.
- Starting state: branch `codex/relay-v1-rc-soak`; HEAD `90e6897e8385dce52e42f08ae0ae4fd9a319d69f`; working tree clean; `relay-v1.0.0-rc.1` still resolved to `43e0160eb2b9552f71154d18369e4626e0e79339`.
- Baseline: PostgreSQL, Relay health/readiness, MCP reachability, Docker, Playwright, GitHub, Google, worker cleanup state, and migrations were healthy. The initial `pnpm soak:check` passed with no failures.
- Clients and sessions: Claude Code and Codex both initialized against the live `/mcp` endpoint and completed granted calls. New daily credentials created exactly one durable `mcp` session each; the one disposable credential created one additional attributable Codex Agent session. Repeated client runs reused the expected credential/runtime sessions. Generic `mcp` runtime attribution remains the documented non-blocking V1 limitation.
- Memory: each Agent wrote one SHARED and one AGENT_PRIVATE marker. Both SHARED markers were visible to the other Agent, neither private marker was visible cross-Agent, and the same results held after a clean Relay/worker restart.
- GitHub: both Agents listed repositories successfully. Setting the Codex Agent grant to `DENY` removed `relay_github_repo_list` from `tools/list` and a direct call returned `CAPABILITY_DENIED`; restoring `ALLOW` immediately restored projection and provider success. The account-owned connection remained `CONNECTED`.
- Google: a controlled access-token expiry caused the already-running stale-environment process to fail the first refresh and set the connection to `ERROR`. Relay and the worker were then restarted after explicitly loading `.env.local`; the existing refresh grant recovered the connection automatically to `CONNECTED`, Gmail search succeeded, Calendar list/read succeeded, the encrypted access-token fingerprint changed, the encrypted refresh-token fingerprint did not change, and no browser OAuth reconnect occurred. Classification: `NON_BLOCKING` operator/process-environment condition; the `90e6897` recovery behavior worked as designed.
- Credential revocation: one credential named `RC soak disposable revocation 2026-09-13` (prefix `rly_zSqmQmI9`) was used successfully, revoked once, then rejected twice with `REVOKED_CREDENTIAL`. Activity contains two `agent.authenticate` `DENIED` records. The two daily-use credentials remained active for continued soak use.
- Events/inbox: duplicate ingestion with provider delivery ID `rc1-soak-20260913-90e6897` produced one event, one inbox item, and one wake request. The second ingestion reported duplicate/no routing, and the inbox item was durably acknowledged as `PROCESSED`.
- Sandbox: live Docker create, bounded exec, file write/read/list, and destroy succeeded. A separate expired sandbox was reconciled to `EXPIRED`; no labeled Relay sandbox container remained.
- Browser: two live Playwright contexts completed navigation, type, screenshot, and close. A cookie set in one context was absent in the other. Normal close left both rows `DESTROYED`.
- Restart/recovery: Relay and the worker stopped with `SIGINT`, restarted with the configured environment, retained memories/events/sessions/connections, accepted both real clients, resumed maintenance cycles, and created no duplicate logical event or unexpected resource.

#### RELAY-RC1-2026-09-13-01 — Playwright TTL owner-process leak

- Severity: P1.
- RC blocking: `YES` when observed; resolved on this soak branch.
- Evidence: before the fix, the separate worker marked an expired browser row `EXPIRED` and cleared its provider reference, but four Playwright Chromium processes remained children of `next-server`. Docker cleanup in the same cycle completed normally.
- Root cause: Playwright browser contexts are process-local. The separate worker could reconcile the durable row but could not close a context held in the Relay web process.
- Focused fix: `PlaywrightBrowserProvider` now schedules an unref'd TTL close for every context in its owning process and clears that timer during explicit close. The worker continues to reconcile durable state.
- Regression: the focused live provider test proves an expired owner-process context becomes unavailable and close remains idempotent. In the rebuilt production server, a 60-second browser lease reached `EXPIRED`, cleared its provider reference, and returned the Relay-owned Playwright process count from four to zero.
- Validation: typecheck, lint, production build, focused browser tests (5/5 including the deterministic timer regression), focused live Playwright tests (3/3), full regression (42 passed, 4 skipped live tests), and performance tests (2/2) passed.

#### Operational signal classification

| Observation in this cycle | Classification | Disposition |
| --- | --- | --- |
| One GitHub capability denial after removing the Codex grant | `EXPECTED_POLICY_DENIAL` | Projection and denial were correct; grant restored and call succeeded. |
| Two authentication denials after disposable credential revocation | `EXPECTED_POLICY_DENIAL` | Both retries returned `REVOKED_CREDENTIAL`; no post-revocation capability ran. |
| Four Google capability failures from the intentionally expired token in the stale process | `NON_BLOCKING` | Clean environment restart recovered through the existing refresh grant; all subsequent Google checks passed. |
| Codex non-interactive MCP calls initially blocked by the client's `never` approval policy | `EXTERNAL_TRANSIENT` | Relay was not called; the auto-reviewed one-shot client policy completed the authorized retry. |
| Playwright context surviving worker reconciliation | `RC_BLOCKER` | Reproduced, fixed narrowly, regression-covered, and passed live post-fix qualification. |
| Generic runtime value `mcp` | `NON_BLOCKING` | Already documented as acceptable for V1; Agent, credential, session, capability, status, and latency remained attributable. |

No failed inbox items, active expired resources, unexpected connection `ERROR` states, database constraint errors, worker crashes, unhandled exceptions, token exposure, or unresolved isolation/authorization failures remained at the end of the cycle. The final `pnpm soak:check` result was `PASS` with zero failures and five evidence warnings; all warnings were explained by intentional denials/revocation or the recovered Google test condition.

#### Promotion snapshot

- [x] No unresolved RC blockers
- [x] No security/isolation regressions
- [x] Claude usage healthy
- [x] Codex usage healthy
- [x] Shared/private memory healthy
- [x] GitHub healthy
- [x] Google automatic refresh healthy
- [x] Credential revocation healthy
- [x] Sessions/MCP healthy
- [x] Events/inbox healthy
- [x] Sandbox cleanup healthy
- [x] Browser cleanup healthy
- [x] Restart/recovery healthy
- [x] Worker healthy
- [x] `soak:check` green
- [x] Final regression green

Recommendation after this cycle: **CONTINUE SOAK**. The blocker found during this cycle is fixed and locally qualified, but the patched commit still needs representative use on additional calendar days before an RC2 recommendation.

### 2026-09-13 — Cycle 2 repetition and aging qualification

- Window: 2026-09-13 15:36–15:51 PDT. This was a second complete technical cycle on the same calendar day as Cycle 1, not another calendar day of elapsed aging. Its results establish repetition and restart stability, but they do not satisfy the requested multi-day observation period.
- Starting state: branch `codex/relay-v1-rc-soak`; HEAD `69e089203db134e4cbe4f43ba9375b9d34ab3ac3`; working tree clean; frozen `relay-v1.0.0-rc.1` still peeled to `43e0160eb2b9552f71154d18369e4626e0e79339`.
- Baseline counts: 13 active/recent Agent sessions and zero stale sessions; 2 events; 2 inbox items; 2 wake requests; 4 sandbox rows with zero active or stale; 5 browser-session rows with zero active or stale; 7 provider failures, 7 authentication denials, and 5 capability denials in the existing 24-hour evidence window. GitHub and Google were `CONNECTED`.
- Final counts: 13 active/recent Agent sessions and zero stale sessions; 3 events; 3 inbox items; 3 wake requests; 9 sandbox rows (`7 DESTROYED`, `2 EXPIRED`) with zero active or stale; 9 browser-session rows (`6 DESTROYED`, `3 EXPIRED`) with zero active or stale; 7 provider failures, 7 authentication denials, and 5 capability denials. Growth was exactly attributable to this cycle's one idempotence delivery and five sandbox/four browser exercises; no error counter grew during the cycle.
- Clients and sessions: three independent Claude Code runs and three independent Codex CLI runs reached the live Relay MCP endpoint before and after restart and completed granted operations. Relay correctly reused durable credential/runtime sessions, so active session count did not grow. Activity remained attributable to Agent, credential, session, capability, status, and latency. One Codex natural-language summary incorrectly reported zero matching tools after a successful search call; a direct MCP inspection returned all three granted memory tools. Classification: `EXTERNAL_TRANSIENT`, with no Relay initialization, projection, or authorization defect.
- Memory aging: the shared and private markers created in Cycle 1 remained durable. Claude continued to read the Codex shared marker but not its private marker; Codex continued to read the Claude shared marker but not its private marker. The same aged markers and isolation results held after the clean Relay/worker restart; no newly-created marker was used as a substitute.
- GitHub: both Agents completed repeated repository-list and repository-read operations. The account connection remained `CONNECTED`, grants remained effective, provider health passed, and no reconnect or state drift occurred.
- Google: Gmail search/read and Calendar list/read succeeded repeatedly. A controlled expired access token refreshed through Relay's normal path without browser authorization; the encrypted access-token fingerprint changed, the encrypted refresh-token fingerprint remained unchanged, the expiry advanced, status remained/returned `CONNECTED`, and exactly one Google credential row remained. Subsequent provider checks did not change the token fingerprints or credential timestamp, providing no evidence of a refresh storm. Gmail and Calendar continued to work after restart.
- Revocation: the Cycle 1 disposable credential remained revoked, produced no capability activity after its revocation timestamp, and was not reused. The two daily-use credentials remained active.
- Events/inbox: duplicate delivery ID `rc1-soak-cycle2-20260913-69e0892` produced exactly one event, one inbox item, and one wake request. The second delivery was recognized as a duplicate. The new inbox item was durably `PROCESSED`; there were zero failed or unread inbox items. Three `QUEUED` wake rows are expected V1 durable queue records, not stuck runtime work; V1 intentionally does not launch arbitrary runtimes from wake records.
- Sandbox: two explicit create/use/file/destroy cycles succeeded. One additional sandbox expired through its TTL path. At the end of the cycle every row was historical, no expired active row remained, and no Relay Docker container remained.
- Browser: two explicit isolated create/navigate/type/screenshot/close cycles succeeded. One additional context expired naturally after its 60-second TTL; the row became `EXPIRED`, the provider reference was cleared, and the owner-process Playwright process count returned to zero. This re-qualified `a4c692d` under repetition and natural expiry.
- Worker: the same worker completed multiple successful maintenance cycles, including the natural TTL cleanup, without `maintenance_failed`, crash, or restart loop. After the clean restart it immediately resumed successful maintenance cycles and reported zero pending sandbox/browser cleanup.
- Restart/recovery: Relay and the worker were stopped cleanly after meaningful state accumulated, rebuilt, and restarted with `.env.local` loaded. Health/readiness/MCP and both provider checks recovered; aged memory and isolation persisted; sessions/history and events/inbox remained consistent; both real clients completed calls; no duplicate resource, session, credential, or logical event appeared.
- Leak and trend result: zero active expired resources, zero stale Agent sessions, zero failed inbox items, zero failed wakes, zero Relay Docker containers, and zero Relay-owned Playwright processes. No connection was left in `ERROR`, and there was no unexplained persistent growth.
- Final soak check: `PASS` with 0 failures and 5 historical evidence warnings. Database, 6 migrations, Relay health/readiness, MCP, Docker, Playwright, GitHub, Google, resource cleanup, and Agent-session hygiene all passed. The worker also emitted a fresh successful `maintenance_cycle` after the check.
- Regression: typecheck passed; lint passed; non-live suite passed 42 tests with 4 explicitly skipped live tests across 21 files (19 passed, 2 skipped); live Playwright qualification passed 3/3; performance passed 2/2 with 64 operations, 0% errors, p50 36.927 ms, p95 39.328 ms, and p99 39.816 ms; production build passed.
- Defects: no new Relay defect was found. No application code changed during Cycle 2.

#### Cycle 2 promotion snapshot

- [x] No unresolved RC blockers
- [x] No security/isolation regressions
- [x] Google survived another real refresh cycle
- [x] GitHub remained healthy
- [x] Claude remained healthy
- [x] Codex remained healthy
- [x] Memory continuity and isolation preserved
- [x] Credential revocation preserved
- [x] Events/inbox remained idempotent
- [x] Sandbox cleanup remained healthy
- [x] Browser TTL cleanup remained healthy
- [x] Worker remained healthy
- [x] Restart/recovery passed
- [x] No unexplained resource growth
- [x] `soak:check` green
- [x] Regression green
- [ ] Another real calendar day of representative usage observed

Recommendation after Cycle 2: **CONTINUE SOAK**. All technical criteria passed, but this repetition cycle occurred on the same calendar day as Cycle 1. Do not recommend or create RC2 until the additional real calendar-day observation requirement is met.
