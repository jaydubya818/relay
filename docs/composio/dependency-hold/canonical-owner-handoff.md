# Relay × Composio: canonical receiving admission handoff

**Prepared for the Unified Capability Control Plane owner. Dependency hold; no execution activation.** This is a request to qualify the existing authority's receiving adapter and mappings, not a new protocol, authorization registry or admission implementation. Prepared locally; no cross-chat message or external issue has been sent.

Preserved integration source: Relay `84b02ee17fc4e285f337f89ee58bb689aa8c21b1`. Preserved MyEve compatibility reference: `9200bd3826350ad586bb5640ca08557da7d1b984`. Inspected canonical Relay reference: `aec9d9adb4c057f4bbd85a3ec27155d14fe6f24b`. Canonical wire SHA-256: `4b198d32e1dcdc930c2658291906ebf72601e144596f3090202a3e7ee708d606`. SDK `@composio/core@0.22.0`. All 27 frozen Relay contracts remain unchanged. These pins establish compatibility, not receiving-backend qualification.

## Exact deliverable requested

Return the canonical receiving API/transaction, enrollment profile, native command/admission receipt and recovery interface, exact source commits, serialization vectors and independently reviewed PostgreSQL qualification evidence. Please identify the linearization point for positive Composio admission and the point after which a dispatch may have occurred.

The inspected `issueBackendOrderedPermit()` produces MyEve permits for enrolled native Work/Mission; `relayAdmissionPermit()` and `issueCapabilityLease(...remoteAdmission)` produce Relay permits and leases. The composed reference receiver is MissionControl `missions:start`. There is no qualified Composio receiving transaction in the inspected sources. The preserved integration branch's frozen lease interface has no remoteAdmission argument. An issuance signature, lease, discovery projection or FENCE_ACK cannot substitute for receiving admission.

## Required identity and action bindings

The receiving transaction must resolve authoritative records and compare all bindings below. Caller claims, matching email addresses, a provider description, or a connection lookup alone are insufficient.

| Binding | Canonical source and required comparison |
|---|---|
| Owner / tenant / installation | MyEve ownerId, organizationId, installationId and environment map through qualified enrollment to Relay accountId and active HUMAN ownerPrincipalId membership. Owner must supply this mapping; no default/global owner or cross-installation fallback. |
| Backend / policy identity | Exact canonical PolicyIdentity: authority, ownerId, organizationId, installationId, backendId, incarnation, enrollmentVersion, version, policyId. Resolve enrolled verifier/key and current trusted head server-side. |
| Agent / Work | Exact agentId, current agentRevision, harness eligibility, workId, workGeneration and native missionId, mapped to Relay taskId/runtimeClientId/workloadId and any delegation chain. Do not fabricate a Mission to satisfy the wire. |
| Connection | Exact Relay connectionId, account/owner/agent/installation; provider `composio`, toolkit, current authorityVersion/status/expiry/revocation, custody, scopes and server-held providerUserId/connectedAccountId/authConfigId. Include opaque provider identity digests in action material; do not expose those credentials/records to Sofie. |
| Capability | Owner-qualified capabilityId, registryVersion, requiredCapabilities and Relay capability name/version. `connected-apps` is the canonical candidate; local `github.repo.read@1.0` is only a synthetic fixture grant until the owner qualifies the mapping. Include required `work` dependency and harness restrictions. |
| Descriptor | Provider, toolkit, exact slug, immutable descriptor version, digest covering tool identity and input/output schemas, and qualification revision. Last validated descriptor must be the one passed to the SDK transport; no later unchecked descriptor lookup. |
| Action / arguments | Existing canonical ActionIntent capability/resource/parameters and hash; requested target/action and idempotency identity; exact parsed arguments digest with no silent field stripping. Include connection authority, descriptor, capability/effect, approval and runtime/lease identities in canonical admissionActionDigest material. |
| Effect | Only reviewed READ → canonical `read` is eligible for future qualification. PRIVATE_WRITE has no assumed mapping. EXTERNAL_WRITE/communication, financial and destructive actions remain denied; a provider-declared read label grants nothing. |
| Policy / freshness | Exact MyEve and Relay policy versions/heads, registry version, enrollment/incarnation, current agent revision and connection authority. Pending delivery, unknown trusted head, stale or restored state denies. Use canonical clock/lifetime rules: strict parser bounds challenge/permit lifetime to 30 seconds. Bound execution authority by the earliest relevant policy/lease/workload/connection expiry. |
| Runtime lease / approval | Existing authenticated runtime, workload attestation, passport, account/agent/task binding, server-owned audience, token issuer/key/hash, jti, action hash, policy decision/revision, effect, onlineRequired, nbf/exp, maxCalls/call identity, revocation epoch, parent/delegation and budgetReservationId. Bind exact approvalDecisionId and approval revision/scope where required; explicit absence cannot bypass an approval requirement. |

