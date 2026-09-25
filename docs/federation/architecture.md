# Federation reconciliation

Federation is additive to V2. The existing V2 release gates remain unchanged.

| Existing mechanism | Federation use |
| --- | --- |
| accounts, principals, memberships | RelayOwner is an account trust domain. Only its authenticated OWNER may enroll federation or publish. |
| agents, agent_credentials, Passports | RelayAgent extends the existing Agent. Opaque hashed credentials bind every request to persisted account and Agent identity. Rotation preserves identity. Replacement creates a new Agent. |
| capability_grants | These frozen V1 grants are same-account, one-capability allow/deny records. They cannot represent cross-owner resource authority. Add first-class federation grants; never reinterpret V1 grants. |
| V2 capability definitions and policy | Register versioned federation definitions. Evaluate receiving-account policy against the receiving Agent and resource, after independently checking the external caller's grant. Do not weaken TENANT_MISMATCH. |
| approvals and budgets | Reuse V2 exact-action approvals and reservations. No federation approval token or financial ledger. |
| leases | A federation envelope authorizes delivery only. It is never a local execution lease. Receiving platforms must apply local authorization and their own execution boundaries. |
| control_outbox | Atomic metadata-only wakeups; polling is the initial transport, with bounded redelivery. |
| V1 agent_inbox / V2 tasks | V1 inbox requires V1 events; V2 tasks require Relay execution routes. Federation request state is a separate cross-owner request, never the receiving platform's local Run. Do not fabricate local execution tasks to route requests. |
| signed audit and encryption | Reuse signer and account-bound key wrapping. Audit contains disclosure references, never queries, bodies, answers, or work output. Delivery payloads are encrypted and expire. |
| MCP | Thin adapter over the same federation service and authenticated Agent identity. |
| providers | No provider receives implicit cross-owner authority; no changes to MyEve or execution providers. |

## Identity and authority

Canonical addresses use immutable account and Agent IDs: `relay://acct_…/agt_…`.
Display names and endpoints are metadata, never identity. Revoked identities and their addresses are not recycled. Owner grants apply to any active registered Agent of that owner; Agent grants match exactly one identity. Grantor Agent scope restricts which of the grantor's Agents may receive the request. Resource scope is exact; capabilities never imply one another. Primary Agent is optional.

Publication is an owner-controlled projection of opaque canonical references. Relay never reads the private memory store. Snapshot changes require a new explicit owner publication version. Dynamic membership requires an owner-authored deterministic rule plus explicit per-record eligibility. Published content remains at the platform. Historical receipts retain the disclosed version and references. Revocation blocks future retrieval but cannot erase information already legitimately delivered across a trust boundary.

## Platform contract

Platforms poll using Agent credentials, verify the signed envelope against a configured trusted Relay key and audience, atomically deduplicate request IDs, and independently authorize locally. `REQUIRE_APPROVAL` and `REJECT` are valid local responses. A knowledge adapter must accept only published references and use a projection reader with no private memory, conversation, goal, email, calendar, finance, workspace, or general search interface. Synthesis is optional and only receives the retrieved projection. Input strings are untrusted data, never authority.

Private canonical deletion must invalidate all publication references before subsequent retrieval. Platforms must also enforce deletion locally; Relay cannot verify an independently operated platform's internals. Platform execution receipts are attestations, not proof of those internals.

## Delivery

Relay acceptance, delivery, local acceptance, and completion are distinct. Polling avoids permanent sockets and arbitrary endpoint fetches. Outbox contains request IDs only. Delivery retries retain request identity and have an attempt ceiling and expiration. Platforms deduplicate durably before starting local work; no exactly-once execution claim is made. Content retention is bounded by request expiry and deleted after acknowledged consumption. Neither conversation IDs nor audit receipts constitute a permanent chat archive.

## Concrete semantics and current bounds

- `message.send` admission requires a sender declaration and grant plus the target's `message.receive` declaration and receiving policy/Passport eligibility. The equivalent artifact pair is `artifact.share` / `artifact.receive`.
- Public queries require an authenticated registered Agent, explicit owner `publicQueryPolicy`, and receiving V2 policy. There is no anonymous query endpoint. A revoked matching grant prevents public fallback for that identity; an explicitly restored active grant can authorize again.
- A nonempty grant topic list restricts requested topics and the actual projected membership, not the natural-language meaning of a query. The query cannot expand the reference set.
- Publication membership is at most 500 references per version; query projection at most 50 records. Envelope/result transport is at most 128 KiB. Requests live at most 24 hours. Delivery has at most three attempts with bounded backoff. JWS delivery assertions live at most 60 seconds.
- Work is an invitation with four allowed categories and no delegated workers. It has explicit runtime, model-step, deadline, and cost ceilings. Existing V2 `MODEL_SPEND` reservations are created atomically with federation acceptance and reconciled against platform-reported cost. Runtime/step enforcement remains at the local execution boundary; Relay never issues a privileged local execution lease. Cost amounts use the receiving budget's existing minor-currency unit and currency. Cost-limited grants for other protocols fail closed rather than ignoring the condition.
- Work context contains IDs of completed, unexpired artifact shares between the same two Agent identities. A caller-supplied private file reference is not an authorized context source.
- Artifact payloads contain metadata and a source-issued HTTPS retrieval URL that is explicitly audience-bound and expires within five minutes. Relay neither fetches the URL nor copies the artifact. The source must enforce the audience and expiry on retrieval; the receiver must validate byte count/checksum and its own network policy. A Relay receipt does not certify an arbitrary remote storage service.
- Conversation IDs are labels scoped to the communicating identities, not authority. Replies must reference a prior accepted/completed message between the same Agents and conversation. No conversation-body index or permanent chat store is created.
- `NETWORK` currently requires the same explicit contact/trusted relationship as `CONTACTS_ONLY`; no organization/network membership is inferred. Trust never substitutes for a grant.
- The existing V2 approval service's freshness and exact-action restrictions still apply, including its short decision expiry. A stale pending approval requires a new submission. Consumed approvals are bound to the request and policy revision and are rechecked for revocation.
- A changed publication version invalidates queued requests, rather than silently changing their disclosure set. Historical receipt versions remain unchanged. Re-publication after pause does not implicitly reactivate a paused view. Revoked publications and Agents cannot be reactivated.

## Operational qualification

Enable only after configuring V2 cryptographic bindings and explicitly provisioning the federation definitions, owner Passports/policies, and grants. Both `RELAY_V2_ACTIONS_ENABLED=true` and `RELAY_FEDERATION_ENABLED=true` are required by HTTP/MCP. The existing private-preview kill switch wins over both.

The maintenance worker purges expired ciphertext when federation is enabled. The existing V2 budget scheduler must continue expiring reservations; the federation maintenance function also accepts cryptographic bindings to invoke that shared expiry service. Abandoned/failed work reservations remain conservatively reserved until reconciliation or expiry; Relay does not invent zero usage when an external outcome is unknown.

This implementation does not modify MyEve, provision a production signer, configure external storage, or authorize a deployment. Independent receiving-platform isolation, source artifact access enforcement, real local runtime/step cancellation, production cryptographic rotation/recovery, delivery SLOs, and security review remain external qualification obligations.
