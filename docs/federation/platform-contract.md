# Platform-neutral federation adapter contract, version 1.0

MyEve is the reference consumer; no MyEve repository changes are included. Any platform can implement this contract.

## Enrollment and publication

1. Use existing Relay owner authentication, Agent creation, Passport issuance, activation, and credential issuance. Credentials are shown once and stored as hashes by Relay. Federation registration is OWNER-only.
2. `POST /api/v2/operator/federation` accepts `{operation, input?, id?}`. Operations: `register`, `publish`, `grant`, `revoke-grant`, `availability`, `publication-status`, `invalidate-reference`, `relationship`. It uses the authenticated dashboard identity and same-origin protection; it never takes caller account/principal identity from JSON.
3. Publication input follows `lib/v2/federation/contracts.ts`. Send only explicitly published profile metadata and opaque record references. Store canonical content locally. Each update supplies `expectedVersion`; stale concurrent updates fail with 409.
4. Snapshot versions contain explicit fixed membership. Dynamic versions additionally require an owner-defined rule and per-entry `EXPLICIT_POLICY_ELIGIBLE` metadata satisfying that rule. Publication updates remain explicit owner operations in this release. No LLM topic classifier or background private-store crawler is installed.
5. Before/when deleting canonical content, invalidate its references through the owner endpoint and make the local projection reader reject the deleted record immediately.

## Agent endpoint

`POST /api/v2/federation` uses `Authorization: Bearer <Agent credential>` with bounded JSON:

| Operation | Body |
| --- | --- |
| Submit | `{ "operation": "submit", "input": <submissionSchema> }` |
| Poll | `{ "operation": "poll" }` |
| Read result | `{ "operation": "get", "requestId": "frq_…" }` |
| Respond | `{ "operation": "respond", "requestId": "frq_…", "input": { "status": "ACCEPTED" } }` |
| Complete | Same respond envelope, with `status: "COMPLETED"` and protocol-specific `result` |
| Purge received content | `{ "operation": "acknowledge", "requestId": "frq_…" }` |
| Discover | `{ "operation": "discover", "input": { "topic": "verification", "after": "" } }` |

Other response states are `REJECTED`, `REQUIRE_APPROVAL`, and (after acceptance) `RUNNING`. Local approval waiting stops Relay delivery retries. The target must explicitly accept before completing. Results are available only to the exact caller Agent, never all Agents of its owner. Reusing an idempotency key with a different submission fails.

## Authenticity and local authorization

Polling returns compact EdDSA JWS tokens. Use `verifyDelivery` with a trusted issuer, exact registered Agent audience, a configured trusted key resolver, and an atomic durable request-claim implementation. Never trust a key supplied in the request. Persist claims through at least the envelope's request expiry plus the platform's replay retention window; the assertion's short JWT expiry is not the execution deduplication lifetime. If a request was already claimed, return/reuse its persisted local receipt, never execute again.

The envelope is `relay.federation`, version `1.0`, with authenticated caller/target, capability, resource, request identity, timestamps, idempotency key, payload, publication projection where relevant, and non-secret authorization references. Relay request ID is the cross-owner identifier. A platform-local Run ID remains local and does not replace it.

Verify Relay authenticity, independently authorize locally, then accept/reject or require local approval. Do not use an incoming envelope as a local execution lease. Never map an external work request to email send, spend, production writes, deletion, owner publication, or an unrestricted local Agent invocation.

## Knowledge boundary

`answerPublishedQuery` is the reference projection adapter. Its only reader is `PublishedProjectionReader.readPublished({viewId, version, reference, revision})`. That implementation must check local publication eligibility, version, deletion, and authorization before returning a record. It must not expose general search or private memory APIs.

Record retrieval does not require synthesis. Optional synthesis receives only the untrusted query and records from that projection. Run it without private-memory retrieval, conversation history, goals, connected accounts, hidden context, or privileged tools. Its output is marked `PUBLISHER_AGENT_SYNTHESIS`; raw records are marked `OWNER_PUBLISHED_KNOWLEDGE`. Responses cannot contain hidden reasoning or undeclared fields. Relay checks reference, revision, type, version, and bounds, but cannot inspect the security internals of an independently operated platform.

## Work and artifacts

Work context consists only of prior authorized artifact-share request IDs, not arbitrary file paths. The local adapter must enforce runtime cancellation, model-step ceilings, cost limits, allowed tools, and zero delegated workers. Return summary, artifact references, evidence references, exact decimal cost, measured runtime/steps, and provider receipt references. Relay reconciles existing cost budgets; usage reports are receiving-platform attestations.

Artifact sources must issue expiring audience-bound retrieval, check authorization at access time, and enforce deletion/revocation locally. Receivers must apply their own network restrictions and validate size/checksum. Relay supplies no SSRF-capable fetch proxy.

## MCP and retention

`POST /api/v2/federation/mcp` adapts the same service. Tools include discovery, knowledge query, send message, request work, share artifact, get request, respond, poll inbox, and acknowledge result. MCP is not the canonical protocol.

Acknowledge results once persisted locally. This deletes Relay's bounded delivery content; minimal request metadata and both owners' signed disclosure receipts remain. Unacknowledged payloads expire within the request's bounded lifetime. Revocation prevents future Relay retrieval and does not promise erasure of information already delivered to a different owner.
