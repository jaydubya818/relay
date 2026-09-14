# Linear connector qualification

Status: LOCAL PASS; LIVE PROVIDER BLOCKED_EXTERNAL_CONFIGURATION

The local conformance pack verifies current `read write` OAuth declaration, signed manifest, team restriction, issue canonicalization, issue create, title/description-only update, rejection of workflow-state and wrong-team writes, stable Relay references, ambiguous-effect reconciliation, opaque credential handles, permission drift, revocation, and tenant isolation.

Live qualification requires a V2 OAuth app, isolated Linear workspace/team, current rotating refresh-token broker support, and webhook/secret configuration. The pack must prove team containment, app actor identity where selected, issue create/update receipts, ambiguous create reconciliation without duplication, rate-limit handling, deauthorization/revoke, scope display, and token non-exposure.
