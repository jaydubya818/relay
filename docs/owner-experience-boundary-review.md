# Owner experience: source inventory and authority decision

Date: October 8, 2026 (America/Los_Angeles)

Status: Option A accepted by the owner. Implementation in progress; this is not release approval.

Accepted decision: preserve all canonical OWNER authority, APIs, roles, grants and direct-route behavior. Advanced is progressive disclosure only. No new entitlement. Unauthorized-principal tests cover existing canonical denials, not artificial OWNER denials.

## Source and isolation

- Canonical repository fetched: `https://github.com/jaydubya818/relay.git`.
- Remote default branch: `main`.
- Resolved source: `a90625776193031ca2303ba2e2162249d1245479`.
- Isolated branch: `codex/relay-owner-experience`.
- New source clone: `../relay-owner-experience-source`; new worktree: `../relay-owner-experience`.
- Existing checkouts were not modified. The inspected older field-audit checkout has a stale worktree pointer and was not repaired or used as authoritative source.
- No hosted environment, release branch, tester, identity, credential, grant, FactoryVersion, MyEve, or MyFactory changes.

## Confirmed canonical model

`lib/types.ts` and `lib/db/schema.ts` define dashboard user roles OWNER and MEMBER. V2 account memberships define OWNER, ADMIN, OPERATOR, APPROVER, MEMBER, AUDITOR. There is no DEVELOPER role.

`docs/v2/identity.md` explicitly gives OWNER account, membership, Agent, policy, approval, operation, and audit administration. ADMIN and OPERATOR also have specified administrative permissions. They are not interchangeable with a display-mode choice.

`lib/v2/dashboard.ts:operatorContext` resolves an active principal and active account membership; its name alone does not imply an OPERATOR-only check. Individual V2 operations use role checks separately.

`lib/api.ts:requireApiUser` checks dashboard authentication, not membership privileges. For example, `app/api/agents/route.ts:POST` calls it and creates an Agent after origin/input validation. `app/api/v2/operator/factory/route.ts:POST` explicitly permits dashboard OWNER. Making ordinary OWNER fail this request would change current authorization.

`lib/capabilities.ts` filters enabled catalog entries. `lib/v2/deployment.ts` gates V2 runtime actions by deployment mode and an explicit flag. These are different contracts; neither should be silently treated as a universal release-feature or human-role entitlement. The frozen deployment's exact configuration and deployed SHA have not been inspected or inferred from source HEAD.

## Existing UI inventory

- Owner candidates: `/`, `/agents`, `/agents/[id]`, `/connections`, `/activity`, `/settings`.
- Advanced candidates: `/developer` (MCP), `/factory`, `/events`, `/sandboxes`, `/browsers`, and the separate `/v2` administration surfaces.
- `/memory` needs a confirmed release-policy gate; this redesign must not activate it.
- Shared dashboard layout: `app/(dashboard)/layout.tsx`; navigation: `components/sidebar.tsx`.
- Home currently probes providers and shows infrastructure status; remove those probes from owner Home and retain diagnostics in an authorized System Health surface.
- Agents currently exposes creation, grants, and credential controls. Installation-managed alpha owners should receive setup guidance and read-only trust summaries in the default experience.
- Activity currently renders technical columns. Use deterministic labels derived from recorded actions/statuses, retain audit data, and expose technical details only within permitted advanced presentation.
- Connections currently offers GitHub/Google configuration without a release visibility abstraction. Missing OAuth credentials do not prove a release policy disables a provider.

## Resolved authority decision (Option A accepted)

The mission simultaneously requires unchanged authority and denial when an ordinary OWNER directly accesses advanced routes/APIs. Existing OWNER authority permits administrative operations. Navigation hiding cannot reconcile these requirements.

### A — Preserve canonical authority (recommended)

Default to the five owner navigation items. Provide an explicit advanced presentation for users already authorized by canonical membership and operation checks. Developer is a presentation mode, not a new role. Test denials for genuinely unauthorized principals; do not assert that all OWNER users are unauthorized for operations the backend permits.

Benefit: preserves identity, grants, and existing authorization contracts. Tradeoff: an authorized OWNER can still reach advanced operations; the requested blanket OWNER direct-access-denial journey must be adjusted.

### B — Introduce a separately reviewed restriction

Define an explicit server-enforced entitlement/release policy that distinguishes ordinary owners from authorized advanced users, and apply it consistently to routes and relevant APIs while retaining existing underlying checks. Specify who can assign it before implementation. Do not infer it from email, browser state, or role names.

Benefit: can satisfy ordinary-owner direct-access denial. Tradeoff: changes authorization semantics and requires additional compatibility/security qualification; it cannot be described as a UX-only change.

## Qualification and release gates

After resolving the decision, implement and qualify using dedicated synthetic accounts and local resources: component/route/policy tests, owner and empty-owner golden journeys, advanced role journeys, desktop/intermediate/390px, keyboard and automated accessibility, visual baselines, security regressions, fresh-clone runs, hosted CI, and independent review.

This inventory predates implementation. See `owner-experience-checkpoint-a.md` for current qualification evidence. Independent release review and explicit deployment approval remain gates.

Prepare the final impact report against the separately verified frozen release SHA, including changed routes, contracts, authorization semantics, migrations, tester impact, deployment plan, rollback, and browser evidence. Separate the full redesign from a minimal alpha hardening subset. Keep alpha frozen pending qualification and explicit deployment authorization even if the impact review succeeds.

Production deployments: 0. External-alpha changes: 0. Tester/credential mutations: 0. Paid model operations: 0.
