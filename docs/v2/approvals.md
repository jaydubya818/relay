# Relay V2 Approval Service

WO-07 treats approval as scoped authorization evidence, not a chat response or a bearer link. A request is bound to one tenant, immutable action hash, Agent/runtime/task, live policy decision, approval class, capability risk/effect, explicit consequences, displayed evidence, assignees, and expiry.

## Request and decision

Only an active `REQUIRE_APPROVAL` policy decision can create a request. Assigned approvers must be active owner, admin, or approver members in the same account. Relay stores a redacted action/display snapshot and creates tenant-scoped notification-outbox records. Notification delivery does not confer authority.

An authenticated assigned principal may approve or deny. Relay validates the selected scope against the policy offer and immutable action, records authentication evidence, canonicalizes the decision, and signs its hash. Competing decisions use a conditional state transition, so only one can win in V2. The schema retains a separate decisions table so V2.1 quorum can be added without replacing the record model.

## Scope and safety floors

`once` binds one action hash. `task` and `session` add identity and maximum-use ceilings, but V2 conservatively requires the same approved action template hash for every use. This avoids unreviewed parameter drift while leaving broader template semantics for a separately qualified future change.

Financial and destructive actions always offer `once` only. External communications to an unknown or new recipient also offer `once` only; task/session scope is possible only when the policy fact snapshot authoritatively marks the relationship `known`. Account policy cannot configure these floors away.

## Consumption and lifecycle

Consumption verifies the current policy decision, request and policy expiry, tenant, action hash, task/session binding, resource scope, and remaining uses. `consumeApprovalInTransaction` is the required integration point for WO-08 permit issuance and WO-09 reservation so approval cannot be consumed without the corresponding durable authorization operation. A unique consumption record and conditional counter prevent replay under races.

Approved requests can be revoked; pending requests can be superseded by edited actions; an account-scoped expiry hook records expiry evidence. Email-link authorization, quorum, and delegated approver groups remain excluded.

## Isolation obligation

Approval requests, decisions, consumptions, notifications, policy linkage, assignments, queries, and lifecycle transitions are account-scoped. Focused negative and race tests join the complete WO-22 tenant-isolation suite.
