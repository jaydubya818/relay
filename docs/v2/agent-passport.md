# Relay V2 Agent Passport and Runtime Attribution

WO-05 separates portable identity claims from authority. A Passport describes an Agent's eligibility and restrictions; it is never a capability grant, policy permit, approval, or lease.

## Lifecycle

V2 Agents begin in `DRAFT`. Relay can issue an immutable, versioned `relay.agent-passport.v1` document only for an Agent in the same account. The signed payload contains issuer, Agent and owner identity, trust tier, capability eligibility, policy and budget references, allowed environments, data-access classifications, validity, and revocation epoch. Activation requires a current, unexpired Relay-issued Passport.

New Passport versions supersede earlier versions. A trust downgrade increments the authoritative revocation epoch, revokes the current Passport, returns the Agent to draft, records audit evidence, and invokes the incompatible-work revocation boundary implemented by WO-08 and WO-10. Until those services exist, the persisted epoch and draft state fail closed.

## Portability without authority

An imported Passport must pass schema, payload-hash, and issuer-signature verification. Relay stores the original signed bundle and provenance against a new draft Agent. Import does not issue a local Passport and creates no grants. An owner must deliberately configure and issue destination-account policy before activation.

Public federation and third-party issuer trust policy are excluded from V2. The import verifier accepts a public key supplied by the trusted control-plane issuer registry; exposing that registry is later work.

## Runtime attribution

Runtime clients have immutable Relay IDs and one-time credentials. Product names supplied during registration are always `SELF_DECLARED`. A configured server-side `RuntimeAttestationVerifier` is the only path to `VERIFIED`; callers cannot promote a label by asserting Claude, Codex, Cursor, OpenClaw, MyEve, or another product name. Revocation immediately invalidates the credential.

## Isolation obligation

Passport, import, runtime-client, and credential lookups are account-scoped. Focused negative tests cover cross-account Passport export, import authorization, runtime verification, and runtime authentication. These boundaries join the complete WO-22 tenant-isolation suite.
