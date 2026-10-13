# Checkpoint D policy transport candidate

Status: PARTIAL. Isolated qualification only.

Relay retains its native Passport, policy, workload, approval, budget and lease authorization. Ordered remote admission adds a second signed proof bound to the exact MyEve permit hash. An account policy epoch advances under the existing account lock and emits a durable signed fence through controlOutbox. New proofs remain unavailable until every frozen receiver durably acknowledges that epoch.

The isolated server-only RELAY_CAPABILITY_COORDINATION_JSON binds the account, canonical owner, organization, installation, backend incarnation, agent, canonical-to-Relay capability mapping, trusted endpoint, and source/receiver public keys. The signer is synthetic. RELAY_CAPABILITY_ENVIRONMENT must be qualification, and hosted Vercel configuration is rejected.

The signed /api/v2/control/capability-fences route forwards owner fences and verifies the exact receiver acknowledgment before persisting and returning it. The maintenance worker retries Relay authority fences. Generic outbox publication does not count as an acknowledgment. Retired accounts can still deliver revocation fences.

Invalidating transitions covered here include Passport changes, trust downgrade, account policy changes, global safety policy publication, principal suspension, runtime verification/revocation, approval revocation, lease/workload/emergency revocation, delegated completion/revocation and beta retirement. These changes do not settle accounting or claim cleanup.

Run `node scripts/qualify-capability-administration.mjs`. The suite creates a disposable PostgreSQL cluster. The ordered-lease test uses real native lease issuance and a local HTTP receiver fixture that commits its ACK before replying. It does not prove MissionControl WorkOrder admission or the composed browser journey.

Remaining gates: complete invalidation-path review, account restore/incarnation recovery, bounded background recovery for owner-fence transport after process failure, native backend lifecycle acknowledgment integration, and cross-system Golden Journey. The preview deployment incident remains preserved in the prior checkpoint; branch deployment exclusion must remain false.
