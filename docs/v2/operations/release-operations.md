# Relay V2 release operations

This is the operating contract for limited beta and GA. It does not qualify an environment by itself. Every rehearsal produces timestamped evidence owned by the named on-call or release role.

## Service objectives and alerts

| Signal | Objective / trigger | Required response |
|---|---|---|
| Control API availability | 99.9% monthly; page below 99.5% over 30 minutes | Freeze consequential dispatch; follow control-plane incident runbook |
| Policy decision latency | p95 <100 ms, p99 <250 ms; page after two 5-minute breaches | Fail closed for missing facts; inspect database and fact resolver |
| Lease introspection / revocation | p95 <50 ms; emergency revoke visible <5 s | Quarantine affected PEP/provider if visibility exceeds 5 s |
| Verified webhook acknowledgement | Within each provider deadline; page at 80% of deadline | Persist then defer; apply source quota without skipping verification |
| Approval decision delivery | p95 <2 s; workload resume <5 s excluding cold start | Retain waiting state; never synthesize approval |
| Queue lag | warn 30 s, page 120 s by account/source partition | Scale workers; inspect poison source and fairness |
| DLQ / unknown effects | page on any financial unknown; warn on growth >10/5 min | Disable affected effect path and reconcile before replay |
| Budget drift | page on stale/unknown purchase balance or invariant mismatch | Stop new reservations; reconcile ledger |
| Provider/channel health | open circuit after qualified threshold; page if launch path unavailable | Activate provider-specific kill switch and status communication |
| Runner health | page on revoked runner polling, trust-epoch mismatch, or >2 missed heartbeats | Revoke assignments/workloads/leases and rotate credentials |
| Evidence pipeline | page on consequential action lacking durable evidence finalization | Hold success acknowledgment; do not replay external effect |

Telemetry must include `account_id`, `task_id`, `action_intent_id`, `lease_id`, `provider`, `attempt`, and trace context where applicable. Metric labels must not include message bodies, URLs with secrets, credential handles, or unbounded resource IDs.

## Provider and channel kill switch

1. Incident commander names the provider/version/surface and records the reason.
2. Disable new placement or dispatch before changing routing weights. Hard filters and policy may not be relaxed to restore capacity.
3. Revoke or terminate active work when the threat requires it; ambiguous effects enter reconciliation-required state.
4. Confirm health reports unavailable, new dispatch fails pre-effect, and unaffected providers retain their existing constraints.
5. Re-enable only from a reviewed qualification version after a canary. Record actor, time, version, and test evidence.

Browserbase and E2B use the provider kill-switch contract. Connector definitions and account connections fail closed when inactive or revoked. Slack/Telegram connections fail closed when disconnected or revoked. A production deployment must bind these controls to an audited, distributed store; an in-process fixture is not production evidence.

## Restore and regional recovery

- Authoritative committed PostgreSQL control records have RPO 0. Evidence objects use versioning/object lock according to retention class. Vault/KMS metadata and public verification keys are backed up separately from ciphertext.
- Restore into an isolated account/region. Block dispatch and inbound routing until migrations, row counts, audit chain heads, outbox/DLQ state, key references, and revocation epochs reconcile.
- Reissue service and workload identities; do not restore expired bootstrap, viewer, approval, checkout, or lease bearer material.
- Replay only unpublished idempotent outbox records. `POSSIBLY_COMMITTED` actions remain effect-unknown until provider reconciliation.
- Exit when restore evidence proves RPO 0 for committed control records and RTO <=60 minutes. Production database failover and regional restore evidence is external qualification.

## Required drills

| Drill | Passing observation |
|---|---|
| Worker death before effect | Lease expiry requeues once with a new fence |
| Worker death after possible effect | One DLQ entry marked `EFFECT_UNKNOWN`; no automatic retry |
| Duplicate/reordered ingress | One logical task per route/dedupe key; reorder evidence retained |
| Outbox publisher failure | Durable unpublished record remains and converges under stable idempotency |
| Runner compromise/revoke | Runner, assignments, workloads, leases, viewers, and broker bindings become unusable within the qualified bound |
| Provider outage / 429 / 5xx | No policy widening; only classified pre-effect retries; kill switch prevents dispatch |
| Stale policy/budget | Consequential action denied; operator sees an actionable stale/unknown state |
| Evidence tamper/delete/reorder | Offline verification fails |
| Credential canary | Canary absent from model outputs, logs, traces, persisted evidence, screenshots, and provider payloads |
| Data deletion/retention | Early delete denied; eligible tenant artifact and wrapped key become inaccessible with auditable proof |

## Privacy and retention rehearsal

Inventory data by account, purpose, classification, region, and retention class. Export must include only authorized account records and must preserve redaction. Deletion first blocks new work, revokes identities/connections/leases, drains or quarantines unknown effects, deletes eligible objects, destroys tenant key material according to policy, and retains only legally required audit tombstones. Screen recordings and message content require explicit disclosure and separate retention. Production legal retention policy, regional controls, and deletion rehearsal remain external sign-off items.

## Staged rollout and rollback

1. Internal synthetic accounts: no live financial execution; managed provider only.
2. Design-partner beta: explicit account allowlist, per-provider allowlist, conservative budgets, staffed on-call, and daily unknown-effect review.
3. Expanded beta: only after current live channel/provider/connector reports and comprehension/accessibility evidence.
4. GA: only after the machine gate, independent security review and penetration test, restore/failover drills, signed build provenance, and explicit Product Owner decision all pass.

Rollback disables new event routes and consequential dispatch, preserves durable receipts/audit/outbox/DLQ, revokes active bounded authority, and drains safe reads. It never rewrites V1, converts unknown effects into failures, or deletes evidence to make a rollback appear clean.

## Incident ownership

The release lead owns rollout state; security owns compromise containment and exception acceptance; operations owns restore/failover evidence; provider owners own current qualification/runbooks; product owns beta cohort and explicit limited-beta/GA decisions. No person may self-attest an independent review.
