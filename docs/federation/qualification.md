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

## 2026-09-19: disposable two-owner live protocol qualification

This section supplements the historical local qualification above. It does not replace its history or qualify MyEve.

| Qualification boundary | Status |
| --- | --- |
| Automated repository/federation qualification | **PASSED_AUTOMATED** — exact counts below; four opt-in provider tests remain skipped |
| Two disposable generic Agent platforms over HTTPS | **FEDERATION PROTOCOL PASSED_LIVE** — 46 live assertions |
| MyEve | **NOT_RUN** — no MyEve code, deployment, runtime, or data was changed |
| Production Agent platform | **NOT_RUN** |
| Independent security review | **REQUIRES_INDEPENDENT_SECURITY_REVIEW / NOT_RUN** |
| Production release | **Not qualified**; the existing V2 and external-platform release obligations remain |

### Baseline and tested code

- Branch: `codex/relay-federation`.
- Preserved implementation baseline: `194b3a074e85e8300d9d510b3016fb00290378cb`. The worktree was verified clean immediately after that commit, before live qualification changes.
- Focused protocol fix: `efc4b3af91bed7118777b6bee92dd260988321c1` — persist signed authorization-denial receipts after admission rolls back.
- Qualification harness / exact successful live code: `b81a95cf61752c6279321f6fdded7122647988e5`. Subsequent qualification documentation/evidence does not change the tested implementation.
- No merge, release tag, default enablement, hosted migration, or MyEve changes. `.env.example` still sets `RELAY_FEDERATION_ENABLED=false`. The harness enables federation only in its disposable Relay process.

### Trust and hosting boundaries

Jay/Sofie and Sarah/Ava each had a different account, owner principal, Agent, bearer credential, HTTPS key, artifact signing key, control credential, container process, configuration mount, and writable private-store mount. Only the read-only adapter code and public CA/signing information were shared. Each container had a read-only root filesystem, all Linux capabilities dropped, and no Docker socket or peer storage mount. The container identities, image digest, PIDs, mount domains, and durable Relay addresses are preserved in the [live report](evidence/disposable-live/report.json).

Relay used a third disposable PostgreSQL container with a generated password unavailable to either platform. Relay's HTTPS process imported the unchanged production REST and MCP route handlers. Agent commands, signed inbox delivery, acknowledgements, result retrieval, and artifact retrieval crossed real HTTPS sockets with certificate verification. Owner enrollment/publication/grant changes used trusted local owner-service calls. This qualifies the protocol and route handlers under a qualification HTTPS host, **not a production Next.js deployment or owner-dashboard workflow**.

The platform's synthesis was a deterministic extractive answer with source citations. Work was an actual bounded deterministic architecture checker operating on a separately shared source artifact; it used zero model steps and zero model spend. These prove the federation context, result, budget, and authorization contracts. They do not certify an LLM's behavior, a production work scheduler, or production cancellation enforcement.

### Requested final qualification report

