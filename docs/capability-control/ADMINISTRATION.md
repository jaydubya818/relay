# Capability administration compatibility

Accepted Relay base: a90625776193031ca2303ba2e2162249d1245479.

`GET/POST /api/v2/operator/capability-policy` exposes existing administrative contracts. Identity comes from the authenticated user, active principal and account membership; body-supplied account/principal/owner fields are rejected. Mutations require same origin and bounded JSON. OWNER/ADMIN membership is checked again by the canonical services under their existing account/agent locks.

Commands:

- `stage_policy`: name, ACCOUNT/RESOURCE/TASK/DYNAMIC_RISK layer, existing Relay rules. Returns the existing signed bundle. Staging is audited in the same transaction. Each staging call deliberately creates a new version; it is not an activation retry.
- `activate_policy` / `retire_policy`: exact bundleId and password. Uses the existing fresh, action-hash-bound password step-up and signed audit. Activation rejects older staged versions after a concurrent stage; review the newest version.
- `issue_passport`: agentId, required expectedVersion and the existing Passport policy. Concurrent updates at the same version have one winner.
- `revoke_passport`: agentId and exact current passportId. Uses the existing revocation epoch and audit; it cannot revoke a successor through a stale ID.

This adds no registry, capability grants, or separate authorization engine. Owner feature preferences stay in MyEve. Relay action capability definitions and Passports continue to express organization/agent constraints. They do not map one-to-one to owner feature names without an explicit backend compatibility mapping.

No UI was added to the governance page in this checkpoint. No service is deployed. No bridge exports these decisions into MyEve's qualification projection yet. Live policy propagation and cross-database revocation ordering are NOT_QUALIFIED. MyEve preferences cannot override a Relay denial, and no platform-owner identity has been provisioned here.

Run `node scripts/qualify-capability-administration.mjs` for disposable PostgreSQL tests; no existing database is used. Hosted qualification runs the same script. Existing policy, Passport and peer-message regressions are included.

## Preview-build incident

The initial checkpoint push exposed a missing Vercel exclusion for this new branch and triggered two unintended preview builds. Both were explicitly cancelled, verified CANCELED with target null and aliasAssigned false, before readiness. The branch exclusion is now explicit in vercel.json. No production target, alias promotion, active external-alpha installation or paid execution was changed. Exact cancellation metadata is retained in evidence/preview-cancellation.json. The no-deployment boundary was not perfectly observed; this incident must remain visible in the checkpoint report.
