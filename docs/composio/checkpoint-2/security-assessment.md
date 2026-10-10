# Checkpoint 2 security assessment

Scope: additive Composio persistence, catalog/server action, authenticated gateway, qualification migration and synthetic fixtures. This is the implementation agent's security-sentinel assessment, **not an independent review**. Independent review remains a distinct required gate.

## Trust boundaries checked

- The browser may submit only a connection ID for local revocation. The action checks the preview flag, strict configured origin, authenticated dashboard session, active HUMAN OWNER membership, and exact server-resolved owner/account/agent/installation. It requires the existing canonical evidence signer. No provider client is constructed in this path.
- Agent discovery and read requests use existing Relay credential authentication, account/agent equality, canonical owner membership and active agent checks. Revoked/expired credentials and retired accounts deny. Two valid owners in the same account cannot read or revoke each other's provider bindings.
- The policy-source interface is server-only and absent by default. A synthetic restriction projection can attenuate discovery but never authorizes dispatch. There is no provider execute call or positive admission callback in the gateway. No public Sofie HTTP endpoint is introduced.
- Provider status must resolve the exact opaque user/auth-config/toolkit/connected-account identity before persistence. Strict binding parsing rejects credential-shaped extra fields. Only provider references, scopes and lifecycle metadata are stored; raw provider responses and credentials are excluded.
- Account fencing, owner/agent row locks, namespaced durable idempotency keys, uniqueness constraints and canonical signed evidence are used for lifecycle mutations. Failed audit signing rolls back persistence. Local revocation commits before provider reconciliation, increments authorityVersion, remains revoked on timeout, and cannot be undone by replayed setup. Disabled agents do not prevent an active owner from revoking locally.
- SDK timeout/rate-limit normalization, unknown outcomes, schema/tool substitution, result projection, malicious descriptions, webhook signature/timestamp checks, durable event replay/conflict detection and event rate limiting are tested. Event ingestion has no public route and cannot reconnect or grant authority.
- SQL uses parameterized Drizzle queries. `sql.raw` appears only for checked-in static qualification SQL inside disposable test setup. React escapes displayed text; no raw HTML injection is used. Browser checks include accessible responsive layouts and explicit setup/admission disclosures.

## Findings and resolution

1. Empty connection selector could omit the connection predicate in the new internal persistence helper. Fixed by making the selector required, validating nonempty length, and always including exact ID equality. Regression test verifies empty read/revoke cannot affect the existing connection. The owner action already validated this input, but the internal helper is now safe independently.
2. Browser qualification found full binding metadata passed where a strict four-field scope was required. Fixed by explicitly projecting the scope from server-resolved records. Browser revoke/refresh now passes.
3. Local revocation initially required an ACTIVE agent. Changed management-only checks to permit revocation for disabled agents while retaining active account and owner membership requirements; discovery still requires ACTIVE.

## Dependency advisories — unresolved baseline risk

`pnpm audit --prod --json` reports 0 critical, 2 high and 2 moderate advisories. `package.json` and `pnpm-lock.yaml` are unchanged from accepted checkpoint 6913367. These are baseline dependency findings, not a new SDK upgrade. No dependency was automatically upgraded or merged.

- High: source-map-js indexed section-offset denial of service — https://github.com/advisories/GHSA-68fv-2mgg-jv7q
- High: sharp / librsvg CVE-2026-96889 — https://github.com/advisories/GHSA-wq5f-xc86-pv6w
- Moderate: Next.js self-hosted SSG/ISR cache poisoning — https://github.com/advisories/GHSA-4jqv-mc3x-m676
- Moderate: Next.js SSG/ISR cross-user content substitution/denial of service — https://github.com/advisories/GHSA-mcj8-r9mp-w47p

Exposure-specific remediation needs the baseline dependency owner; this assessment does not declare them safe or production-qualified. The new authenticated catalog is dynamic and does not add image processing, but that alone does not resolve application-wide advisories.

## Explicit qualification limits

No authenticated positive remote admission, online V2 runtime lease integration, production migration, live OAuth/custody, production webhooks, live provider schemas/scopes, or production deployment is qualified here. The only deterministic tool manifest is the synthetic GitHub assigned-issues fixture; Gmail, Calendar and Slack catalog entries do not imply live action qualification. The new additive SQL is applied only to isolated synthetic databases. A rollout must reconcile this metadata extension with canonical migration ownership without altering frozen compatibility groups in this checkpoint.
