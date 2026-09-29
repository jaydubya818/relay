# Worktree cleanup manifest

Fresh inspection after canonical publication. Dirty contents and inaccessible paths must be retained. Other-chat managed worktrees are not attached to this chat and cannot be archived by this chat’s managed-worktree tool; they retain their source and evidence. Unique historical commits remain preserved even where accepted implementation was selectively integrated. Task-owned candidates may be retired after the final audit commit is durable. Stale registrations may be pruned only after preserving their recorded HEAD.

| Path | Branch / SHA | Dirty paths | Unique commits vs main | Disposition |
|---|---|---|---:|---|
| /Users/jaywest/relay | refs/heads/main / `e2eb350f5655427d55cc204264020a9295173f96` | 3 | 0 | KEEP_DIRTY_OR_INACCESSIBLE |
| /private/tmp/canonical-consolidation-relay | refs/heads/codex/canonical-consolidation / `749c553b37a55c47dd31add72a760a439fbb0ab0` | 0 | 0 | REMOVE_TASK_OWNED_AFTER_FINAL_COMMIT |
| /private/tmp/myfactory-relay-main-verify | refs/heads/codex/relay-beta-trust-onboarding / `9e3903aa19c11337f078297397d5cda821a7d5e8` | MISSING_REGISTRATION | 0 | PRUNED_STALE_REGISTRATION |
| /private/tmp/relay-authority-expiry | refs/heads/codex/peer-message-answers / `381918e5ce6a24ecdf5ba5d74daec02663728662` | MISSING_REGISTRATION | 0 | PRUNED_STALE_REGISTRATION |
| /private/tmp/relay-peer-permissions-baseline | refs/heads/feat/authority-inspection-v1 / `31ab0eec3d02d660f81bc156f1eea4535c2f5764` | MISSING_REGISTRATION | 1 | PRUNED_STALE_REGISTRATION |
| /private/tmp/relay-v2-owner-consolidation | refs/heads/codex/relay-owner-preview-consolidation / `f8f30ccd1db769aee7751c6eef56ea09a7152290` | MISSING_REGISTRATION | 0 | PRUNED_STALE_REGISTRATION |
| /Users/jaywest/Documents/ChatGPT/MyFactory/data/hosted-relay | refs/heads/codex/myfactory-hosted-routing / `fac4dede019d0b60aacc1a7c5901a413e38206d4` | INACCESSIBLE_TIMEOUT | 8 | KEEP_DIRTY_OR_INACCESSIBLE |
| /Users/jaywest/Documents/ChatGPT/MyFactory/data/relay-live | refs/heads/codex/myfactory-relay-live / `86c558d6e52081cfbb425920d560ed8024731bb4` | INACCESSIBLE_TIMEOUT | 1 | KEEP_DIRTY_OR_INACCESSIBLE |
| /Users/jaywest/Documents/ChatGPT/New project/relay-federation | refs/heads/codex/relay-federation / `614c638d6fc4099db8064540326f5de4438e93a1` | 0 | 4 | KEEP_UNIQUE_HISTORY |
| /Users/jaywest/Documents/ChatGPT/New project/relay-worktrees/feat/relay-v2-telegram-private-beta | refs/heads/feat/relay-v2-telegram-private-beta / `89d6b053196566486648c3bbc7ac36d196a0e0c1` | 0 | 0 | KEEP_SHARED_CHECKOUT |
