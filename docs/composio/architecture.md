# Relay Composio integration — isolated adapter checkpoint

This is a partial implementation checkpoint, not a qualified gateway or production integration.
Branch: `codex/relay-composio-integration`. Parent: `403411394fe5641b95d1a53db7f231147ec850f9`.
No route, provider startup, environment credential lookup, database migration, grant,
owner preference mutation, OAuth connection, webhook registration, or deployment is installed.

## Canonical ownership and the blocking dependency

Relay's existing `lib/v2/connectors.ts`, `leases.ts`, `approvals.ts`,
`policy/service.ts`, `developer-platform.ts`, and `evidence/` remain canonical.
The new `lib/integrations` provider port is internal; its TypeScript scope and
qualification arguments are trusted server inputs, **not authenticated grants**.
Nothing exposes it to browser or Agent callers. The adapter alone must never be
connected directly to an API route, model tool, MCP server, or MyEve tool handler.

MyEve `e93a4ce6e81494a43fdfe98447de1c42337d191b` explicitly refuses remote
admission in `packages/capability-enforcement/src/decisions.ts`:
`requireQualifiedRemoteAdmission` rejects with `CROSS_DATABASE_ORDERING_UNQUALIFIED`.
Its `docs/capability-control/CROSS-SYSTEM.md` explains that signed evidence has
`admissionEligible: false`; read-then-commit does not serialize owner disable with
remote admission. Only co-located PostgreSQL admission is currently qualified.
`ENFORCEMENT.md` also marks the live Relay restriction projection unqualified.

The user was asked whether to retain this gate or expand scope to qualify a
cross-database protocol. Pending that decision, `requireLiveComposioAdmission`
always denies. A new independent authorization service, cached boolean, copied
owner registry, or inferred platform-owner identity is not an acceptable fix.

## Implemented provider port

`ComposioProviderAdapter` uses SDK 0.22.0 types and methods:

| Requirement | Implementation | Limitation |
| --- | --- | --- |
| SDK initialization | Explicit project key; user/org fallbacks off; telemetry, logs, update checks and automatic files off | No runtime key configured |
| Toolkit/auth discovery | `toolkits.getMany` restricted to GitHub, Gmail, Google Calendar and Slack | Catalog presence confers no qualification |
| Action/schema retrieval | `tools.getRawComposioToolBySlug` with exact dated version and schema digest | No live tool/schema qualification manifest supplied |
| Bounded discovery | Maximum ten server-reviewed tools; reviewed descriptions | Caller must apply current policy filtering before invoking this internal port |
| Connection discovery | `connectedAccounts.list` filtered to exact opaque user, auth config, toolkit and PRIVATE account type | Bounded first page; absence fails closed; no shared accounts |
| Connection initiation | `authConfigs.get` verifies toolkit, then `connectedAccounts.link` with fixed callback origin | Canonical one-time Relay state and durable owner consent must be provided by the future gateway |
| Execution | `tools.execute` with exact account, opaque user, version, strict arguments, tracing off | READ qualification only; no production qualification entries |
| Errors/timeouts | Safe error codes; abort and deadline; rate-limit delay hint; no automatic retry | UNKNOWN requires reconciliation; no lifecycle replay ledger yet |
| Revocation | Scoped account resolution then `connectedAccounts.revoke` | Gateway must fence canonical access first; unsupported or ambiguous revocation remains PENDING |
| Evidence | Argument, schema, result and scope digests; connection and authority version; duration | Canonical audit/Result/Proof persistence remains unwired |

The public underlying client retry count is set to zero, including lifecycle
operations. SDK 0.22.0 independently disables automatic execution retries.
The underlying API's delete operation defaults `revoke_on_delete` to false;
deletion is not proof of upstream revocation. The adapter uses the SDK's explicit
upstream revoke operation and checks its exact connection ID and REVOKED status.
Unsupported toolkit revocation remains pending; no automatic delete fallback.
The actual installed SDK is exercised with a denied-by-default fixture `fetch`;
these are wire-contract tests, not tests against Composio's service.

Connection responses may contain `state`, `data`, `params` and diagnostic strings
with secrets. Only account identity, status and disabled state leave this port.
Tool results require a reviewed projector and use the existing Relay evidence
redactor. They are marked `UNTRUSTED_EXTERNAL_DATA`. Schema and content text
remain untrusted input; no claim that redaction solves prompt injection is made.
No raw exception, provider response object or credential field is logged.

The adapter checks the schema digest before SDK execution, then pins the same
version on dispatch. The SDK internally fetches that version again. Its public
before-execute callback exposes request identity, not the second schema itself.
Production qualification must establish provider version immutability or use a
reviewed transport contract that binds the final fetched schema. This checkpoint
does not claim atomic protection against a provider changing a pinned schema.

## Credential custody comparison

| Mode | Supported surface | Custody implication |
| --- | --- | --- |
| Composio managed | Hosted Connect Link and managed OAuth app | Composio holds and refreshes external credentials. Requires separate production custody approval. |
| Relay managed | Existing native Relay GitHub/Google connectors | Relay retains its existing credential store and lifecycle. These are unchanged. |
| Custom OAuth app through Composio | Custom auth config with the owner's developer OAuth app | Choosing a custom client ID does **not** establish Relay-exclusive token custody. Composio still handles the connection. |
| Per-call custom authentication | SDK exposes `customAuthParams` and deprecated `customConnectionData` | Credentials would be sent to Composio. Not implemented, not equivalent to local-only custody. |
| Hybrid deployment | Native connections retain Relay custody; separately approved Composio connections record COMPOSIO custody | Feasible per connection, not a blanket promise of interchangeable token custody. |

