# WO-21 dashboard qualification

Status: `PASSED_LOCAL`; human comprehension study pending

## Implemented surface

The additive `/v2` dashboard contains Command, Tasks, Approval Center, Agents and Passports, Computers, Connections, Policies and Budgets, Runners and Providers, Activity, and Settings. It uses only account-scoped projections and intentionally excludes credential handles, hashes, runner public keys, and webhook-secret references.

Operational states include empty, pending, paused, stale/unknown budget, effect unknown, dead letter, reconciliation required, provider/runner unavailable, protected credential entry, error, and success. Destructive task and runner controls use two-stage confirmation. Approval decisions show actor, task/destination, consequence, scope, and immutable evidence, then require action-bound password step-up.

## Automated and visual evidence

- Typecheck and lint passed.
- Focused dashboard projection/isolation suite passed (2/2).
- Production Next.js build passed with all ten dashboard and four operator routes present.
- Playwright inspected semantic snapshots at 1440×1000 and 390×844.
- Local axe-core 4.13.0 audit using WCAG 2 A/AA, WCAG 2.1 A/AA, and WCAG 2.2 AA tags returned zero violations on all ten V2 routes.
- Keyboard review confirmed the first tab target is `Skip to content`; each route exposes exactly one programmatic `aria-current="page"` navigation item.
- Browser console review across all routes returned zero errors and zero warnings, excluding development informational logs.
- Desktop Command screenshot: `output/playwright/wo21-command-desktop.png`.
- Mobile Approval Center screenshot: `output/playwright/wo21-approvals-mobile.png`.

## Focused tenant boundary

The new dashboard read model scopes every query by account and resolves the operator through an active same-account user/principal/membership join. A wrong-account user cannot obtain operator context. Tests prove another account receives none of the seeded Agent, runtime, or audit data. Mutation routes derive account and principal only from the authenticated session, reject cross-origin requests, and delegate authorization to the existing account-scoped domain services.

## Honest remaining qualification

Automated axe results do not prove complete WCAG conformance. Screen-reader/platform combinations and the Product Owner's multi-participant comprehension study—identifying actor, destination, consequence, and scope—remain external WO-21/WO-22 evidence. Controls that require unavailable deployment cryptographic bindings fail closed. Production resume is not exposed without fresh policy and integrity checks.
