# RELAY × COMPOSIO — CHECKPOINT 3

Current engineering work: SDK integrity remediation, four production dependency patches, and canonical admission preparation. Accepted base is `d7f6be23f5e1261690f5afc806cc30c1a6a5f9a9`; SDK remains `@composio/core@0.22.0`, generated client `2.0.0-rc.8`. **Remote execution remains disabled. Activation readiness: NO.**

The earlier `independent-review.md` and `dependency-remediation.md` in this directory are historical review/proposal artifacts from the accepted base. This document records their subsequent disposition; it does not rewrite their evidence. Exact final SHA and executed qualification are in the external `relay-composio-evidence/checkpoint-3/REPORT.md` and verification manifest.

## Descriptor substitution: repaired

IR-1 was reproduced before edits using the retained installed-SDK wire fixture. Both a second-descriptor slug substitution and same-slug schema substitution reached a simulated execution request. Original evidence in `relay-composio-evidence/independent-review` is unchanged; `checkpoint-3/ir1-before.json` records the new reproduction. No live provider request was made.

Root cause is SDK execution behavior combined with insufficient adapter identity binding: core 0.22.0 `tools.execute()` fetches a second descriptor, passes the requested slug to `beforeExecute`, then derives the endpoint from the fetched descriptor's slug. `getRawComposioToolBySlug()` performs a provider read; this failure was not caused by a descriptor cache. Initial discovery validates its own descriptor correctly. The gateway never dispatches, so it was not a reachable gateway bypass.

Adapter version 1.1 checks connection identity/status, then performs its final dated descriptor lookup and validates exact slug, toolkit, input/output schema digest, version and deprecation state. It dispatches through the pinned SDK's **public `getClient().tools.execute()` generated transport**, which directly constructs the POST endpoint and does not retrieve another descriptor. Endpoint slug/version come from the validated descriptor. No high-level execute middleware, schema refetch, custom auth, latest-version fallback, file upload/download or tracing is used. `maxRetries: 0` is explicit on the request.

The new required execution context consumes existing canonical ActionIntent/CapabilityLeaseClaims and the existing consumer request. The integrity digest covers provider, account/owner/installation/agent, connection and provider IDs, scopes/custody/authority version, toolkit/slug/schema/version, READ effect, exact action/arguments/resource/idempotency identity, runtime/task/workload, lease and policy decision, policy revision, approval identity, parent/delegation, budget reference and expiry. Initial and pre-dispatch checks reject mismatches, argument/context mutation and expiration. Dispatch arguments are copied, and results carry the binding digest plus action/decision/lease/approval references.

**This context is not an authorization token or verifier.** A caller cannot gain gateway authority by fabricating well-formed claims. The gateway remains unchanged and unconditionally denies execution. Authenticating the runtime, verifying the lease signature and approval, reading current policy/revocation and consuming the lease require the existing canonical receiving authority. This patch adds no allow callback, public execution route, authorization registry or independent receipt ledger.

## Dependency security: four targeted findings closed

Applied the previously reviewed minimal patch set:

| Package | Before | After |
|---|---|---|
| Next.js / eslint-config-next | 15.5.24 | 15.5.27 |
| next > sharp | 0.35.4 | 0.35.5 |
| postcss > source-map-js | 1.2.1 | 1.2.2 |

Lockfile changes are confined to those packages and their matching Next/native sharp/libvips families. Core/client and unrelated dependency versions are unchanged. Local sharp reports librsvg 2.63.2. Registry integrity metadata and installed SDK types/source were inspected; no broad or forced update was used. Installation used `--ignore-scripts`; tests/build verify the required installed packages work.

The [Next 15.5.27 release](https://github.com/vercel/next.js/releases/tag/v15.5.27), [sharp advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w), and [source-map-js 1.2.2 release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2) identify the fixes. Detailed exploit prerequisites remain in the historical dependency investigation.

Unsuppressed production audit is now **0 findings**. Full audit is **not clean**: 16 development-tool findings remain (3 critical, 7 high, 6 moderate), compared with 20 at the accepted lockfile. The four removed findings are exactly the targeted advisories; no advisory/module pair was introduced. Remaining paths involve Vitest/mocker/tinypool, development esbuild and lint glob libraries. They require separate scoped remediation, including major-version compatibility work or unavailable patches; this checkpoint does not claim they are safe. Full audit exits nonzero and its original report is retained. CI now additionally enforces the production audit without ignoring advisories; no existing check was suppressed.

## Canonical admission and Sofie

The [canonical boundary request](canonical-admission-boundary.md) and [Sofie runtime/lease contract](sofie-runtime-lease.md) remain the integration requirements. Read-only source inspection now pins MyEve `063adcf2f66a199828184ee70f53690d0dca5d13` and Relay capability branch `aec9d9adb4c057f4bbd85a3ec27155d14fe6f24b`. Their policy wire and relevant runtime/admission contracts are unchanged from the E commits already documented; wire SHA-256 remains `4b198d32e1dcdc930c2658291906ebf72601e144596f3090202a3e7ee708d606`. No dependency branch was merged or modified.

Consume existing signed CHALLENGE, MyEve/Relay PERMIT, FENCE and FENCE_ACK through their owner-qualified verifiers and receiving transaction. FENCE_ACK proves policy delivery, not execution admission or success. Canonical registry mapping, exact owner/installation/backend enrollment, native Work/Mission mapping, online runtime/lease/budget checks, approval validation, targeted connection/Work revocation and restore-safe authority remain owner requirements. The new execution binding prepares the exact request/result boundary without independently implementing those decisions.

Sofie's owner/agent/connection and action resource must match the authenticated canonical lease. RuntimeClientId, task, workload, capability and action hash must match; approval and policy decision identities enter evidence. Parsing these records never authenticates them. Results remain bounded untrusted external data, with a canonical digest and decision/lease correlation. No generated summary or successful provider Golden Journey is claimed.

## Qualification scope and residual limits

Installed-SDK wire tests reject descriptor slug/toolkit/version/input/output/deprecation substitution after discovery with zero execution requests, prove only one final lookup is used for a direct adapter fixture, and retain UNKNOWN with one request on ambiguous dispatch. Binding tests cover stale/mismatched leases, changed valid arguments, decision/approval mutation, revoked connection and expiry during lookup. Prompt-injection content remains inert result data and cannot trigger another tool. Existing provider error, owner/agent isolation and webhook HMAC/replay tests remain.

Real PostgreSQL tests additionally exercise concurrent authenticated requests, durable same-request replay, changed-argument conflict, signed audit and revocation with zero gateway dispatches. These prove **concurrent denial**, not at-most-once successful provider execution. Canonical admitted-command deduplication, lease consumption, crash recovery and UNKNOWN reconciliation must be qualified before any positive execution route is wired. SDK integrity cannot prove that a provider's server implements a dated tool honestly; live tool/scope/effect qualification remains separate.

One independent read-only security/architecture reviewer examined the focused diff and pinned generated-client implementation, found no new actionable defect, and accepted the IR-1 source remediation subject to final qualification. The reviewer did not run tests or mutate source, credentials, databases or production. All 27 frozen groups remain unchanged. Final executed test counts, fresh-clone and exact-SHA hosted results are recorded in the evidence report.

No live OAuth, production credential custody, paid provider operation, external provider write, production deployment, external-alpha change, dependency merge or remote execution activation is included.
