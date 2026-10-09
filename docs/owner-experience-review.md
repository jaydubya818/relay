# Owner experience review

Architecture decision: Option A, explicitly accepted by the owner on October 8, 2026. Progressive disclosure must preserve canonical OWNER authority. Developer is a presentation area, not a new role or entitlement.

## Scope and authority review

The implementation changes dashboard pages, shared presentation, local synthetic tests, test dependencies/configuration, documentation, and branch-specific CI/deployment suppression. Existing administration pages are retained under explicit Advanced entry points. No API handler, authentication, authorization, grant service, V2 policy service, database schema, migration, credential service, provisioning flow, or external-alpha source ref is changed.

Existing direct routes such as `/developer`, `/factory`, `/events`, `/sandboxes`, `/browsers`, `/memory`, and `/v2` remain. Agent management moves from `/agents/[id]` to `/agents/[id]/advanced`; manual creation moves to `/advanced/agents`; connection setup moves to `/advanced/connections`. Their existing APIs remain unchanged. Existing links to an Agent still resolve to that Agent’s owner summary.

New Advanced pages require the same dashboard authentication as the surfaces they reorganize. V2 membership and individual API role checks remain authoritative. An Advanced link never implies successful authorization. The synthetic MEMBER and OPERATOR journeys verify that OWNER-only Factory APIs still deny them, and a foreign-account Agent remains inaccessible. Do not claim that existing backend restrictions are stronger than their actual implementation.

## Agent-native architecture review

This is an implementation-author review using the agent-native-reviewer checklist, not an independent review.

| UI operation | Canonical state / contract | Assessment |
| --- | --- | --- |
| Inspect Agents | `listAgents`, `/api/agents` | Same account-scoped registered identities; no invented specialist records |
| Inspect permissions | `getAgent` grants; existing capability authorization and MCP discovery | Friendly labels retain exact grant semantics; no new Agent authority |
| Inspect Activity | `listActivity`, `/api/activity` | Original action, outcome, session and audit reference retained; no generated narrative |
| Inspect service connections | `listConnections` | Recorded connections only; absent OAuth configuration is not treated as a failed connection or a release policy |
| Inspect MyFactory routing | Existing account binding and token-presence condition | Says Configured, not Connected or Ready; no provider call or Work creation |
| Enter Advanced | Existing routes and administrative APIs | Presentation only; existing server authorization applies |
| Check providers | Existing provider health methods and `/api/health/providers` | Explicit diagnostics, no automatic provider launch from owner Home |

Administrative read APIs use dashboard authority; Agent MCP tools still require Agent credentials and grants. This work intentionally does not give Agents human administrative privileges to manufacture parity. Broader Agent-readable account context is outside this UX-only change.

## Findings resolved

- Default Home performed infrastructure probes, including browser launch: removed from owner Home and made explicit in System Health.
- Navigation vanished on narrow screens: replaced with labelled, wrapping navigation and an accessible Advanced entry.
- Raw credentials and creation dominated owner Agents: retained behind explicit advanced pages and disclosure.
- Activity was a wide table: now a responsive deterministic timeline; denied attempts never appear as completed work.
- Disabled configuration looked failed: neutral status for disabled/not-configured/not-checked states, with probe uncertainty stated explicitly.
- Memory filters lacked associated labels: associated labels added and qualified on desktop/390px.
- Existing Not connected badges failed AA contrast: foreground darkened and the full advanced sweep passed.
- New component tests needed automatic JSX transformation: Vitest configuration now matches the JSX runtime used by Next.

## Remaining qualification boundaries

- Independent reviewer sign-off has not been obtained. Do not treat this author review as independent approval.
- Real-provider tests are not enabled by this redesign; no real tester, credential or provider data is required for fixtures.
- There is no newly invented global release-policy entitlement. Optional services are absent from primary navigation; owner Connections shows persisted connections, not setup offers. Existing advanced APIs retain their original behavior.
- Verified application/Agent connection data is not inferred from names, runtime labels or token presence. Missing canonical linkage is not replaced with a fabricated Connected badge.
