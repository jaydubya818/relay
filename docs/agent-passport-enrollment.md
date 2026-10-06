# Agent Passport enrollment for messaging

An Agent Passport is Relay's signed identity and capability-eligibility statement. It binds one existing Agent to one account and issuing owner principal. It is not a bearer credential, capability grant, policy allowance, or permission to execute Work.

Registration and Passport enrollment are separate explicit steps. An authenticated account OWNER can enroll an existing active, registered Agent through `POST /api/agents/{id}/passport` with `operation: "issue"`, `expectedVersion`, and `expiresAt`. The service derives eligibility only from that Agent's declared, enabled `message.send` and `message.receive` definitions. It issues REGISTERED trust with no data access, budget, policy, or provider authority. Expiry must be within 24 hours. `GET` returns the owned Agent's latest enrollment status; `operation: "revoke"` requires its exact current Passport ID.

Relay signs through its configured purpose-specific Passport key. New Passports include key ID, immutable key version, purpose and algorithm in the signed payload. The public trust endpoint publishes verification keys only. Private signing material remains server-side.

Federation still requires the existing Agent credential. Authentication checks the current durable Passport, issuer, signature, key identity/version and validity interval, account/Agent/owner bindings, active owner membership, revocation epoch, and expiry. Admission and subsequent delivery/result access recheck both peers under the same account fences used by revocation. Independent capability grants and policy remain mandatory. A Passport cannot substitute for either.

Issuance, replacement, revocation, trust downgrade and activation serialize through account and Agent locks. Replacement uses optimistic version matching; versions increase across revoked history. Revocation preserves signed historical payloads. Old versions cannot be presented as the current Passport. Historical v1 Passports without signed key metadata remain verifiable against their exact immutable registry key; duplicate public-key identities are rejected, including revoked-key aliases. No historical Passport is silently rewritten or reissued.

`passport.verify` requires a valid existing Agent credential and verifies only that Agent's exact current bundle. It cannot authenticate another Agent or account and grants no authority. Owner endpoints reject cross-account access; issuance does not accept caller-supplied identity, issuer, trust, capability, or signing-key fields.

Messaging setup additionally requires an independently activated account or Relay policy and an exact peer/resource grant. If policy is absent, enrollment must leave messaging denied. Existing policy activation requires fresh password step-up bound to the policy bundle hash. Enrollment does not bypass that requirement or automatically activate policy.

Regression coverage includes missing enrollment, signature/claim alteration, wrong owner/Agent, expiry, revocation, stale versions, concurrent issuance, eligibility separation, immutable key identity, and retained history. Production qualification uses synthetic messages and correlated Relay responses, without model calls, Factory grants, generated publication, or Rooms enablement.
