# Checkpoint 3 canonical admission boundary — preparation only

Status: **REQUEST FOR OWNER QUALIFICATION / NOT ACTIVATED**. This document supersedes the older source-status assumptions in the Checkpoint 2 request; it does not replace canonical policy or introduce a new wire protocol. It has not been sent to another workstream. No dependency branch is merged.

## Pinned canonical sources

| Source | Exact inspected commit / contract |
|---|---|
| Accepted Composio Relay | `35300e8da774e2e521dc8892d7fbc776a0bc0fa6` |
| MyEve Control Plane E | `2f1e9c2517dda4b190f20a0e93bc57ef45267939`; `packages/capability-enforcement/src/{ordering-wire,ordering-source,ordering-transport,decisions}.ts`; canonical capability-control registry/types |
| Relay Control Plane E | `0af281b72cf8e894a6dc2aa7a3ba8c181471ebb6`; `lib/v2/policy/{ordering,ordering-wire}.ts`, `lib/v2/leases.ts` |
| MissionControl E reference | `71d39a68810f6cf657e12b4c98dbc2e5b3cb783d`; composed native admission is the E qualification example, not a Composio backend qualification |
| Canonical wire bytes | SHA-256 `4b198d32e1dcdc930c2658291906ebf72601e144596f3090202a3e7ee708d606` |

The earlier `e93a4ce6e81494a43fdfe98447de1c42337d191b` source only supplied denial references. E now contains receiver-signed challenges and ordered positive permits for its qualified synthetic native Mission journey. E remains release PARTIAL: restore-safe trusted controller head, live authenticated Relay-agent projection, targeted active-Work revocation, actual installation/owner enrollment and other backend lifecycle gates remain open. Reading this newer source does not qualify Relay × Composio.

## Reuse exact owner contracts

Use canonical `SignedPolicyMessage { message, keyId, signature }`, P-256 signing/verification, strict parser and `assertPolicyIdentity`. The existing wire has no arbitrary extension fields or independent `allow` boolean. Unknown fields/versions must fail closed; do not create a permissive parser or a second signing mechanism.

| Canonical structure | Fields to preserve exactly |
|---|---|
| `PolicyIdentity` | authority (`myeve` or `relay`), ownerId, organizationId, installationId, backendId, incarnation, enrollmentVersion, version, policyId |
| `CHALLENGE` | identity plus referenceId (UUID), capabilityId, registryVersion, agentId, workId, missionId, workGeneration, actionDigest, budgetMicros, issuedAt, expiresAt; receiver-signed, authority `myeve` |
| `PERMIT` | identity plus referenceId, capabilityId, requiredCapabilities, registryVersion, agentId, agentRevision, workId, missionId, workGeneration, actionDigest, budgetMicros, issuedAt, expiresAt, sourcePermitHash |
| `FENCE` | identity, capabilityId, operation (`enable`, `disable`, `pause`, `revoke`, `set_budget`), accumulated restrictive controls when present |
| `FENCE_ACK` | exact identity plus fenceHash of the complete canonical fence, including controls |

Canonical parser bounds permit/challenge lifetime to 30 seconds, requires integer timestamps and a bare 64-hex action digest; `requiredCapabilities` includes both the requested capability and `work`. MyEve permit uses sourcePermitHash `SELF`; Relay permit binds the actual source permit hash. Relay's `canonicalHash()` uses a `sha256:` prefix: do not pass that directly where canonical `admissionActionDigest()` requires bare hex. Use owner-provided canonical serialization and positive/negative vectors.

`FENCE_ACK` proves durable policy delivery; it is **not** an admission receipt, lease, execution result or cleanup acknowledgment. E's `issueBackendOrderedPermit()` validates the enrolled receiver signature, exact challenge identity/registry/current acknowledged policy and durable request fingerprint under the source policy lock. Relay's `relayAdmissionPermit()` checks the source permit and action-bound digest, exact enrolled destination, current Relay epoch and empty pending delivery set while issuing its canonical lease. These functions remain owned by the Control Plane/Relay authority workstream.

## Integration-specific binding request

Please qualify the mapping below through canonical enrollment and action material. No Composio-specific fields should be added to strict policy messages by this adapter independently.

| Binding | Required source and equality check |
|---|---|
| Owner and tenant | Provisioned MyEve ownerId + organizationId + installationId + environment ↔ active Relay accountId + HUMAN ownerPrincipalId membership. Never email matching, body claims, or hard-coded platform-owner identity. |
| Receiver | Qualified backendId, incarnation, enrollmentVersion and trusted verifier keys. Owner must identify whether the receiving Composio dispatch boundary is a Relay-owned enrolled backend and define its receiving transaction. Do not invent a backend name or reuse a MissionControl enrollment. |
| Agent / Sofie | Authenticated agentId, runtimeClientId, taskId, harnessId, workloadId, parent/delegation chain, canonical Work/Mission mapping and workGeneration. Current wire requires missionId: specify canonical mapping for Sofie work without fabricating a synthetic production Mission. |
| Connection | Server-resolved connectionId + installationId + agentId + account/owner; opaque providerUserId, connectedAccountId/authConfigId digests, provider `composio`, toolkit, custody, exact scopes and authorityVersion. Revalidate current active lifecycle in the receiving transaction; never accept browser/provider status as authority. |
| Operation | Canonical capability name/version and registryVersion; qualified tool slug + dated version + schema digest; canonical effect `read`; target resource; exact validated arguments digest; action canonical hash; approval identity if any future effect needs one. Bind all through the owner-approved canonical dispatch digest/action resource. |
| Attempt and accounting | Stable authenticated runtime idempotency key, durable command ID, canonical challenge referenceId, lease ID/call ID, Work generation, reservation/budget, source/Relay permit hashes, admitted authority lineage and signed audit correlation. |

