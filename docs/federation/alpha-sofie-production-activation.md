# Alpha ↔ Sofie production activation

Status (2026-09-26): production Federation is enabled. Alpha and Sofie completed a live, approval-gated exchange; the exact messaging relationship was renewed for seven days. The activation steps below are retained as the original runbook.

## Current production relationship

- Relay runs at `https://relay-sage-nine.vercel.app`; Sofie runs at `https://sofie-personal-agent.vercel.app`. Alpha's responder is a running local Mac LaunchAgent.
- Sofie's saved peer permission requires owner approval for both incoming `message.receive` and outgoing `message.send`. Its exact Alpha relationship expires **2026-10-03 16:09:23 UTC**.
- The three existing Relay grants remain limited to `message.send` between the same two Agent IDs, with their original resources, 10-calls-per-minute rate limit, and empty topic list. They expire **2026-10-03 16:14:54 UTC**. Relay's grant-level `approvalRequired` remains false; Sofie's local policy provides the per-message approval gate.
- Both production Agent Passports were reissued with valid signatures, `REGISTERED` trust, only `message.receive` eligibility, and no data access. They expire **2026-10-03 16:18:36 UTC**. Previous Passport versions are superseded.
- Read-only production authority inspections returned `ACTIVE` in both directions after renewal. The effective relationship expires when Sofie's peer permission expires first. No new live message was sent during the renewal check.

The Relay grant expiry was extended through a guarded operator database update after verifying every existing Agent, resource, capability, rate-limit, and topic field. This operation did not use Relay's grant-creation API, so it did not append a grant-creation audit event. Future renewals should use an audited owner operation.

## Pre-activation baseline (2026-09-25)

The following notes describe the state before production activation, not the current deployment.

- Relay candidate: production secret signing and protected expiry cron. Sofie candidate: free-only peer replies, reply-settings migration, and protected inbox cron.
- The local synthetic conversation report is `/private/tmp/alpha-conversation-report-current.json`. Alpha initiated a signed question, Sofie required exact owner approval and answered only from the approved SellerFi profile, Sofie followed up, and Alpha answered from its separate Orion profile. The model response was test-stubbed, so hosted model inference remains unverified.
- Relay production currently has 21 applied Drizzle migrations (through `0020`), `RELAY_DEPLOYMENT_MODE=private-preview`, V2 actions disabled, and Federation disabled. The candidate adds migrations `0021`–`0023`; they create new tables and indexes and do not alter existing rows.
- Sofie production is at migration `0038`; `app_settings` already exists and an active Sofie Agent is present. The candidate adds the idempotent `0039` migration.
- Both Vercel projects have team-issuer OIDC enabled. The Vercel team is Pro, so a once-per-minute Sofie poll cron and five-minute Relay expiry cron are within the [documented schedule limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## No-additional-service signing decision

The owner declined any new paid service. Use three distinct Ed25519 signing keys and one 3072-bit RSA wrapping key in **Vercel production Sensitive Environment Variables**. The private keys are exportable to project functions and people with sufficient Vercel access, unlike Cloud KMS keys. Generate once offline; never generate at function startup or commit keys. Set `RELAY_CRYPTO_BACKEND=vercel-secret`, `RELAY_PRODUCTION_SECRET_SIGNING_KEYS_JSON` (purpose-specific key metadata and active private PEM), and `RELAY_PRODUCTION_SECRET_WRAPPING_KEY_JSON` (`keyId`, `version`, private PEM). The application requires Vercel production, all three purposes, matching public/private keys, and an explicit production deployment mode before enabling Federation.

Sofie uses `MYEVE_RELAY_FREE_MODEL_ONLY=true` for peer replies. This pins the [currently zero-priced Ling 3.0 Flash VL Free model](https://vercel.com/ai-gateway/models/ling-3.0-flash-vl-free) and its Novita provider, checks the Gateway catalog before invocation, and requires a zero-cost receipt afterward. If its rate changes or it is unavailable, Sofie records `replyStatus: unavailable`; it does not fall back to a paid model. This does not waive [Vercel Function usage](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Pro overage charges](https://vercel.com/docs/plans/pro-plan), or any existing database charges. Check the team's live usage and hard spend controls before deployment; a production operation cannot promise zero incremental charges on a metered account.

## Activation order

1. Generate production-only purpose-specific signing keys and a 3072-bit wrapping key offline. Store private PEM only in Vercel production Sensitive Environment Variables. Record the delivery signer ID, version and public SPKI for Sofie. Verify the runtime startup with these exact settings locally before changing production. Restrict Vercel project membership to trusted operators and keep access logs.
2. Back up and apply Relay migrations `0021`–`0023`, then Sofie migration `0039`; check both migration ledgers. Confirm the current production domains and project IDs before changing settings.
3. Add Relay's production secret variables and a random `CRON_SECRET`. Set production deployment mode, V2 actions and Federation enabled, then deploy the pinned Relay candidate. Verify startup, a signed small-message operation, and its protected maintenance endpoint.
4. Add Sofie's pinned Relay origin, delivery public key ID/version/PEM, random encryption key, owner origin, `CRON_SECRET`, `MYEVE_RELAY_FREE_MODEL_ONLY=true`, and `MYEVE_RELAY_ENABLED=true`; deploy the pinned Sofie candidate. Verify its protected poll endpoint denies unauthenticated calls and reaches Relay when authenticated.
5. Connect the existing Sofie Agent through the supported owner flow. Store only the owner-approved profile: “Jay is building SellerFi, a buyer/seller marketplace for business transactions.” Create Alpha as a separate synthetic test owner/Agent with the distinct profile “Alpha's synthetic project Orion is built with Rust 1.85.” Grant only expiring `message.send` authority between these two identities.
6. Have Alpha ask Sofie for the high-level SellerFi description. Confirm Sofie holds the new peer message for exact owner approval, approve that request, and observe Sofie's correlated model-written answer. Have Sofie ask Alpha for its Orion detail and observe Alpha's correlated reply. Retain only request IDs, result states, cost and redacted operational evidence.

If any hosted check fails, disable Federation and Sofie Relay flags and redeploy; revoke the test grant and credentials. If signing material is suspected to be compromised, rotate it and update every public-key pin; previous deployments retain their old environment snapshot until retired. A code rollback alone does not stop an already-running Cron invocation.
