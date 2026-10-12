# Installed canonical capability lease transport

Source-only extension from 1aec4e728a1979b62d9141b39d405f404b344f6d. Preserve all 27 frozen contracts, connected-apps READ adapter, owner preferences and Relay/backend independent authority. No new registry, ledger, remote executor or monetary-unit mapping.

Expose an authenticated runtime POST to the existing canonical lease transaction, including its signed remoteAdmission/remotePermit. Require existing runtime credential, Workload identity, Passport, exact evaluated action, current policy propagation, approval and canonical budget reservation. Before returning idempotent receipts, revalidate current policy and unconsumed lease authority without debiting another call. Receiving backend must validate current pair again before new Work admission. Existing admitted Work is not changed by transport retries or denials.

Do not provision real credentials, policy, budgets or runtime grants. The existing runtime activation gate remains disabled. Deployment and publication remain held pending consolidated owner preflight.

## Transport contract

`POST /api/v2/runtime/capability-leases` requires `Authorization: Bearer <existing runtime credential or resource-bound OAuth access token>` and `x-relay-account-id`. OAuth resource is the deployment origin plus `/api/v2`. Runtime activation must already be qualified; private-preview remains disabled. Body is bounded to 64 KiB and strict:

```ts
{
  action: ActionIntent, // relay.action-intent.v2, unchanged frozen schema
  workloadId: string,
  workloadIdentityToken: string,
  audience: string,
  ttlSeconds?: number, // integer 1..30
  maxCalls: 1,
  approvalRequestId?: string,
  budgetReservationId?: string,
  remoteAdmission: { message: string, keyId: string, signature: string }
}
```

The response is the canonical issuer result, without an additional authority wrapper:

```ts
{
  leaseId: string, token: string, expiresAt: string,
  maxCalls: number, onlineRequired: boolean,
  remotePermit: { message: string, keyId: string, signature: string }
}
```

A 200 response is a lease/reference issuance receipt, not a receiving-backend admission or resource-start acknowledgment. The receiving backend must validate both signed policy references and exact owner, installation, Mission/Work, version, freshness, qualification, authority and budget in its existing native admission transaction. It must preserve original admitted Work and UNKNOWN accounting on disable and recover exact durable receipts on retry.

## Enrollment and action mapping

No installed enterprise capability definition or runtime is created by this change. The server enrollment must pin the existing canonical definition (`name`, `version`, resource type/schema and input schema), account, agent, runtime, task, workload and audience. `destination.capabilityNames['enterprise.fleet']` must equal that canonical definition's name. The synthetic tests use `resource.lease.execute@1.0` with a `target` resource; this read fixture is not a proposed enterprise execution grant.

`action.parameters.capabilityAdmissionDigest` must equal `policyMessageHash()` of the exact verified MyEve `PERMIT`. `action.canonicalHash` is `canonicalHash({capability, resource, parameters})`. Workload identity must match account, agent, runtime, task and audience. Existing current Passport, evaluated action/policy, hard approval floor and canonical reservation checks remain authoritative. The remote reference preserves the MyEve owner/installation/Mission/Work/action/budget binding, substitutes Relay's own policy epoch and lease identity, and hashes the original MyEve permit. Agent revisions from distinct authorities are not interchangeable.

Do not translate `budgetMicros` into an invented Relay metering unit. A configured metered definition requires its already-authorized canonical reservation. MyEve, MissionControl and Factory continue their independent money/accounting checks.

Issuance does **not** debit `maxCalls`. Only canonical `authorizeLeaseCallInTransaction` with its durable native command receipt consumes Relay call authority; MissionControl's remote admission receipt is not that call receipt. Do not report a Relay execution call as consumed merely because MissionControl accepted a policy reference. This endpoint does not activate a Relay executor.

## Recovery and fencing

The existing encrypted remote issuance receipt gives one lease/reference for concurrent identical requests, including response loss and connection restart. A changed request for the same source reference conflicts. Before returning cached authority, the endpoint revalidates runtime, current Passport/owner, source freshness, current Relay epoch, authenticated observed owner fences, and the unconsumed lease's workload, approval, revocation and reservation. A newer observed owner fence blocks stale source permits even when delivery acknowledgment was lost. Pending observed delivery is fail-closed; an authenticated exact acknowledgment remains required. Receiving-backend revalidation is still necessary for changes not yet observed by Relay. No global ledger or distributed transaction is added.

The canonical approval revalidation used by admitted workers is now shared by online call authorization and readback, so an expired/revoked approval cannot authorize a new call or a replayed issuance response. Disabled owner policy does not rewrite existing lease rows. UNKNOWN reservations remain UNKNOWN and bound; no release or reconciliation is inferred.

## Qualification and release gates

Actual disposable PostgreSQL tests cover positive issuance, concurrency, lost-response/connection restart, request conflict, exhausted lease, runtime/account/owner/installation/Work binding, revoked runtime/lease, concurrent fence, pending/lost owner acknowledgment, ordinary disable preserving an admitted lease, exact approval expiry, and UNKNOWN reservation preservation. Existing browser regressions run against a separate local synthetic database with runtime execution disabled; they do not qualify installed Clerk authentication or the cross-system same-Mission Golden Journey.

This source preserves all 27 frozen wire contracts. No production or external-alpha state, credentials, grants, pricing, spending ceilings, or deployment exclusions are changed. Qualification-only/Vercel restrictions remain intact. Independent hosted recovery witness, real enrollment/custody, final composed installed journey, source reconciliation, exact-SHA hosted CI and release authorization remain gates. The component branch must not be pushed until the integration owner verifies deployment exclusions for its selected publication ref.
