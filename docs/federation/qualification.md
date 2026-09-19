# Federation local qualification

Branch: `codex/relay-federation`. Base: `acaf711`. No deployment or MyEve changes.

## Results

- Full non-live regression: **194 passed, 4 intentionally skipped**. This run included the first 14 federation tests.
- Final expanded federation suite: **16 passed**, including the complete two-owner golden path, MCP messaging, owner-level grant semantics, replacement, and credential rotation.
- Existing performance suite: **2 passed**.
- Existing release gate suite: **5 passed** in the final focused run. All new tenant tables retain explicit `account_id` columns; there is no federation exemption.
- TypeScript, ESLint, Drizzle consistency check, V1/V2 immutable-frontier guard, and production Next.js build passed.
- Testing used a disposable local PostgreSQL cluster and generated test accounts, credentials, keys, and data. No hosted database was migrated.

The full run initially caught missing conventional tenant-column names in the new tables. The schema was corrected and the gate passed without changing the gate test.

## Scope evidence

| Mission areas | Local implementation/evidence |
| --- | --- |
| Identity, addressing, ownership, rotation/replacement | Existing accounts, Agents, credentials, and Passports; owner-only enrollment; immutable addresses; primary designation; explicit platform replacement rule; sibling/forged-owner/revocation tests |
| Grants, capabilities, conditions, policy, approval | Exact owner/Agent/resource scopes; independent send/receive capabilities; deterministic conditions; existing V2 policy and approvals; default-deny and approval tests |
| Publication, entries, collections, versions, deletion | Metadata-only projection; strict snapshot/dynamic schemas; explicit eligibility; compare-and-swap versions; reference invalidation; revoked/private/version tests |
| Query and context fence | Independent record retrieval; optional synthesis; publication-only reader; returned reference/revision/type/version validation; prompt-injection input cannot expand the adapter's projection |
| Receipts | Both owners' existing signed audit chains; categories/references/count/version and authority references; tests assert absence of knowledge content |
| Delivery, availability, authenticity | Durable request/attempt state; metadata outbox; bounded polling/retries; local acceptance distinct from delivery; EdDSA JWS with trusted key/issuer/audience/lifetime and durable replay-claim contract |
| Messages and conversations | Independent grants; bounded encrypted payloads; scoped reply references; message success/refusal/spam tests; no permanent chat content index |
| Work and budgets | Bounded request categories; no delegation or privileged execution lease; local accept/reject/approval; atomic shared budget reservation; result/evidence/usage reconciliation; exhaustion tests |
| Artifacts | Metadata and audience-bound expiring source retrieval; receiver authorization; no Relay fetch or permanent artifact copy; expiry/audience tests |
| Discovery, abuse, trust | Opt-in profile/view metadata; no content index; owner/Agent/capability/target/resource/grant limits; explicit block/contact/trust controls; no trust-derived grant |
| Adapters | Versioned REST and MCP; source contracts and projection helper usable by MyEve or other platforms; private-preview gates preserved |

The golden path uses the same Jay/Sofie and Sarah/Ava fixture throughout: registration, explicit publication, grant, retrieval, both receipts, private-context exclusion, revoke/deny, restored grant, messaging, local work approval, work evidence, and expiring artifact sharing. Work execution and source artifact storage are disposable platform test doubles; this is contract qualification, not live MyEve/provider certification.

## Remaining release obligations

The existing V2 release remains blocked. Federation additionally requires independent security review and live qualification of receiving-platform context isolation, work runtime/step cancellation, source artifact audience/expiry/revocation enforcement, production signing/key rotation/recovery, retention scheduling, and deployment-scale concurrency/availability. No tests here prove the internals of an independently operated Agent platform.

Dynamic publication updates are explicit owner operations in this release; automatic source-platform ingestion is not installed. `NETWORK` visibility requires an explicit contact relationship until a separate network-membership model exists. Unknown V2 policy limit obligations fail closed. Public queries require authentication and explicit owner public-query policy. These conservative boundaries are part of the contract, not implicit broad permissions.

## Change scope

Most changes are isolated in federation domain modules, three HTTP adapters, documentation, tests, and one additive migration (plus its generated snapshot). Shared changes are limited to an approval-floor input on policy evaluation, exposing the existing budget reservation inside a caller transaction, optional cryptographic platform bindings, and expired-content maintenance. The Vitest path decoder and node_modules ignore rule support an isolated worktree whose path contains spaces and whose installed dependencies are shared.
