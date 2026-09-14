# Relay V2 Capability Leases and Workload Identity

WO-08 turns an eligible, policy-approved action into short-lived, non-transferable authority. The signed lease is bound to account, Agent, runtime client, workload, task, audience, capability version, exact resource/action hash, policy revision, approval, budget reservation reference, environment, call ceiling, expiry, delegation chain, parent, and revocation epoch.

## Workload bootstrap

The control plane registers a workload with an ephemeral public key and emits a single-use bootstrap secret valid for at most five minutes. Exchange requires a signature over the Relay challenge, proving possession of the workload private key. Relay then activates the workload and returns a short-lived signed identity token. Relay never receives the private key and the bootstrap cannot be replayed or used across accounts.

This is the provider-neutral identity contract. WO-11 through WO-14 bind it to managed providers, customer runners, and mTLS/certificate delivery.

## Lease issuance

Issuance rechecks the workload, runtime, Agent Passport, provider/assurance restrictions, current policy decision, resource/action hash, expiry, and revocation epoch in one guarded transaction. A required approval is consumed in that same transaction. Financial, destructive, and new-recipient communication approval floors are re-enforced at issuance so a misconfigured policy cannot bypass them.

Parent leases may only delegate the same capability over an equal or narrower resource and expiry. Child call authority is atomically reserved from the parent's remaining calls, preventing concurrent delegation amplification. Renewal creates a new lease and decision.

## Reference PEP

The reference policy-enforcement point verifies the Ed25519 token before consulting state, then checks account, audience, workload, action/resource, time, online revocation epoch, workload status, parent status, and call ceiling. Per-call IDs are unique; replay and concurrent overuse fail. Emergency Agent revocation increments the epoch and revokes current leases in the authoritative database.

Offline enforcement is opt-in and limited to a parentless, low-risk read lease with at most 60 seconds remaining and a caller-provided durable local counter. Financial and destructive leases always require online introspection. Control-plane failure never widens eligibility.

## Isolation obligation

Workloads, bootstrap secrets, leases, epochs, parent relationships, call receipts, introspection, and revocation are all account-scoped. Focused negative tests for each binding join the complete WO-22 tenant-isolation suite.
