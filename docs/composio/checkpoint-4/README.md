# RELAY × COMPOSIO — CHECKPOINT 4

**PARTIAL. Activation readiness: NO.** Preserve accepted Relay `fa2f0726062c734a540d887fc2d11fe37d477b83`, SDK `@composio/core@0.22.0`, and all 27 frozen compatibility groups. This checkpoint remediates development dependencies and qualifies canonical wire/runtime compatibility. It does not qualify positive Composio admission, implement the execution lifecycle, or complete the Sofie Golden Journey.

## Canonical receiving dependency

Inspected canonical Relay `aec9d9adb4c057f4bbd85a3ec27155d14fe6f24b` and MyEve `9200bd3826350ad586bb5640ca08557da7d1b984`. MyEve's later pricing-source changes are outside this integration; no MyEve source was modified or adopted. The relevant wire is identical to the retained checkpoint: SHA-256 `4b198d32e1dcdc930c2658291906ebf72601e144596f3090202a3e7ee708d606`.

Canonical Relay's `issueCapabilityLease(...remoteAdmission)` and `relayAdmissionPermit()` issue ordered permits. They are not the final receiving transaction. Their composed fixture consumes permits through MissionControl `missions:start` following a MissionControl-generated challenge. MyEve `issueBackendOrderedPermit()` requires an enrolled backend and a native `missionId`. None of these inspected sources implements a Composio receiver or a tool-to-native-Work mapping.

The preserved Relay lease interface has no `remoteAdmission` input. Copying newer lease authority into frozen `lib/v2`, inventing another receipt/registry, or appending a provider call after the Mission fixture would violate the accepted boundaries. The independent read-only architecture reviewer confirmed this gap. The [existing exact contract request](../checkpoint-3/canonical-admission-boundary.md) remains the required owner handoff, with [Sofie runtime and lease requirements](../checkpoint-3/sofie-runtime-lease.md).

The owner handoff must supply:

1. Qualified receiving API/transaction and source pins; exact enrollment, owner/tenant/installation and legitimate Sofie Work/Mission mapping.
2. Canonical `connected-apps`/tool capability mapping, full descriptor/action/argument/effect material, approval identity and serialization vectors.
3. Current policy-head verification and local connection fencing composed with online runtime/lease/call consumption and budget reservation.
4. Durable command/admission receipt, dispatch fencing, result custody/Proof, settlement and crash reconciliation; duplicate requests cannot produce another dispatch, and UNKNOWN cannot authorize retry.
5. Independent adversarial qualification for this receiving backend. Signed source/Relay PERMIT and FENCE_ACK are insufficient by themselves.

## Safe compatibility qualification

`scripts/qualify-composio-canonical.mjs` loads the exact canonical wire directly from the pinned Git object and verifies its byte digest before execution. It does not vendor a second implementation or import it into production. Its eight check groups cover signature round-trip, every identity field, bound action-material mutation, strict parsing/lifetime bounds, tampering/wrong keys, exact fence acknowledgment, and the fact that signature verification alone does not establish fresh policy. The pinned commit must be present (`git fetch origin aec9d9adb4c057f4bbd85a3ec27155d14fe6f24b`); no merge is needed. CI's full checkout supplies it.

Real PostgreSQL runtime compatibility tests use canonical registration, passports, event-created tasks, proof-of-possession workload bootstrap, policy evaluation and lease issuance. Genuine canonical lease claims bind to the Composio request. Runtime tenant/revocation, lease audience/revocation and changed-argument cases deny. The integration gateway still denies a request with this otherwise valid local authority; duplicate denial does not consume a lease or call the provider. These tests exercise compatibility, not an authenticated MyEve consumer, remote admission, or successful execution idempotency.

The requested Golden Journey stops at canonical receiving admission. No assigned-issues result, grounded Sofie response, successful-result reconnect or durable success readback is fabricated. Existing catalog/denial browser journeys and signed denial/revocation evidence remain separately qualified. No new positive route, transport, allow callback, lease ledger or fixture admission bypass is installed.

## Development dependency security

The full refreshed audit had 16 findings (3 critical, 7 high, 6 moderate). Applied only the security closure:

| Dependency | Before → after | Exposure and reason |
|---|---|---|
| Vitest / mocker | 3.2.4 → 4.1.11 | Fixes UI server arbitrary file read/execute and redirect-mock traversal; test runner only. The earliest complete fixed line is 4.x, requiring regression qualification. |
| tinypool | 1.1.1 → removed | Two critical worker-option prototype-pollution gadgets removed with Vitest's upstream pool replacement. No forced incompatible tinypool override. |
| core-utils > esbuild | 0.18.20 → 0.25.12 | Drizzle's legacy TypeScript loader uses transformation. Vulnerable serve/CORS behavior is not used by application routes; pin the existing compatible patched esbuild line. Migration consistency is checked. |
| brace-expansion | 1.1.18 → 1.1.21; 2.1.4 → 2.1.7; 5.0.9 → 5.0.12 | Nine findings across three major lines, fixed without changing their consumers' major APIs. Lint/TypeScript glob tooling receives source/configuration patterns, not provider tool results. |
| braces | 3.0.3 retained | **One high finding remains; no upstream patched version.** Next ESLint and TypeScript lint paths reach micromatch/fast-glob. Crafted nested glob patterns can exhaust the stack in lint/build/CI. No application/provider input path was found, but this is not a risk waiver. |

Vite remains 7.3.6; application dependencies, Next, SDK, runtime authority and lockfile entries outside the required closure remain unchanged. Installation disables lifecycle scripts. Full audit now reports **0 critical, 1 high, 0 moderate** and still exits nonzero. Production audit remains clear. No ignore list, severity downgrade, audit exception or suppressed gate was added. The remaining braces advisory blocks a clean full-graph security qualification.

Primary sources: [Vitest 4 migration](https://v4.vitest.dev/guide/migration.html), [Vitest mocker advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9), [esbuild advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99), and [braces maintainer issue](https://github.com/micromatch/braces/issues/70). Exact versions were verified against registry metadata; all 16 original records and paths are retained in external evidence.

## Qualification and release boundaries

Exact final SHA, executed test counts, fresh-clone result, hosted CI, independent review and evidence hashes are recorded in `relay-composio-evidence/checkpoint-4/REPORT.md`. Checkpoint 2, independent-review and Checkpoint 3 evidence remain unchanged. A green regression workflow does not waive the remaining full audit failure or qualify the absent receiving authority.

No live OAuth, production credential custody, paid operation, external provider write, deployment, external-alpha change, dependency merge or remote execution activation is authorized or performed. Positive deterministic execution awaits the actual qualified canonical receiver. **Production integration: NOT_RUN.**
