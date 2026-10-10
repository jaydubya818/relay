# Checkpoint B — owner product review

## Source and boundaries

Branch: `codex/relay-owner-checkpoint-b`. Starts at `67a8ed6`, the accepted
`25def56` baseline plus the independently rechecked connection corrections.
PR #34 and all historical evidence remain intact. The baseline preview on 3239
and its database remain running and unchanged. A separate local database copy
and port will serve this candidate. No backend authorization, authentication,
schema, credential contract, API, or execution admission changes are planned.

## Product decisions

- Refined operations workspace: compact navigation, warm light / graphite dark
  themes, actionable status strip, searchable records, bounded timelines.
- Every metric has a named source and time window. V2 reads use the existing
  operator membership guard. Missing membership is unavailable, never zero.
- Capability policy integration is an inactive preview until MyEve preference
  and Unified Control Plane contracts exist. No platform-owner identity is
  inferred from an account OWNER role; no preferences or grants are auto-enabled.
- Existing read/write APIs retain their authentication and scopes. No chat,
  orchestration engine, duplicate capability registry, or new entitlement.
- Agent retirement is represented by the existing reversible disable action.
  Permanent retirement and profile editing are not invented without backend support.

## Checkpoint ledger

| Checkpoint | Status |
| --- | --- |
| B1 Design system/navigation | Implemented; light/dark themes and five responsive widths |
| B2 Home | Implemented; scoped counts and precise drill-down windows |
| B3 Agents | Implemented; directory, tabs, bounded creation, grants, disable |
| B4 Connections | Implemented; scopes, grant mapping, refresh-aware auth, management |
| B5 Activity | Implemented; search, filters, date windows, pagination, disclosure |
| B6 Settings/capability preview | Implemented; canonical integration explicitly inactive |
| B7 Advanced tools | Implemented; grouped tools and honest availability states |
| B8 Local product review | Candidate available; owner acceptance pending |
| B9 Qualification | Technical checks in progress; release sign-off pending B8 review |

## Administration parity

| Owner interaction | Existing authenticated contract |
| --- | --- |
| Inspect Agents / grants | GET /api/agents and /api/agents/:id |
| Create Agent with explicit bounded grants | POST /api/agents |
| Enable / disable Agent | PATCH /api/agents/:id |
| Change an Agent grant | PUT /api/agents/:id/capabilities/:capability |
| Inspect / manage connections | /api/connections/github and /api/connections/google |
| Inspect activity / denied operations | GET /api/activity with existing filters |
| Agent capability discovery | Existing scoped capabilities.search MCP capability |

Dashboard administration uses authenticated human sessions. A scoped Agent
credential does not gain administrative authority from this UI. Sofie delegated
administration and cross-system preference integration remain dependencies.
Search/date pagination is a presentation read; the existing activity API remains
unchanged and retains its current bounded result contract.

## Verification and limitations

- Regression: 481 passed, six live-integration checks skipped. Existing
  performance suites: two passed. Type checking and lint passed.
- Browser coverage includes 1440, 1024, 768, 390 and 320px in both themes,
  30 distinct new visual snapshots, axe scans and keyboard navigation.
  Historical Checkpoint A snapshots are retained unchanged. Failed preliminary
  capture attempts are not used as passing evidence.
- A separate `.next-owner-tests` output directory prevents browser tests from
  sharing build state with the running local preview. Test motion is reduced
  for stable contrast/visual measurements; reduced-motion support is built in.
- One independent reviewer found two P2 display issues (refreshable OAuth state
  and a mismatched metric time window) and one P3 error-recovery issue. All were
  corrected and independently rechecked. No critical/high source finding was
  identified. Exact-commit review and hosted/fresh-clone evidence are reported
  separately; this document is not final B9 release approval.
- All 27 frozen-release groups are checked by `scripts/verify-owner-contracts.ts`.
  No API, authorization, schema, authentication, credential, invitation or MyEve
  contract changes. No deployed installation or real account was inspected.
- Current Activity records do not store detailed failure causes. The UI says so
  instead of reconstructing a cause from today's grants or displaying arbitrary
  metadata as trusted evidence.
- Notifications, account profile edits, permanent Agent retirement and unified
  preference controls are not invented without backend support. Existing Agent
  disable, grant, connection and beta-invitation controls remain available.
- No screen-reader session or live provider/paid execution is claimed.

## Preview

Baseline: `http://127.0.0.1:3239` remains untouched. Candidate:
`http://127.0.0.1:3240`, loopback only, separate synthetic database.
Login: `owner@relay-demo.local` / `RelayDemo-Only2026!` (local demo only).
Sample connection records have no provider credentials. Requires setup is
therefore expected. No real tester, provider credential or Agent is mutated.

The next decision is owner acceptance of B8 product design. B9 release sign-off,
adoption, merge and deployment are not implied by this preview.
