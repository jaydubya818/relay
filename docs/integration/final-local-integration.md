# Relay final local source integration

Local integration gates: **RELAY FINAL INTEGRATION QUALIFIED**. The owner subsequently authorized the scoped Git deployment guard and canonical publication. This is not Production qualification.

## Source and release scope

Current fetched main: `7ea29b2886d2b8bad7b1a1ca1c3e8df1d39ee9ee`. Selected qualified branch: `codex/relay-signing-envelope-v2` at `31f878a6c420a1b9889bb4921bc8eefb4cb996ce`. Merge base equals current main. Selected branch ahead 14 / behind 0. Dedicated integration branch `codex/relay-final-integration` was created from current main and fast-forwarded, preserving all qualified history. Worktree `/private/tmp/relay-final-qualified` uses an independent Git object store after an earlier shared-object checkout stalled.

| Workstream / checkpoint | Classification | Evidence and decision |
|---|---|---|
| PostgreSQL / Drizzle, V1 `43e0160`, V2 `23950eb` | ALREADY_IN_MAIN | Main ancestry includes both qualified releases and migrations 0000–0020 |
| Production authentication `1d61f48`, account isolation `113f0a1` | ALREADY_IN_MAIN | Full auth/security regression rerun |
| GitHub OAuth `501cffe`, live qualification `72d2980` | ALREADY_IN_MAIN | OAuth fake/read-only regression rerun; no live GitHub domain mutation |
| SandboxProvider `f8b3d86`, BrowserProvider `9e21c58`, browser TTL fix `f0291bd` | ALREADY_IN_MAIN | Five opt-in local Docker/Playwright provider tests passed |
| Events/inbox `86e46b4`, sessions `796744b`, V2 orchestration `34ac699` | ALREADY_IN_MAIN | Durable event/session/inbox and authorization suites rerun |
| Permissions, health/readiness `4be30a9` | ALREADY_IN_MAIN | MCP and capability authorization covered by CI |
| Owner preview `f8f30cc`, V1 soak `f77a9c1`, private preview `2b49e15` | ALREADY_IN_MAIN | Fetched remote refs are ancestors of main |
| Owner-preview alternative `2405e33` | SUPERSEDED | Its tree equals the merged `f8f30cc` tree |
| Federation lineage through `d817c84` | QUALIFIED_AND_INTENDED | Selected signing branch preserves Federation implementation, additive migration and disposable protocol evidence |
| Signing V2 `68c8d8c`, live evidence `31f878a` | QUALIFIED_AND_INTENDED | Explicitly selected by this work order; unchanged cryptographic implementation |
| Alternate V2 `11a6964` through `c910c9d` on preprovision branch | NOT_FOR_THIS_RELEASE | Independently live-tested **different wire protocol**, 179-byte commitment with `Relay-Ed25519-SHA256-v2` identifier; cannot merge without changing selected protocol. Preserve branch and evidence. Its receiver compatibility is not evidence for this selected format |
| Telegram `953883c` | INCOMPLETE | Latest published dossier says private-beta golden path INCOMPLETE; live Telegram scenarios 0; do not merge. Pairing foundation is independently component-tested, but not independently selected for this release; foundation classified NOT_FOR_THIS_RELEASE |
| Qualification reservation `73d9104` | NOT_FOR_THIS_RELEASE | Disabled synthetic qualification branch slots, not product release functionality |

No historical branch is deleted. No new product feature or alternative protocol is introduced.

## KMS evidence applicability

`68c8d8c92b65f7acfd6993e1714f0d1c1204f6b2` is an ancestor. Diff from that implementation to the candidate is empty for `lib/v2/federation`, `lib/v2/evidence` and `lib/v2/contracts`. Canonical material, digest, envelope, domain separation, serialization, KMS adapter and canonical verifier are unchanged. Existing live evidence remains applicable: four inputs 1,291 / 132,893 / 260,000 / 262,057 bytes signed as 406 / 406 / 407 / 406-byte envelopes. New KMS calls: 0.

New signing remains explicit V2; V1 is explicit legacy verification only. SHA-256, pure Ed25519, domain separation, downgrade rejection, provider neutrality and 262,144-character contract are preserved. Local boundary regression includes ~64K, ~132K, 260K, exact maximum and maximum+1 rejection before any signer invocation.

## Database audit

22 ordered migrations, final `0021_violet_captain_stacy`. Only migration added to main is 0021: account-scoped Federation agents, grants, relationships, requests/attempts, rate windows and published-view/version metadata. Origin `f6eda12` (full hash in inventory), dependency 0020. All main migration SQL bytes and journal entries match main exactly. Duplicates NONE; historical rewrites NONE.

