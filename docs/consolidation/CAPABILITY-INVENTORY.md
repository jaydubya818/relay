# Capability inventory

| Capability | Source | Destination | Migration impact | Integration method | Disposition |
|---|---|---|---|---|---|
| PostgreSQL / authentication / account isolation / identities / grants | 1da025e → 416dee9 | lib/db; lib/auth; lib/v2/identity; lib/v2/federation | 0000–0028 | Normal merge of qualified lifecycle branch | ADOPTED; 450 PostgreSQL tests PASS |
| Private/shared Memory / Knowledge / Inbox / durable sessions / events | 1da025e + retirement fencing | lib/memory; lib/agent-sessions; lib/v2 | 0000–0028 | Preserve canonical scopes; terminal retirement fencing | ADOPTED; no cross-account authority added |
| GitHub / browser / sandbox / dashboard | 1da025e | lib; app; components; tests | Existing canonical migrations | Already canonical | ALREADY_CANONICAL; optional live providers NOT_RUN |
| Invite revoke / disposable account retirement / revocation | 416dee9 | lib/beta-account-retirement; lib/account-fence; account APIs | 0026–0028 | Auditable merge ed8bb0f | ADOPTED; 26→29 populated migration/replay PASS |
| Telegram channel latest campaign | b4fe4bd | lib/v2/channels; qualification scripts | Retained separate branch | Preserve paired uncompleted live qualification | DEFERRED_POST_ALPHA |
| Versioned KMS commitment signature | c910c9d | lib/v2/federation/signature; transport | No selected lineage change | Requires paired verifier and independent security gate | DEFERRED_POST_ALPHA; durable source retained |

Exact durable branch tips, source dependencies and retention reasons are in [BRANCH-INVENTORY.md](BRANCH-INVENTORY.md). Initial evidence directories and migration checksums are in [inventory.initial.json](inventory.initial.json). Historical PASS never implies a modified candidate or live deployment PASS.