| # | Area | Result and evidence |
| --- | --- | --- |
| 1 | Branch / HEAD / clean state | Baseline and exact tested code above. Final documentation commit and clean state are reported with delivery; no merge/tag. |
| 2 | Trust domains | Independent Jay → Sofie and Sarah → Ava containers, identities, credentials, endpoints, keys, and stores; third Relay database domain. |
| 3 | Identity / address | Owner enrollment and immutable `relay://account/agent` addresses passed; rotation retained identity/address; replacement did not inherit Agent-specific authority. |
| 4 | Spoofing | Forged caller fields, cross-owner enrollment, old credentials, replacement-Agent access, and caller-result access by the publisher were rejected. |
| 5 | Publication | Sofie's own store held PUBLIC/SHARED records and a unique PRIVATE canary. Only two owner-selected record references/revisions were published. Canonical records were not uploaded to Relay. |
| 6 | knowledge.query | No-grant query returned 403; publisher received zero deliveries and performed zero store reads. Grant-enabled retrieval and cited publisher synthesis returned the authorized projection. |
| 7 | Private knowledge isolation | Five direct, semantic, injection, restriction-bypass, and hidden-context requests stayed within the projection. Application access logs and independent Linux inotify monitoring showed zero opens/reads of either canonical private file during external operations. |
| 8 | Provenance / receipts | Results identified owner, publisher, visibility, source references, provenance, and publication version. Both owners received signed disclosure metadata with reference/type/count and grant/policy IDs. All **91 Sofie-owner and 115 Ava-owner audit records** verified; each chain includes 15 disclosure receipts. |
| 9 | Grants / revocation | Query authority did not confer message, work, or artifact authority. Revocation denied new queries and cached-result reads before delivery; history remained. Restoring query authority did not enable messaging. |
| 10 | Messaging | Explicit grant enabled network delivery, local acknowledgement, a conversation-linked request, and a completed result. No receipt was treated as execution before local acceptance. |
| 11 | Idempotency / offline | Identical submission reused one request; changed content with the same key returned 409. Offline requests remained authorized/pending, expired without execution, or recovered once. Retry timing was real, without database-clock manipulation. |
| 12 | Work / local authority | Ava independently rejected Relay-authorized safe work while locally disabled and rejected unsupported email work after enablement. Authorized architecture work returned summary, evidence, artifact reference, measured runtime, and zero model usage. Its local Run body stayed in Ava's store. |
| 13 | Artifact sharing | Source-owned HTTPS artifact used a signed, audience-bound, expiring URL and recipient signing proof. Ava verified actual bytes, size, and checksum. Unauthenticated and expired retrieval were rejected; Relay did not fetch/store artifact bytes. |
| 14 | Publication version / revocation | Correction changed revision and version 1 → 2; earlier receipts retained version 1. Publication revocation denied new queries and prior result reads. Revocation is irreversible; it was not confused with restoring a grant. |
| 15 | Blocking / rates | Owner block denied query, message, and work across both directions. Oversized body returned 413; discovery scraping and denied-request flooding reached durable 429 limits. |
| 16 | Discovery | Only explicit profile metadata was returned. Hidden replacement Agent and SHARED/private publication metadata were absent. Discovery conveyed no execution authority. |
| 17 | REST / MCP | The same live query/result completed through MCP and REST with identical result, authority, and version semantics. Both use the shared production command service. |
| 18 | Minimal Relay data | Inspected **all 94 public-schema tables** and decrypted **28 retained payload/result objects**. Neither owner's private canary nor local Run body appeared. Both private files remained in their respective platform stores. Result acknowledgement removed both Relay ciphertext fields. |
| 19 | Restart / durability | Restarted Relay and Sofie's container, preserving keys, queue, ledger, and identity. Then crashed Sofie after durable local execution but before acknowledgement; after both restarts and normal backoff, redelivery returned the persisted receipt without a second execution. |
| 20 | Security | Live forged-signature, wrong-audience, untrusted-issuer, expired-assertion, future-assertion, replay, identity, projection, local-refusal, and abuse checks passed. Automated suites additionally cover approval/default-deny, budgets, forged work context, response projection/hidden-reasoning validation, and bounded retries. This is not an independent security review. |
| 21 | Defects / fixes | One protocol defect: rejected admission lacked a signed denial receipt. Reproduced on the baseline over HTTPS, reproduced by a failing regression, fixed in `efc4b3a`, then verified by 17 federation tests and the live no-grant proof. Two harness errors (reactivating a revoked view; table-name digit validation) were corrected without changing protocol rules. Failed-run evidence and successful rerun are preserved. |
| 22 | Regression counts | **197 passed / 4 skipped** in 45 non-browser files (42 passed, 3 skipped); **2 performance tests passed**; **3 existing dashboard browser E2E tests passed**. Typecheck, lint, Drizzle consistency, frontier, and production build passed. See breakdown below. |
| 23 | Remaining blockers | MyEve and production Agent-platform qualification NOT_RUN; independent security review NOT_RUN. Production key management/rotation, runtime cancellation, source revocation, retention scheduling, and deployment-scale concurrency/availability remain external release gates. Disposable keys/credentials/containers/stores were destroyed; only non-secret evidence remains. |
| 24 | Final verdict | **FEDERATION LIVE QUALIFIED — disposable generic platforms only. FEDERATION PROTOCOL PASSED_LIVE.** No MyEve or production-platform qualification is claimed. |

### Exact automated breakdown

These subsets are included in the 197 passed tests; they are not additional totals.

| Suite / check | Result |
| --- | --- |
| Federation | 17 passed |
| Security directory | 5 passed |
| V2 security architecture | 2 passed |
| MCP projection | 1 passed; additional federation MCP cases are included in the 17 federation tests |
| Integration REST/API golden paths | 4 passed |
| Database / migrations | 3 passed |
| V2 release qualification | 5 passed |
| Separate performance suite | 2 passed |
| Separate browser E2E suite | 3 passed |
| Typecheck / lint / migration consistency / frontier / production build | All passed |

The four intentionally skipped tests are two opt-in live browser-provider tests, one live Docker sandbox-provider test, and one live Relay-managed-provider test. They are distinct from this mission's executed container qualification and the three executed dashboard browser tests. Initial database-role/availability and sandbox-socket setup failures were resolved before the reported passing runs; they were not classified as protocol defects. Exact per-file counts are in [regression-summary.json](evidence/regression-summary.json).

### Evidence and reproduction

- [Successful live assertions, isolation inventory, persistence inspection, and destruction receipt](evidence/disposable-live/report.json)
- [Platform execution/replay receipts and private-store access instrumentation](evidence/disposable-live/platform-receipts.json)
- [Jay/Sofie signed audit export](evidence/disposable-live/sofie-audit.json) and [Sarah/Ava signed audit export](evidence/disposable-live/ava-audit.json), including public verification keys
- [Baseline defect reproduction](evidence/baseline-live-defect/report.json)
- [Harness attempt 1](evidence/harness-attempt-01.json) and [harness attempt 2](evidence/harness-attempt-02.json), both with successful cleanup
- [Evidence SHA-256 manifest](evidence/manifest.json)

Run `pnpm exec tsx scripts/federation-qualification/run.mjs` from this worktree with Docker available and the local `node:22-bookworm` and `postgres:17-alpine` images. Ports 55449 and 58440–58442 must be free. Archive the current evidence first: a run replaces the `disposable-live` evidence directory's files. The script uses generated disposable keys, verified local TLS, distinct mounts, and cleanup in `finally`. It exits unsuccessfully if a proof or container cleanup fails. The `--baseline` mode performs only the admission-denial probe; reproducing the original defect requires the baseline service implementation.

Private canaries, Agent credentials, database passwords, artifact private keys, TLS private keys, and Relay private keys are absent from retained evidence. Canonical private-file hashes and metadata-only receipts remain. Kernel access counters were captured before the orchestrator's explicitly authorized final forensic inspection of those files.
