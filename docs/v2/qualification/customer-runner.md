# Customer runner qualification

## Local contract evidence

- One-time enrollment, proof of possession, signed certificate, trust epoch, expiry, and revoke paths.
- Outbound polling API only; no runner listener or inbound control endpoint is introduced.
- Account/runner/task/workload/lease/fence bindings on assignments.
- Per-assignment credential socket handles and named-resource allowlists.
- Signed ordered evidence remains `runner_reported`.
- Forged attestation cannot raise assurance.
- Tenant isolation covers enrollments, runners, assignments, evidence, gateway resources, gateway receipts, polling, and revocation.

Focused suite: `tests/v2/runners.test.ts`.

## Remaining deployment qualification

`BLOCKED_EXTERNAL_CONFIGURATION`: no external customer host, production mTLS issuer, platform-attestation verifier, private DNS target, or signed runner release artifact is configured in this environment. Therefore network capture, real disconnect/revoke latency, host escape resistance, patch/update delivery, and production supply-chain provenance are not claimed. These are WO-22 gates before limited beta for customer-hosted runners.

The TypeScript control-plane implementation is not a distributable runner binary. A future binary built from this contract must publish an SBOM, reproducible digest, signature, supported-version window, and rollback artifact before it can be enabled in production.
