# RELAY × COMPOSIO — INDEPENDENT REVIEW

Date: 2026-10-10. Review target: `35300e8da774e2e521dc8892d7fbc776a0bc0fa6` on `codex/relay-composio-integration`. SDK: `@composio/core@0.22.0`, client `2.0.0-rc.8`. The accepted commit and historical evidence remain preserved.

One independently delegated reviewer performed the authorized read-only security and architecture review. The reviewer changed no source, files, credentials, databases or production systems, ran no mutation tests, and used no additional reviewers. The implementation author separately investigated dependencies and implemented the bounded IR-2 correction below. This is an agent review, not a third-party certification.

## Verdict

Security: no reachable positive-admission bypass or credential disclosure found within the reviewed Checkpoint 2 scope. Architecture: suitable for bounded preparation, with findings. **PARTIAL; not qualified for execution activation or production.**

### IR-1 — P1 before activation: unchecked SDK dispatch descriptor — OPEN

At the reviewed commit, `lib/integrations/composio.ts:154–160` validates the requested slug through `beforeExecute`. Installed SDK `dist/index.mjs` retrieves a descriptor again, passes the original caller slug to that callback, but selects the HTTP execution endpoint using the second descriptor's `tool.slug` (`executeWithTool`, around 2570–2580; `executeComposioTool`, around 2558; lookup around 2676–2680).

A second descriptor with a different slug in the same toolkit can satisfy the modifier while changing the endpoint. Same-slug schema drift also lacks a full second-descriptor check. The initial `getAction()` validation and dated version do not prove the final descriptor is identical.

Current gateway has no dispatch branch, so this is an inherited adapter hazard, not a currently reachable remote-write bypass. It remains an explicit activation blocker. No adapter execution changes or dependency upgrades were made as part of this review.

Required correction before activation: validate the exact dispatch descriptor's slug, toolkit, dated version, input/output schema digest and deprecation state, and derive the endpoint from that validated object. A third lookup is insufficient. Prepare a separately reviewed adapter change using supported transport boundaries; do not add another policy authority. Installed-SDK wire tests must substitute the second descriptor's slug/schema/toolkit/version and observe zero execution requests. Current tests cover first-lookup drift only.

### IR-2 — P2: older owner connections cannot be revoked — corrected

At the reviewed commit, `actions.ts:18–20` searched `ownerIntegrationConnections()`, which returned only the newest 100 records (`persistence.ts:158–160`). An owned older connection therefore became unreachable to the server action even with its exact ID; UI pagination was missing.

The correction resolves `accountId + ownerPrincipalId + connectionId` directly and derives agent/installation on the server. Existing transactional membership/account/agent checks remain. Stable ID keyset pagination exposes all connection records; toolkit and connected-state filters apply before pagination. Revocation updates do not move records across pages. PostgreSQL and browser regressions cover the 101st, oldest record, durable denial and navigation.

The same independent reviewer inspected the six-file correction diff read-only and found no new actionable issue. That follow-up approves the source shape, not test results. Exact corrected SHA and newly executed qualification are recorded in the adjacent evidence report to avoid implying the original review covered a later commit.

## Scope assessment

| Area | Result and limitation |
|---|---|
| Credential custody | Strict metadata bindings contain no OAuth token fields. Responses and errors omit credential material. SDK telemetry, tracing, automatic file handling and retries are disabled. Live custody remains unqualified. |
| Owner, tenant, installation, agent isolation | Exact account/owner/installation/agent predicates, active HUMAN OWNER membership and agent-account checks; opaque provider user derives from the whole scope. Installation provenance still requires canonical enrollment. |
| PostgreSQL persistence | Account fencing serializes lifecycle/receipt writes; row locks, unique provider identity, membership constraints and transactional signed audit preserve isolation. Production migration ownership is unresolved; qualification SQL is isolated. |
| Idempotency and concurrency | Namespaced account receipts reject changed requests; concurrent completion persists once; replay returns current state and cannot restore revoked authority. |
| Signed evidence | Canonical signed hash chain participates in the lifecycle transaction. Signer failure rolls back persistence. No independent audit authority is introduced. |
| Revocation | Local denial and authority increment precede upstream reconciliation. Confirmation is monotone; uncertain provider outcomes remain pending. IR-2 correction restores older-record management. |
| Gateway authorization | Existing agent authentication, exact scope, absent-policy denial, bounded discovery intersection and post-fetch revalidation. `requestRead()` always denies; no positive callback or dispatch route exists. |
| Discovery and schema | Reviewed descriptions replace provider prose; bounded pinned descriptors are checked. Results/schemas remain untrusted data. IR-1 blocks future execution. |
| Webhooks | SDK HMAC verification over ID/timestamp/raw body, bounded clock skew/body/IDs; durable replay conflict detection and event rate limit. No public ingress. Verification-to-canonical-owner/connection resolution is not integrated or qualified. |
| External write denial | No gateway execution path. Only READ qualification manifests are accepted. IR-1 must be resolved before relying on the inactive adapter for effect enforcement. |
| Supply chain | Exact core/client/lockfile pins limit resolution drift, but do not establish package safety. Four baseline advisories remain; see dependency proposal. |
| Canonical architecture | Metadata extension does not create a competing policy registry or grant system. Control Plane owns ordering, source freshness and positive admission. |
| Sofie | Consumer parser binds material but does not authenticate runtime/task or consume online lease. Public runtime execution remains unavailable. |

## Evidence and limits

The reviewer independently compared all 27 frozen compatibility groups and verified all 20 retained Checkpoint 2 evidence digests. Historical hosted logs at the accepted SHA showed 543 tests passed/6 skipped, 2 performance tests, 13 owner and 3 integration browser journeys, fresh checkout/frozen install, typecheck, lint, build and compatibility checks. The reviewer did not rerun them.

Source changes in this preparation are limited to the IR-2 persistence/UI/fixture correction, documentation, and a branch-specific Vercel deployment exclusion for qualification-only pushes. Dependency manifests and lockfile, frozen APIs/database migrations/runtime/leases, gateway and Composio adapter remain unchanged. The preparation contract in this directory incorporates newer canonical Checkpoint E sources without merging them.

Remaining blockers: IR-1; canonical Composio admission enrollment and receiving fence; restore-safe authority lineage; live authenticated policy projection; exact runtime/lease/Work revocation composition; canonical capability/effect mapping; live tool/scope/schema qualification; production migration and custody authorization; webhook ingress binding; and separately reviewed dependency remediation.

Checkpoint 3 readiness: **ready for bounded contract preparation; execution activation NOT_READY**. Production integration: **NOT_RUN**. Live OAuth, paid provider operations, provider writes, credential mutations, dependency merges and external-alpha changes: **NONE**.