Full numbered inventory with names, purposes, origin commits and dependency links: [migration inventory](evidence/final-local/migration-inventory.json).

Actual isolated PostgreSQL 17 on 127.0.0.1:55584, role relay_final. Fresh → 22, canonical-main 21 → 22, qualified V1 6 → 22 and qualified Federation 22 → 22 all passed. Reapplying final migrations passed in each case; pre-existing sentinel accounts were preserved. Temporary upgrade databases were dropped. No shared/Preview/Production DB access.

## Cumulative qualification

| Gate | Result |
|---|---|
| Full CI/unit/integration suite | 314 PASS; 5 opt-in local provider tests initially skipped |
| Local Docker/Playwright opt-in providers | All 5 PASS separately; 319 distinct non-performance tests passed overall |
| Complete Federation suite | 117 PASS, subset of CI |
| V2 signing-specific suite | 29 PASS, subset of CI |
| Local performance | 2 PASS; not product SLOs |
| TypeScript / lint / production build | PASS |
| Immutable frontier / migration ordering | PASS; initial frontier invocation required fetching missing historical remote refs |
| Account isolation / Agent identity / capability authorization | PASS |
| MCP / inbox / sessions / revocation | PASS |
| Shared/private memory and Published Knowledge | PASS within deterministic Relay contract tests |
| V1 legacy / V2 signing / tamper / downgrade | PASS |
| Diff check / targeted secret scan / machine-artifact scan | PASS |

Security regression is internal, not independent. Reviewed API bearer authentication, strict/bounded command parsing, default-off Federation and runtime gating, owner/account/Agent filters, explicit grant/target binding, post-admission authority rechecks, metadata-only audit, atomic replay claims, revocation, V2 exact canonical bytes and pinned key/version verification. Negative tests reject spoofed owner/Agent IDs, sibling Agents, unpublished references, stale/replaced credentials, unrelated result readers, grant/target confusion and replay. Provider failure containment does not expose bearer material. No new critical boundary failure was observed.

Independent security review: NOT_RUN. Production-platform qualification: NOT_RUN. No Production-ready claim.

## Publication boundary

Read-only GitHub metadata confirmed automatic deployments to both `relay` and `relay-v2-owner-qualification`. Even the previous evidence push `31f878a` created Preview deployments. Consequently pushing main without a guard risks violating this work order's explicit no-deployment restriction. No push from this integration work has occurred at this checkpoint.

Prepared minimal reconciliation: add `git.deploymentEnabled` entries disabling automatic Git deployment for `main` and `codex/relay-final-integration` in `vercel.json`. Existing hosted applications, environment values, region and database remain unchanged. Owner decision is pending because the work order also prohibits Production configuration changes. See [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration). Do not confuse source qualification with permission to deploy.

## MyEve dependency and local handoff

Remote MyEve main was checked and remains `e9984e4962151bffca1f6eb48c544b60bb643aa7`; the separately converging canonical integration is not complete. Do not substitute the running noncanonical port-3001 process or historical adapter branches. No MyEve source, server, database, model credential or environment was changed.

Cross-product verdict: **MYEVE + RELAY LOCAL E2E PENDING CANONICAL MYEVE INTEGRATION**. Identity, Knowledge, messaging, double authorization, reconnect and conversational results are NOT_RUN across the canonical pair. Relay-only deterministic results above must not be presented as MyEve E2E. Model credentials were not discovered or accessed.

After publication is safely resolved, launch canonical Relay on its documented `http://localhost:3000`, with local PostgreSQL and Federation disabled, then preserve that owner development environment. Source defaults remain Federation DISABLED. No external communication, KMS operation, cloud sandbox, new cloud resource, Production mutation or real owner data is part of this qualification.

## Authorized deployment guard

The owner authorized the exact two-branch `git.deploymentEnabled` guard. It is committed in `vercel.json`: automatic Git deployment is disabled for `main` and `codex/relay-final-integration`; unrelated branches retain their prior behavior. Existing hosted deployments and environment variables are untouched. **Do not remove this guard automatically. Production release requires an explicit re-enable/release decision.**

Post-guard qualification: 33 signing/deployment tests PASS; production build PASS. Product source and cryptographic behavior are unchanged. The earlier publication-blocker section records the preauthorization checkpoint; it no longer requests approval. Before publication, the exact parsed configuration was checked against Vercel documented branch rules. GitHub deployment inventories are checked after each push.
