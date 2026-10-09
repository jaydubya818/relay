# RELAY OWNER EXPERIENCE — CHECKPOINT A

Source baseline: `a90625776193031ca2303ba2e2162249d1245479` from freshly fetched `jaydubya818/relay` main.

Branch: `codex/relay-owner-experience`.

Architecture: **Option A — preserve canonical OWNER authority**, accepted explicitly by the owner. Advanced is progressive disclosure, not an entitlement or authority reduction.

## Implemented behavior

- Primary navigation: Home, Agents, Connections, Activity, Settings, with a separate Advanced / Developer tools entry.
- Home: recorded Agents, existing service connections, recent activity and actionable connection errors. No automatic infrastructure probes or arbitrary Agent-creation prompts.
- Agents: understandable status, purpose, last activity, grant summaries and direct access to activity. Missing, denied and allowed grants remain distinct; allowed does not promise provider readiness or policy approval.
- Activity: responsive timeline with deterministic action/outcome labels and expandable original technical fields. The audit ledger is unchanged.
- Connections: existing account records and correctly labelled configured MyFactory routing. No missing-service setup invitations in the primary experience. OAuth and manual setup remain in Advanced; manual tokens require deliberate disclosure.
- Advanced: preserved MCP, Events, MyFactory direct dispatch, Sandboxes, Browsers, Memory, Agent administration, connection setup and V2 entry points. System Health separates measured health, configured, disabled and not-checked states.
- Responsive navigation, labelled filters, focus/skip navigation, loading, retry/error, unfiltered-empty and filtered-empty states.

## Qualification record

The source commit containing this report is the candidate. Hosted checks attach to the published branch HEAD; fresh-clone evidence is recorded after the first commit. This document is not deployment approval.

| Check | Result |
| --- | --- |
| Owner navigation | PASS in synthetic browser journeys |
| Role-aware presentation | PASS; OWNER default and MEMBER/OPERATOR fixtures, no invented role |
| Feature visibility | PASS within Option A: optional infrastructure absent from primary navigation, persisted connections only, disabled V2 actions neutral |
| Owner Home / Agents / Activity / Connections | PASS in populated and empty synthetic owner journeys |
| Developer surfaces preserved | PASS: three legacy browser journeys, including manual credential creation and Telegram management |
| Route authorization | PASS for existing authentication, cross-account isolation and OWNER-only Factory denials |
| Desktop / 768px / 390px | PASS for owner golden journeys |
| Accessibility | PASS: owner and Advanced surfaces at desktop/390px; owner also at 768px; zero critical/serious axe findings and keyboard checks |
| Visual regression | PASS: nine macOS Chromium baselines, compared without updates |
| Security regressions | 477 tests passed; six live-provider tests intentionally skipped |
| TypeScript / lint / production build | PASS locally; final fresh-clone check pending |
| Schema / frozen V2 frontier | PASS; both performance regression tests pass |
| Fresh clone | Pending |
| Hosted CI | Pending push |
| Independent review | Pending; author review is documented separately |

Local qualification uses disposable loopback PostgreSQL and synthetic personas only. Six skipped tests require live Docker/browser/provider/MyEve integration and are not claimed as qualified. CI runs viewport, accessibility, journey and authorization checks on Linux; committed macOS visual baselines are compared locally, not across operating-system fonts.

## Change-impact review and release boundary

Changed owner routes: `/`, `/agents`, `/agents/[id]`, `/activity`, `/connections`, `/settings`. New routes: `/advanced`, `/advanced/agents`, `/advanced/connections`, `/advanced/health`, `/agents/[id]/advanced`. Existing `/memory`, `/events`, `/browsers`, `/sandboxes` retain behavior with clearer empty states and labelled Memory filters.

Shared changes: sidebar/layout, timeline and empty-state components, status presentation, focus/responsive CSS, manual connection disclosure, route metadata and loading/error boundaries. Supporting files add a pinned accessibility test dependency, deterministic fixtures, browser tests/baselines, JSX test transformation, CI and branch-specific automatic-deployment suppression. This breadth is necessary to qualify the full owner journey and preserve its advanced paths; it does not include backend refactoring.

Backend contracts: **unchanged**. Authorization model: **unchanged**. Database schema/migrations: **none**. Identity, invitation, credential, grant and FactoryVersion semantics: **unchanged**. No MyEve/MyFactory source changes.

The frozen external-alpha deployed SHA/configuration has not been read or changed. Source-main qualification alone cannot establish compatibility with that exact release. Real Tester 1/Tester 2 records were not accessed. Their new-owner state is represented by an empty synthetic account, not copied private data.

**Recommendation: A — keep external alpha on its frozen Relay release through first E2E.** No operational need justifies replacing the frozen release before the remaining independent and exact-release comparison gates.

The smallest candidate alpha hardening subset is labelled primary navigation with an explicit Advanced entry, removal of provider probes from Home, and installation-aware empty states. Extract and independently qualify that subset against the exact frozen SHA; do not assume the complete redesign is automatically a safe cherry-pick.

Full redesign and minimal subset both require: independent review, exact frozen-SHA diff, release configuration comparison, verified policy/provider display states, synthetic replay matching enrollment, existing API/security suites, desktop/mobile evidence, hosted CI, and explicit owner authorization to deploy.

Deployment plan after authorization: pin the approved commit and existing environment/identity bindings; deploy only Relay via the established release procedure; verify health/login/owner journeys, direct advanced access and role denials before directing testers to it. No migrations, reprovisioning or credential rotations are part of this change.

Rollback: restore the previously recorded immutable Relay deployment with its environment unchanged. Since this candidate introduces no schema or authority mutation, UI rollback needs no data migration. Record the actual old deployment ID before any future release action.

Production deployment: **0**. External-alpha changes: **0**. Real tester mutations: **0**. Real credential mutations: **0**. Paid model operations: **0**.
