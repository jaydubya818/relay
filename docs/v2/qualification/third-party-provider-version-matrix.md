# Third-party execution provider version matrix

Reviewed: 2026-09-13

| Relay adapter | Upstream contract | Qualified locally | Live qualification | Stability constraints |
|---|---|---:|---|---|
| `browserbase@1.0` | REST Sessions API v1 | Yes | `BLOCKED_EXTERNAL_CONFIGURATION` | HLS replay only; signed replay segments refresh after expiry; create is not assumed idempotent |
| `e2b@1.0` | JavaScript SDK sandbox v2.6.2 contract | Yes | `BLOCKED_EXTERNAL_CONFIGURATION` | Pause/resume is beta; create is not assumed idempotent |

An upstream version change, feature removal, authentication change, or change to create/reconcile semantics invalidates live qualification and requires the focused contract pack plus vendor-live rerun. Marketing, compliance, or isolation claims do not raise Relay assurance without independent evidence and an explicit manifest revision.