The current registry has `connected-apps` (Relay, permission `integrations.use`), `email` depending on it, plus `work` and `sofie.native`. Product labels COMPOSIO_PROVIDER, EXTERNAL_INTEGRATIONS, TOOL_DISCOVERY, EXTERNAL_READ and EXTERNAL_WRITE remain **mapping requests**, not registered IDs. Existing `github.repo.read@1.0` is only the fixture's local Relay grant. Request explicit owner-approved tool-to-capability/dependency/harness mappings before activation.

Effect mapping remains READ → canonical `read`; EXTERNAL_WRITE → `external_write`, retaining `communication` classification where applicable; FINANCIAL → `financial`; DESTRUCTIVE → `destructive`. PRIVATE_WRITE has no assumed equivalent. All non-READ execution remains denied even if preferences are enabled. Ordinary/platform defaults grant no execution authority.

## Required composed sequence

1. Authenticate Sofie through existing runtime credentials or qualified canonical OAuth verification. Resolve account, owner, agent, task, workload and connection from authoritative records. Validate exact ActionIntent hash/resource and qualified READ tool.
2. Receiver constructs and signs the canonical CHALLENGE over owner-approved dispatch material and current receiving snapshot; MyEve issues the source PERMIT only after current policy delivery is acknowledged. Discovery projections never stand in for this step.
3. Reuse canonical Relay policy evaluation, passport/runtime/workload/approval/budget checks and lease issuance with remoteAdmission. Obtain the canonical Relay permit bound to the source permit and exact action. Missing enrollment or pending fences denies.
4. At the owner-defined receiving admission transaction, revalidate BOTH policy heads/permits, registry, incarnation/enrollment, native runtime/lease/budget/Work authority, connection authority and qualified descriptor. Persist the canonical native admission/command and exact idempotency receipt under the qualified fence. Source signature alone is insufficient.
5. At dispatch, enforce the canonical rules for admitted Work, targeted revoke, lease expiry/call consumption, current connection denial and writer fence. Resolve IR-1 by validating the exact SDK descriptor used for execution. No HTTP execution request may precede these checks.
6. Reuse canonical result/proof and signed audit. Return bounded untrusted provider data only through reviewed projection. Ambiguous provider dispatch remains UNKNOWN; an ACK or successful queue submission is not a tool result. Do not blind retry.

Steps 2–6 are **requirements**, not implemented Composio authority. The owner must provide the existing canonical receiver API/receipt and linearization point. There is no new ADMISSION_ACK schema in this branch. No distributed transaction or global execution ledger is proposed.

## Revocation, freshness and failure requirements

Ordinary disable denies NEW admissions and preserves previously admitted bounded Work. Pause remains PENDING_BACKEND until qualified safe-checkpoint suspension. Explicit revoke must fence applicable writers/leases/Work and retain UNKNOWN exposure until authoritative reconciliation. Accumulated restrictive controls cannot disappear after enable or unrelated policy edits. Generic Relay account freshness epochs must not revoke unrelated active Work. The older request's broad revocation language is narrowed to these canonical semantics.

Local connection revoke still commits REVOKED + incremented authorityVersion + canonical signed evidence before provider reconciliation; PENDING provider revocation cannot restore authority. Define exactly how connection revoke targets admitted-but-undispatched and in-flight Work, child leases and retries. Dispatched outcomes remain UNKNOWN when cancellation cannot be proved; do not report external resources stopped on receipt of FENCE_ACK.

Missing/invalid signature, unknown key/issuer/destination, scope substitution, registry mismatch, expired/future decision, stale or pending policy, missing live agent projection, unqualified harness, offline authority, restore uncertainty, local revoke, lease/runtime mismatch or absent native admission → **NOT_DISPATCHED**, zero provider execute requests. Changed material under an existing request key → conflict. Replayed receipts cannot create new authority or redispatch. Bound expiry to the earliest policy/lease/workload/connection limit; specify canonical clock skew rather than adding local grace.

Request independently retained controller-head/startup-quarantine recovery proof; same-database epoch counters cannot detect a rollback of all databases. No production or restored installation is qualified by pool-restart tests.

## Acceptance package requested from Control Plane owner

Provide exact qualified commits/wire digest; authenticated enrollment, trust/key-rotation and environment profile; canonical capability/effect mappings; action serialization vectors with all bindings above; live authenticated agent projection; receiving transaction/admission receipt; runtime lease/call/reservation composition; targeted revoke and previously admitted Work semantics; restore/restart protocol; durable denial/admission/result correlation; and independent adversarial qualification evidence.

Required tests: real PostgreSQL policy/lifecycle/lease transactions; wrong owner/account/installation/agent/runtime/task/connection; changed tool/schema/arguments/effect/target; stale registry/policy; disable/revoke racing admission and dispatch; later enable retaining restrictive marks; duplicate/lost ACK; nonce conflict; expired/rotated keys; parent/workload revoke; process crash at lease debit/command commit/HTTP boundary; replay after revoke; restore with independent trusted head; provider UNKNOWN; and zero writes. Qualify a synthetic positive read only after the actual canonical receiving adapter passes. Live provider qualification stays separate and requires later authorization.

Current disposition: preserve `executionAvailable:false` and unconditional gateway denial. No new authorization mechanism, runtime route, live credentials, provider execution, dependency merge or deployment is included.
