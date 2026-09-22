# Authenticated authority inspection

`POST /api/v2/federation` accepts the additive command:

```json
{
  "operation": "authority.inspect",
  "input": {
    "target": "relay://peer-account/peer-agent",
    "capability": "message.send",
    "resource": "relay://peer-account/peer-agent",
    "idempotencyKey": "proposed-message-1",
    "expiresAt": "2030-01-01T00:05:00.000Z",
    "payload": { "body": "Please describe your published research offering." }
  }
}
```

Use the existing Agent bearer credential and a current request expiry within 24 hours. The input is an exact canonical submission, including payload-dependent scopes. It is inspected, not submitted. The endpoint does not enumerate grants or accept a caller identity override. Receiving capabilities (`message.receive`, `artifact.receive`) are evaluated through the existing corresponding outbound request semantics, not new execution operations.

The response contains only `authorized`, `status`, `expiresAt`, `approvalRequired`, `observedAt`, and `executionRecheckRequired: true`. Status is ACTIVE, MISSING, EXPIRED, REVOKED, NOT_YET_ACTIVE, PEER_UNAVAILABLE, RESOURCE_NOT_AUTHORIZED, CAPABILITY_NOT_AUTHORIZED, or DENIED. Unknown server/transport failures must be treated as unavailable and must not be interpreted as permission.

An ACTIVE observation means current canonical identity, resource, grant and policy checks permitted the proposed interaction. It is not a promise of successful execution: request admission, current budgets, rate limits, required approvals, and delivery checks still apply. A grant requiring approval may return ACTIVE with `approvalRequired: true`.

Inspection is advisory current-state information for authenticated callers. It grants no authority. All execution paths independently re-evaluate authorization. The result has no token, lease, approval ID, execution handle, or reusable authority artifact. Clients must not use it to skip a check or cache ACTIVE as durable authority.

Missing, private, unpublished, inaccessible, and blocked resources use privacy-preserving results. Safe detailed diagnostics are restricted to grants relevant to the authenticated caller account and Agent and the exact peer. No other grant contents, policy expressions, credentials, or resource lists are returned.

Inspection writes only ordinary rate counters (60 calls per Agent and 120 per owner per minute). It creates no grant, request, outbox delivery, policy decision, approval, budget reservation, audit signature, or signing-provider call. Existing request and signing contracts are unchanged. No migration is required.