Use the owner's existing `SignedPolicyMessage {message,keyId,signature}` and strict CHALLENGE/PERMIT/FENCE/FENCE_ACK parser. Do not extend strict messages with an adapter `allow` field. Canonical `admissionActionDigest()` yields bare 64-hex; Relay canonicalHash uses `sha256:`. Supply owner-approved serialization vectors rather than stripping prefixes or independently recreating the hashing algorithm.

## Positive admission and durable acknowledgment

1. Authenticate Sofie using existing runtime authority; resolve task/Work/agent/connection and reviewed tool from authoritative records. Discovery is advisory and does not debit a lease.
2. The qualified receiver signs the existing CHALLENGE for the exact receiving snapshot and action. MyEve supplies the source PERMIT under its acknowledged policy fence; Relay supplies its source-bound PERMIT and canonical lease under existing policy/runtime/approval/budget authority.
3. At the owner-defined receiving transaction, revalidate both current policy heads, permits, enrollment, native Work, live runtime/lease/budget and local connection/descriptor fences. Persist the canonical admission/command, scoped idempotency fingerprint and existing reservation/evidence linkage as one qualified receiving decision. The owner must define ordering/rollback or reconciliation for canonical stores that cannot share a transaction. No independent distributed ledger is proposed.
4. Return the **existing native durable command/admission receipt**, only after the owner-defined commit. Its authoritative lookup must bind owner/tenant/installation/agent/Work, action digest, policy/enrollment versions, lease/call/reservation/approval, command identity, status and canonical evidence reference. The owner must identify the exact existing receipt schema and authenticated readback API. No new ADMISSION_ACK schema is defined here.
5. Lost acknowledgment replays the same receipt under current read authorization. Same scoped key with different action material conflicts. Neither a replay nor a receipt permits another dispatch. FENCE_ACK proves delivery of its exact fence hash, not admission, provider completion or cleanup.

`authorizeLeaseCall(...online:true)` is consuming, not a freshness probe. Existing runtime command creation and lease consumption use distinct transactions. The owner must qualify the crash window between those operations before Composio can use them. Never add a second lease accounting table to conceal that window.

## Dispatch, revocation and UNKNOWN

The owner must define the fenced worker claim and persist dispatch intent before an external call could begin. Multiple workers, redelivery, process restart and a lost result must not create a second provider request. Provider-side idempotency/status support for the exact Composio tool is currently **unqualified**; an idempotency key in a local body is not a provider guarantee. No exactly-once claim is made.

Ordinary disable denies new admission while respecting canonical semantics for previously admitted bounded Work. Pause remains pending until qualified suspension. Explicit revoke targets affected Work, runtime/child leases and writers; connection revoke durably increments local authority and denies before upstream acknowledgment. Enable cannot erase accumulated restrictive controls. Do not globally revoke unrelated active Work using a generic freshness counter.

After dispatch may have begun, timeout, transport error, worker loss, cancellation without proof, missing result or provider-reported failure remain UNKNOWN. Retain command identity, attempt, reservation/exposure and canonical evidence. **Do not retry blindly**, change idempotency key, mint a lease or release exposure based on timeout/expiry. Recovery requires the owner's authenticated, action-bound reconciliation contract and authoritative provider evidence. If the provider cannot prove success or no effect, keep UNKNOWN and require authorized reconciliation; do not invent a status endpoint.

## Required failure behavior and owner acceptance evidence

Missing receiver/enrollment/authority, invalid signature/key/destination, cross-owner/agent/installation/connection substitution, changed descriptor/arguments/effect/approval, stale policy, pending fence, offline or revoked runtime/lease/Work, unknown restored head, denied capability or absent approval must deny before dispatch. No fallback credential, alternate provider route or synthetic allow callback. Responses distinguish NOT_DISPATCHED from UNKNOWN and never imply an issues result without Result/Proof.

Please return tests for concurrent same-key admission and changed-payload conflict; lease debit/command commit failure; before/after dispatch-intent crashes; provider success followed by lost local commit; replay after revoke; disable/revoke races; restored databases with independent trusted head; wrong identities/keys/audiences; stale descriptor/policy; and authenticated result/evidence readback. Include real PostgreSQL results and an independent security review for this receiving backend.

Until accepted, the gateway remains `executionAvailable:false`, requestRead remains NOT_DISPATCHED, and [recovery/consumer preparation](execution-recovery-contract.md) remains separate from positive admission qualification.
