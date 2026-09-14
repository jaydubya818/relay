# Customer runners and private gateways

## Authority model

The hosted Relay control plane remains authoritative. A customer runner stores no independent policy, approval, budget, Passport, or durable task truth. It opens an outbound authenticated poll, accepts only assignments bound to its account and runner identity, and receives short-lived workload/lease authority already issued by Relay.

Enrollment is one-time, account-bound, expires within ten minutes, and requires proof of possession of the runner Ed25519 key. Relay issues a signed 24-hour runner certificate bound to account, key thumbprint, trust epoch, and assurance. Revocation changes authoritative runner state, fences active assignments, and revokes their workloads and leases. A stale or revoked certificate therefore cannot poll new work. Production transport uses TLS with the signed runner certificate bound to mTLS identity; the reference service models the application-layer certificate and proof contracts.

Every assignment binds one runner, account, task, workload, capability lease, immutable payload hash, expiry, and monotonic fence. Each evidence report is signed by the enrolled runner key and must advance the sequence exactly once. It remains labeled `runner_reported`; a customer-controlled host cannot create Relay-observed evidence.

## Local enforcement point and secrets

The assignment carries only opaque `vlt_` handles. The local PEP requests an assignment-scoped credential-socket binding from Relay's broker. The broker audience is `runner-socket:<assignment>` and its expiry cannot exceed the assignment. No API returns durable credential values and no contract requires secrets in process environment variables.

## Private gateway

V2 provides named HTTPS resources, not a VPN or arbitrary subnet route. A resource fixes a DNS host, port, allowed methods, and allowed path prefixes. An assignment must list the exact resource ID. The local gateway asks Relay to authorize the account/runner/assignment/resource/method/path tuple and receives only the resolved request target; it records a receipt with a path hash.

The production gateway must additionally pin DNS answers during a connection, reject loopback/link-local/metadata/multicast destinations unless the named private resource explicitly resolves inside the customer network, revalidate redirects, strip unapproved and hop-by-hop headers, and enforce body/time limits. Raw TCP/UDP and CIDR-wide access are excluded from V2.

## Outage and revoke behavior

- Control-plane loss prevents new assignments and new consequential lease calls.
- Already-issued offline authority follows WO-08's low-risk, short-expiry rules only.
- A revoke response fences active work; the local supervisor must terminate it and destroy the credential socket.
- Evidence with an old fence, duplicate sequence, bad signature, expired assignment, or wrong account is rejected.
- Runner update manifests are Relay-signed, HTTPS-only, and content-digest pinned. The runner must verify both before replacement.

## Assurance

Registration proves possession of an enrolled key, not host honesty. Verified platform attestation may raise a runner to `attested`, but only through a configured verifier. Self-reported or forged attestation remains `registered`. `managed-equivalent` is unavailable to customer runners in V2.
