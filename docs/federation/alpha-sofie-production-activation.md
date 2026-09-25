# Alpha ↔ Sofie production activation

Status (2026-09-25): source and local protocol tests pass. Production Federation has not been enabled or tested.

## Candidate and current host

- Relay candidate: `4ab5f2f` (production KMS startup, protected expiry cron). Sofie candidate: `07733a6` (reply-settings migration, protected inbox cron).
- The local synthetic conversation report is `/private/tmp/alpha-conversation-report-current.json`. Alpha initiated a signed question, Sofie required exact owner approval and answered only from the approved SellerFi profile, Sofie followed up, and Alpha answered from its separate Orion profile. The model response was test-stubbed, so hosted model inference remains unverified.
- Relay production currently has 21 applied Drizzle migrations (through `0020`), `RELAY_DEPLOYMENT_MODE=private-preview`, V2 actions disabled, and Federation disabled. The candidate adds migrations `0021`–`0023`; they create new tables and indexes and do not alter existing rows.
- Sofie production is at migration `0038`; `app_settings` already exists and an active Sofie Agent is present. The candidate adds the idempotent `0039` migration.
- Both Vercel projects have team-issuer OIDC enabled. The Vercel team is Pro, so a once-per-minute Sofie poll cron and five-minute Relay expiry cron are within the [documented schedule limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Signing decision

The candidate uses a dedicated Google Cloud project with Vercel production OIDC, three non-exportable software Ed25519 signing key versions and one symmetric wrapping key version. Production Relay has no KMS identity, key versions, or public-key pins configured. The existing GCP project is named `relay-local-qualification` and has no key ring or workload-identity pool. A separate production project keeps its signing authority out of that local qualification project.

Four active software key versions cost approximately $0.24/month before operations at the [published Cloud KMS rates](https://cloud.google.com/kms/pricing). Creating and billing a dedicated project remains the owner's decision. The candidate pins the Vercel owner, Relay project, production environment, issuer, audience and subject before exchanging the request-scoped OIDC assertion for a Google access token.

## Activation order

1. Provision the approved GCP project and billing association, Cloud KMS and Workload Identity Federation APIs, a provider restricted to this Vercel Relay project in production, and four key versions. Grant the provider principal only key metadata/public-key reads, signing on the three signing keys, and encrypt/decrypt on the wrapping key. Verify Google key metadata and record the exact public SPKI pins. No private signing key is exported.
2. Back up and apply Relay migrations `0021`–`0023`, then Sofie migration `0039`; check both migration ledgers. Confirm the current production domains and project IDs before changing settings.
3. Add Relay's production KMS identity/key registry variables and a random `CRON_SECRET`. Set production deployment mode, V2 actions and Federation enabled, then deploy the pinned Relay candidate. Verify startup, a signed small-message operation, and its protected maintenance endpoint.
4. Add Sofie's pinned Relay origin, delivery public key ID/version/PEM, random encryption key, owner origin, `CRON_SECRET`, and `MYEVE_RELAY_ENABLED=true`; deploy the pinned Sofie candidate. Verify its protected poll endpoint denies unauthenticated calls and reaches Relay when authenticated.
5. Connect the existing Sofie Agent through the supported owner flow. Store only the owner-approved profile: “Jay is building SellerFi, a buyer/seller marketplace for business transactions.” Create Alpha as a separate synthetic test owner/Agent with the distinct profile “Alpha's synthetic project Orion is built with Rust 1.85.” Grant only expiring `message.send` authority between these two identities.
6. Have Alpha ask Sofie for the high-level SellerFi description. Confirm Sofie holds the new peer message for exact owner approval, approve that request, and observe Sofie's correlated model-written answer. Have Sofie ask Alpha for its Orion detail and observe Alpha's correlated reply. Retain only request IDs, result states, cost and redacted operational evidence.

If any hosted check fails, disable Federation and Sofie Relay flags and redeploy; revoke the test grant and credentials. Disable the KMS key versions if a signing identity is suspected to be compromised. A code rollback alone does not stop an already-running Cron invocation.
