---
title: Relay V2 Implementation Ledger
status: active
base_commit: 43e0160eb2b9552f71154d18369e4626e0e79339
base_tag: relay-v1.0.0-rc.1
branch: feat/relay-v2
specification: /Users/jaywest/Documents/ChatGPT/New project/docs/specs/relay-v2-product-architecture-spec.md
workorders: /Users/jaywest/Documents/ChatGPT/New project/docs/plans/2026-09-13-feat-relay-v2-foundation-workorders-plan.md
---

# Relay V2 Implementation Ledger

Relay V2 is developed from the immutable V1 RC1 tag on a dedicated branch. This ledger does not authorize changes to V1 branches, tags, soak evidence, or release history.

## Status

| WorkOrder | Title | Dependencies | State | Commit | Qualification | Blockers / deviations |
|---|---|---|---|---|---|---|
| WO-00 | Establish V2 isolation and governance | — | QUALIFIED | pending commit | LOCAL PASS | Remote branch/deploy protection: BLOCKED_EXTERNAL_CONFIGURATION |
| WO-01 | Freeze vocabulary, schemas, and state machines | WO-00 | NOT_STARTED | — | — | — |
| WO-02 | Complete security architecture and abuse cases | WO-01 | NOT_STARTED | — | — | — |
| WO-03 | Build tenancy, principals, and account roles | WO-01, WO-02 | NOT_STARTED | — | — | — |
| WO-04 | Build evidence and append-only audit substrate | WO-01, WO-02, WO-03 | NOT_STARTED | — | — | — |
| WO-05 | Build Agent Passport and runtime attribution | WO-03, WO-04 | NOT_STARTED | — | — | — |
| WO-06 | Build capability registry and policy decision service | WO-02–WO-05 | NOT_STARTED | — | — | — |
| WO-07 | Build centralized approval service | WO-03, WO-04, WO-06 | NOT_STARTED | — | — | — |
| WO-08 | Build capability leases and workload identity | WO-05–WO-07 | NOT_STARTED | — | — | — |
| WO-09 | Build multi-dimensional budget engine | WO-04, WO-06, WO-08 | NOT_STARTED | — | — | — |
| WO-10 | Build durable event router and task orchestrator | WO-03, WO-04 | NOT_STARTED | — | — | — |
| WO-11 | Build execution provider SDK and scheduler | WO-06, WO-08–WO-10 | NOT_STARTED | — | — | — |
| WO-12 | Qualify Relay-managed Playwright execution | WO-11 | NOT_STARTED | — | — | — |
| WO-13 | Qualify Browserbase and E2B adapters | WO-11 | NOT_STARTED | — | — | — |
| WO-14 | Build customer runner and outbound private gateway | WO-08, WO-10, WO-11 | NOT_STARTED | — | — | — |
| WO-15 | Build live observation and human control | WO-07, WO-08, WO-12, WO-13 | NOT_STARTED | — | — | — |
| WO-16 | Qualify Slack and Telegram communications | WO-07, WO-10 | NOT_STARTED | — | — | — |
| WO-17 | Qualify Google Drive and Linear connectors | WO-06, WO-08, WO-10 | NOT_STARTED | — | — | — |
| WO-18 | Build financial domain and controlled purchase intents | WO-07, WO-09, WO-15 | NOT_STARTED | — | — | — |
| WO-19 | Build same-account Agent delegation | WO-04, WO-05, WO-08–WO-10 | NOT_STARTED | — | — | — |
| WO-20 | Publish REST, events, MCP, and client SDKs | WO-05–WO-10, WO-19 | NOT_STARTED | — | — | — |
| WO-21 | Build operator and user dashboard | WO-04, WO-07, WO-10, WO-15–WO-18 | NOT_STARTED | — | — | — |
| WO-22 | Qualify V2 for limited beta and GA | WO-12–WO-21 | NOT_STARTED | — | — | — |

## Work log

### 2026-09-13 — Implementation frontier

- Read the approved V2 specification, WorkOrder plan, brainstorm, and execution brief.
- Determined the V2 base as immutable tag `relay-v1.0.0-rc.1` at `43e0160eb2b9552f71154d18369e4626e0e79339`.
- Rejected `codex/relay-v1-rc-soak` HEAD as a base because it contains ongoing post-tag soak work and its latest evidence still recommends continued soak.
- Created dedicated branch `feat/relay-v2` from the immutable base.
- Added ADR-016 and `pnpm v2:frontier:check` to enforce immutable tag, ancestry, branch, and protected-ref invariants.
- Qualification passed: frontier check, typecheck, lint, and unit tests (4/4).
- Live verification of GitHub branch protections and V2-only deployment credentials is `BLOCKED_EXTERNAL_CONFIGURATION`; no administrative mutation was attempted.
