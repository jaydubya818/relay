# Native receiving consumer compatibility

This additive data port composes with the canonical Relay `relay.native-admission.v1` receiving transaction. It does not issue authority and the public gateway remains closed. All 27 owner contract groups remain unchanged.

`createNativeConsumerPort` takes server-installed ownerPrincipalId, pinned qualified descriptors and the reviewed Composio adapter. Its account/owner/installation/agent/connection SELECT is executed by the receiving transaction under its account fence and PostgreSQL deadline. The pure resolver receives rows, never a transaction handle. Connection authority, exact descriptor, arguments and the full consumer ActionIntent are checked before execution. The canonical receiver remains responsible for authenticated owner/organization/Work lineage, signed current policies, independent recovery witness, runtime lease, approval, reservation, durable command and worker fencing.

The adapter accepts an optional receiver AbortSignal. It checks cancellation after remote metadata reads and immediately before transport, and combines it with the existing transport deadline. Aborting does not prove a resource stopped. Ambiguous results stay UNKNOWN and require authoritative reconciliation. Full result identity is checked before durable receiver custody.

Synthetic focused qualification: 82 tests across native bridge, Composio transport, execution binding and result custody; typecheck and changed-file lint pass. No provider operations, grants, deployments or installations were activated. Full composed receiving/worker, regression, browser, exact-SHA CI and final independent qualification remain required before merge readiness. This source is a successor to 403dc8f; prior exact-source evidence is preserved separately.
