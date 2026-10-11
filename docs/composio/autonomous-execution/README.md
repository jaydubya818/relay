# Relay × Composio autonomous integration qualification

Execution remains disabled. This work builds on Relay
`4e0df2cf459b98cc4aab85a5906e4975cf0e4d08`, preserves SDK
`@composio/core@0.22.0`, MyEve reference
`9200bd3826350ad586bb5640ca08557da7d1b984`, and all 27 frozen contract groups.
Earlier checkpoint documents and external evidence are historical records and
are retained unchanged.

## Result integrity boundary

`captureResultIntegrity()` captures the exact adapter binding before dispatch.
It checks provider, adapter revision, scope, connection authority, tool identity,
descriptor version/schema digest, arguments, action, policy decision, lease and
approval identity. Successful transport output must retain the reviewed bounded
projection and matching result digest. UNKNOWN cannot carry a successful result.
Returned data is detached and immutable; provider instructions remain untrusted.

This helper does not grant admission, authenticate a provider signature, store a
native Result/Proof, settle a budget or authorize reconciliation. It deliberately
does not reject a late result merely because the original lease has since expired.
The canonical receiver must separately authenticate recovery, check current
authority and apply valid durable state transitions. A valid historical binding
is insufficient to finalize UNKNOWN.

## Canonical dependency and ownership

The complete [receiving handoff](../dependency-hold/canonical-owner-handoff.md)
remains the integration acceptance contract. The Unified Capability Control
Plane workstream owns the receiver and any changes to canonical leases, runtime
commands, policy ordering and lifecycle authority. Its in-progress source is not
automatically adopted or treated as qualified here.

Required acceptance includes an explicitly designated authorized nonproduction
receiver, enrollment and owner/tenant/installation/agent/Work mappings; exact
reviewed source and contract versions; atomic admission and native command
reservation; authenticated result custody and reconciliation; durable UNKNOWN
and budget exposure; and independent receiver qualification. A synthetic host
callback, signed permit, matching wire schema or PostgreSQL fixture alone does
not satisfy the designated-receiver requirement.

Existing canonical commands distinguish potentially committed effects, and
existing budgets support UNKNOWN exposure. Their current runtime orchestration
is bound to its supported native commands. Integration code must not create a
second ledger or infer that command expiry, worker loss or a stale lease permits
release or another dispatch. In particular, reservation expiry must not release
possibly committed exposure; the canonical owner must qualify this ordering.

`IntegrationGateway.requestRead()` still records NOT_DISPATCHED. Discovery still
returns `executionAvailable:false`. There is no positive consumer route or
application caller of the live SDK constructor, and no configuration switch
opens this boundary.

## Qualification and release

The full dependency audit is now a required step in the existing hosted quality
workflow alongside the production audit. Neither audit uses ignored advisories
or registry-error suppression. Exact-commit evidence is recorded separately
from source under `relay-composio-evidence/final-autonomous` in the parent
workspace. The final report must distinguish local provider fixtures, canonical
wire/runtime compatibility, and positive designated-receiver qualification.

The integration branch descends from owner workspace Checkpoint B
`403411394fe5641b95d1a53db7f231147ec850f9`. A focused review should use that branch
as its prerequisite base; merging a stacked PR into an unmerged prerequisite is
not integration into main. The owner UI and canonical policy branches retain
their own release/governance requirements. No protected-branch bypass or
production deployment is authorized by a passing CI run.

Merge remains prohibited until the mandatory receiver, execution, recovery,
consumer, security, review and governance gates have passed. All production and
live Composio activation remains disabled after any eventual source merge.