Do not import existing Relay OAuth tokens into Composio. Do not enable provider
refresh APIs for Agents. Approval must identify environment, project, exact
identity binding, apps, auth configs/scopes, retention, revocation semantics,
cost ceilings and release artifact before any new production custody begins.

## Required integration design after admission is resolved

Extend existing canonical connector definitions/connections and their lifecycle;
do not add an independent connection database. The current schemas use bounded
provider enums and account/provider uniqueness. A reviewed additive metadata and
Agent-access extension is needed for provider/toolkit, installation, owner,
connected account, custody, expiry, permissions and exact authorization version.
No migration is fabricated in this checkpoint.

`consumer.ts` prepares a strict read-request contract using the existing Relay
ActionIntent and canonical hashing. Connection, scope, tool/schema, effects,
target, revisions, expiry and idempotency identity are included in its resource
material. Changed fields invalidate that binding. This parser does not authenticate
or authorize a request, consume a lease, or perform durable deduplication.

The authenticated gateway must compose current runtime authentication, exact
Agent/Passport authority, owner/organization capability policy, qualified harness,
canonical action intent, online lease consumption, connection state and a durable
execution claim. Scope must bind tenant/account, owner, installation, Agent,
connection, toolkit, action/version/schema, arguments, target, effect, authority
revisions, expiry and idempotency identity. Do not accept these identities from
unverified request bodies. Parent delegation must narrow canonical parent authority.

Claim idempotency before dispatch; mismatched same-key requests conflict. A crash
or ambiguous provider response retains UNKNOWN and cannot dispatch again on retry.
Persist canonical audit and Result/Proof references without raw arguments or
provider payloads in logs. All writes remain disabled in this cohort. Future
write qualification must use existing approval consumption, not a new approval
table. Map READ to `read`; EXTERNAL_WRITE to `external_write` or `communication`
as appropriate; FINANCIAL and DESTRUCTIVE to their existing classes. Relay has no
canonical PRIVATE_WRITE effect today: that mapping requires review, not a silent
downgrade to READ.

## Capability control plane compatibility

Canonical registry source: MissionControl
`04770b83844b036080e59c9e6ea8ebb565383534`, vendored with file hashes in MyEve.
Its current `connected-apps` descriptor is owned by Relay. The five requested
capabilities are absent as explicit descriptors:

| Requested capability | Canonical extension needed |
| --- | --- |
| COMPOSIO_PROVIDER | Add provider setup/qualification dependency in the shared registry |
| EXTERNAL_INTEGRATIONS | Map or extend `connected-apps` without a competing registry |
| TOOL_DISCOVERY | Add bounded authenticated discovery permission |
| EXTERNAL_READ | Add separately qualified read permission |
| EXTERNAL_WRITE | Add disabled/unqualified write permission with approval dependencies |

These are proposed mappings, not active grants. Changes belong in the shared
canonical package before downstream imports are updated. Platform-owner defaults
can be enabled only from a current authenticated administration/membership/
installation binding. The inspected source explicitly lacks the real-owner
binding. No email, local name, repository author or account OWNER role is used
as substitute proof. Synthetic default preferences do not authorize execution.

## Sofie and Owner Experience

Sofie retains conversation and owner preferences. It must ask the gateway for
setup requirements, present an owner-bound setup URL, discover only current
authorized tools, execute a canonical read request, and ground answers in returned
evidence. A provider failure is not an empty inbox or zero issues. No direct
Composio credentials belong in MyEve. Existing MyEve direct Composio paths need
separate adoption work; this checkpoint does not claim they were removed.

The accepted Connections UI is untouched. Catalog, permissions, health, activity
and revocation extensions require the canonical persisted gateway read model.
Adding functional-looking controls against fixture-only data would misrepresent
readiness. Browser qualification here is regression scope, not the new journey.

## Webhook preparation

`verifyComposioEvent` delegates signature verification to the pinned SDK with a
five-minute tolerance and a 256 KiB body limit. It grants no authority. Before
activation, resolve the verified external account to exact canonical owner and
connection, reject foreign/revoked mappings, enforce ingress rate limits, and
atomically claim `(provider, installation, webhook-id)` with a payload digest and
append canonical audit. Same ID/different digest must conflict. A durable store
port documents this requirement; replay storage and event routing are not wired.
No production webhook route or subscription is created.

## Qualification scope and remaining checkpoints

A: source discovery recorded. B: typed adapter and synthetic SDK contract tests.
C: metadata/custody contracts prepared; persistence and owner lifecycle pending.
D: internal read adapter only; policy-filtered authenticated gateway pending.
E: new UI pending. F: consumer design prepared; authenticated integration pending.
G: full deterministic owner/Sofie/Relay journey NOT_RUN. H: independent review NOT_RUN.

The synthetic GitHub test exercises only the adapter segment. It is not the
owner connection, policy/lease, durable deduplication, browser reconnect or Sofie
journey. No live Gmail, Calendar, Slack or GitHub operation is qualified.
