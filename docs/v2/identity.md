# Relay V2 identity and tenancy

WorkOrder: WO-03

V2 adds principals and account memberships without destructively rewriting V1 users. A human has one principal and may eventually have multiple account memberships. A service client has a service principal, one-time credential, explicit membership role, expiry, revocation, and last-use state.

## Baseline roles

- `OWNER`: account, membership, Agent, policy, approval, operation, and audit administration.
- `ADMIN`: membership, Agent, policy, approval, operation, and audit administration.
- `OPERATOR`: Agent and operation management, approval decisions, and audit access.
- `APPROVER`: approval decisions and supporting audit access.
- `MEMBER`: use assigned Agents and read ordinary activity.
- `AUDITOR`: read audit/evidence only.

Roles authorize administrative surfaces. They do not grant an Agent a capability or replace policy evaluation.

## Authentication flows

The V2 identity contract accepts authenticated subject plus assurance context from these server-side adapters:

1. Password session (implemented compatibility path): verify password hash, create opaque hashed server session, resolve active principal/membership.
2. OIDC authorization code with PKCE: verify issuer, audience, nonce, code verifier, exact redirect URI, and required `acr`/`amr`; bind the provider subject to one Relay human principal.
3. WebAuthn: verify origin, RP ID, challenge, user-presence/verification flags, signature, and monotonically increasing credential state where available.
4. Confidential service client: verify one-time-displayed hashed credential, expiry/revocation, active service principal, and active account membership.

OIDC and WebAuthn adapters are not considered implemented until their provider-specific negative tests pass. A caller-provided method name or assurance claim is never accepted as authentication evidence.

## Step-up

Step-up begins with a random, hashed, short-lived challenge bound to account, principal, action class, and optional canonical action hash. Completion occurs only inside a trusted authenticator adapter. The implemented password adapter verifies the user's stored password before atomically consuming the challenge. Wrong account, principal, action, hash, password, expiry, or replay fails.

Runner enrollment, policy weakening, sensitive connection changes, financial approvals above policy thresholds, and break-glass operations require step-up. A step-up result cannot be reused for another account or action.

## Suspension

Suspending a principal also suspends the selected membership and revokes that human's active dashboard sessions. Later WorkOrders consume the same event to revoke leases, approvals, runner enrollment authority, and workflow access.

