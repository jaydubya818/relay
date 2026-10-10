# Relay → Unified Capability Control Plane: integration contract request

Status: REQUESTED / NOT QUALIFIED. No positive admission implementation or execution activation is included in this branch. This document is a handoff artifact; it has not been sent to another workstream.

The owner is the Unified Capability Control Plane workstream. MyEve's canonical policy, current preference revision, and cross-database ordering remain authoritative. Relay consumes an authenticated contract once that owner qualifies it. Relay must not turn an authenticated policy snapshot into an execution grant.

## Exact binding

Please publish a versioned, authenticated server-to-server contract binding all of:

| Field | Required meaning |
|---|---|
| schemaVersion, issuer, audience, keyId | Versioned envelope; issuer trust/key lifecycle and exact Relay receiving backend. No client-selected verifier or issuer. |
| ownerId, organizationId, installationId, environment | Canonical MyEve owner scope; explicitly provisioned mapping to Relay accountId and ownerPrincipalId. No email/name matching. |
| accountId, ownerPrincipalId, agentId | Existing active Relay account, HUMAN OWNER membership and exact agent. Revalidate locally, including account retirement, membership suspension and agent credential revocation. |
| runtimeClientId, harnessId, parentAgentId, delegationChainDigest | Authenticated qualified workload; exact consumer and attenuated parent chain. No implication that Sofie Native, Role Packs or MySkills are qualified by name alone. |
| connectionId, provider, toolkit, connectedAccountDigest, authConfigDigest | Exact locally resolved connection. Provider is composio. Bind Relay's opaque scope-derived provider user ID; provider IDs remain server-side. |
| authorityVersion, connectionRevocationEpoch | Monotone local lifecycle state. An existing or cached ACK cannot survive local revoke or rebind. |
| capabilityId, capabilityVersion, registryDigest | Canonical registry identity, not a new Relay registry. Registry changes owned/approved by Control Plane. |
| toolSlug, toolVersion, toolSchemaHash | Exact reviewed tool identity and immutable version/schema; no latest fallback or similar-name match. |
| effect, targetResource, actionHash, argumentDigest | Canonical ActionIntent binding, exact target and arguments; include resource restrictions and approval identity where applicable. |
| idempotencyKey, requestDigest, challengeNonce | Single attempt identity; different request under same key is a conflict. Nonce is audience/scope/attempt bound and single use. |
| ownerPolicyRevision, organizationPolicyRevision, relayPolicyRevision, grantRevision, registryRevision | Exact effective policy/grant vector, not a timestamp in place of revision comparison. Include current revisions, dependency enablement, harness qualification and pending-control status. |
| issuedAt, notBefore, expiresAt, maximumClockSkew | Canonical freshness window and verifier rules. Caller cannot choose grace periods. Expiry alone is insufficient when a newer policy exists. |
| revocationEpoch, admissionSequence, reservationId | Canonical ordering and budget reservation/fencing identifiers needed to close the cross-database check/dispatch race. |

The current `DiscoveryProjection` is a server-only attenuation/read interface. It carries exact scope, connection and authority version, policy revisions, expiry, owner/organization flags, qualified harnesses, and at most ten READ tool descriptors. Its default source returns null. It is NOT signed-policy verification, canonical current-policy storage, remote admission, or a portable grant.

## Capability and effect decisions needed from the owner

The inspected canonical registry contains `connected-apps` with Relay ownership. Requested product labels COMPOSIO_PROVIDER, EXTERNAL_INTEGRATIONS, TOOL_DISCOVERY, EXTERNAL_READ and EXTERNAL_WRITE are **proposed mappings**, not newly registered capabilities. Please supply stable canonical IDs/versions and dependency mappings under the existing registry, including disabled/default behavior and owner/organization intersections. Synthetic discovery uses existing Relay `github.repo.read` only as a local attenuation grant; it does not register Composio authority.

READ maps to canonical `read`. EXTERNAL_WRITE maps to `external_write`; communication must retain canonical `communication` treatment where applicable. FINANCIAL maps to `financial`, DESTRUCTIVE to `destructive`. PRIVATE_WRITE has no assumed canonical equivalent: deny until the owner specifies one. All non-READ tools remain disabled at this checkpoint, regardless of snapshot or approval. Revocation of Relay access is an owner management operation, never a tool permission given to an agent.

## Positive admission ACK and ordering qualification

Please provide a verifier/API and adversarial tests proving an authenticated positive ACK is linearized against policy changes, owner toggles, grant revocation, delegation revocation, budget reservation, and local Relay revocation. The receiving backend must revalidate canonical facts as required by the qualified protocol. The existing `admissionEligible:false`, `receivingBackendRevalidation:REQUIRED`, `orderingQualification:UNAVAILABLE` response MUST remain a denial.

Specify the exact ownership of the transaction/fence across databases, the moment an operation becomes admitted, which revocations win each race, acknowledgment durability, nonce consumption, expiry checking at dispatch, crash recovery, lease/budget release, and audit correlation. A signed JSON response, mTLS connection, boolean `allow`, or recent snapshot alone is not qualification. Relay will require a separate reviewed integration change to consume this ACK; there is intentionally no injectable positive callback in this checkpoint's gateway.

## Revocation and failure semantics

- Relay revocation commits local REVOKED state, increments authorityVersion, and appends canonical signed audit evidence atomically before contacting the provider. Provider revocation may remain PENDING; that never restores Relay access. Confirmation is monotone. Replayed connection completion returns current revoked state.
- Canonical revocation must invalidate outstanding admissions, cached discovery projections, retries, delegated children and budget reservations according to the qualified order. Define source epoch, acknowledgment, bounded propagation behavior and fail-closed operation while synchronization is uncertain.
- Missing policy, unknown binding/capability/harness, bad issuer/audience/signature, stale revision, expired decision, pending controls, clock uncertainty, missing admission ACK, unreachable authority, or unqualified ordering → NOT_DISPATCHED. No provider execute call, fallback token, alternate credential, or automatic retry.
- Accepted but ambiguously dispatched provider request → UNKNOWN. Never report NOT_DISPATCHED or retry without reconciliation; the current gateway cannot reach this state because execution is disabled.
- Duplicate same request → same durable receipt; conflicting request → IDEMPOTENCY_CONFLICT. Authentication and local lifecycle must still be checked. Receipt is evidence, not reusable authority.
- Control Plane outages must not prevent owner local denial, assuming Relay's database and canonical evidence signer remain available. Provider revocation reconciliation stays separate.

## Acceptance package requested

Versioned schema, issuer/audience/key rotation profile, canonical capability mapping, policy freshness/revocation specification, working positive and negative examples, and independently reviewed cross-database race tests. Include simultaneous revoke/dispatch, policy revision change during dispatch, parent revoke, expiry, process crash, duplicate ACK, duplicate action, account retirement, changed argument/connection/tool/hash, and authority outage. Identify exact qualified MyEve and Relay commits, database roles, authenticated workload, and permitted environments. A synthetic positive example must remain labeled synthetic and cannot qualify live execution.
