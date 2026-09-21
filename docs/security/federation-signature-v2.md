# Federation signature v2 decision and execution plan

Status: implementation candidate; federation disabled; independent security and production-platform qualification NOT_RUN.

## Permanent failed qualification

At Relay d817c848a7f6797fe04787e28ac96081b69359ae the unchanged raw-message protocol signed 1,091, 22,993 and 61,725 bytes in Google KMS. A valid 132,693-byte input failed INVALID_ARGUMENT (maximum 65,536). Near-limit 260,000 and maximum 262,057 were not sent after the mandatory stop. The original evidence remains in MyEve readiness commit 2547a4cdc398d3ad90a6c895888e30109eb5a9a0. The old contract cannot support its full valid envelope range in this provider.

## Alternatives

| Option | Integrity and compatibility | Migration and historical verification | Delivery, knowledge and artifacts | KMS and operations | Security review |
|---|---|---|---|---|---|
| A: reduce signed input to <65,536 | Raw Ed25519 unchanged; rejects formerly valid envelopes | Old signatures remain valid; producer limits break large clients | Escaped messages and knowledge projections fail; references needed sooner | Works with existing key; simple but functionality loss | Review rejection, paging and request lifecycle changes |
| B: versioned canonical commitment | SHA-256 collision resistance plus Ed25519; explicit different wire format | Dual verifier; new producer only; original evidence unchanged | Existing bounded content capacity retained; artifacts still hash-bound references | Fixed small preimage, same key/provider, no new infrastructure | Review domain, downgrade, canonicalization and cross-platform vectors |
| C: bounded manifest with external content | Hashes bind content if every fetch verifies them | New storage/fetch, expiry, access and availability contract; legacy verifier retained | Natural for large artifacts; adds retrieval to ordinary knowledge/message flow | Small signatures but storage and availability dependencies | Larger access-control, SSRF and lifecycle surface |
| D: other provider/algorithm | Raw Ed25519 only preserves current contract if provider supports full input; changing algorithm needs versioning | New custody/identity integration; retain old public keys | Current capacity possible only after provider qualification | New provider, credentials, billing and operational trust; no such provisioning authorized | New custody/provider review plus protocol review if algorithm changes |

Select B, retaining existing artifact references for large content. It preserves useful bounded delivery behavior with less new trust and runtime machinery than C/D; A unnecessarily shrinks existing functionality. This is a protocol change, never an adapter that silently hashes legacy messages.

## Exact contract

New header: `{alg:"Relay-Ed25519-SHA256-v2",typ:"relay-federation+digest",kid:<purpose-specific-key-id>,v:2,purpose:"federation-delivery"}`.

Wire form remains three unpadded base64url segments: header.payload.signature. It is a Relay-specific signed token, NOT standard EdDSA JWS and NOT Ed25519ph. Header and claims use existing Relay canonicalJson: sorted UTF-16 object keys, JSON.stringify primitive escaping/finite-number rendering, ordered arrays, no Unicode normalization. New verification requires exact canonical UTF-8 reserialization and canonical base64url; duplicate fields, whitespace variants, invalid UTF-8 and alternate escaping are rejected. Legacy verification retains its original bytes/semantics.

Let M be ASCII `base64url(canonicalHeader) + "." + base64url(canonicalClaims)`. Sign UTF-8 canonicalJson of `{domain:"relay.signature",version:2,purpose:"federation-delivery",hashAlgorithm:"SHA-256",payloadHash:lowercaseHex(SHA256(M))}` with ordinary Ed25519. Fixed-length fields make KMS input independent of envelope size. Both header and claims, including key ID, issuer/audience, request identity, expiry, authorization and publication, are committed. There is no caller-supplied digest to trust. Purpose and version are bound in both header and signed preimage.

A strict header discriminator selects legacy raw EdDSA or v2 exactly once. Unknown/altered formats fail closed; no fallback, guessing, downgrade negotiation or legacy production signing option. Deploy dual-verifier peers before enabling the new producer; old peers refuse new tokens. Existing evidence/Passport/lease/session signatures are not reinterpreted or migrated. Those domains retain separate keys and contracts. Existing trusted-key resolver remains the trust anchor; retired/disabled public keys permit historical verification, revoked or unknown keys do not. No private key is exported. Application admission binds the actual new preimage and exact provider version.

## Resource limits and oversized knowledge

Keep the 262,144-character complete token ceiling (262,057 bytes before signature). Keep existing field limits: message body 16,000 UTF-16 code units, subject 200; work task 4,000 and expected output 1,000, ten references; knowledge <=50 records, content <=16,000 each and answer <=16,000, additionally the existing 128-KiB encrypted-result ceiling; artifact metadata references <=255, name <=200, URL <=2048, referenced content <=10 MiB with SHA-256. Escaping/UTF-8 aggregate limits apply in addition to field counts. Do not truncate signed data or silently turn partial results into complete answers.

Submission and publication documents remain <=128 KiB canonical UTF-8 each. An individually valid knowledge projection can combine with a query to exceed the token limit. Detect before provider signing, terminally fail that request without delivery, and continue polling other requests. A smaller query/maxRecords or an existing artifact transfer must be explicitly requested. Responses exceeding the result ceiling fail before storage. No unbounded envelopes or automatic external fetches.

## Five green checkpoints

1. This decision and legacy regression tests, pushed with parity.
2. Explicit v2 producer/verifier, negative tests and bounded failure lifecycle.
3. Historical verification and peer migration tests/documentation; peer support is required for hosted readiness.
4. Bounded live probe using only the existing key version: representative, escaped intermediate, near-limit and exact maximum; verify CRC, exact version, signature, canonical verifier and mutation denials. No resource creation.
5. Full regression and sanitized evidence, pushed with parity. Keep NO-GO and both gates NOT_RUN. Independent assessor receives frozen source and vectors after implementation; implementation tests cannot pass that gate.

Sources: RFC 8032 (ordinary Ed25519 vs Ed25519ph), https://www.rfc-editor.org/rfc/rfc8032; canonicalization reference RFC 8785, https://www.rfc-editor.org/rfc/rfc8785 (Relay's existing implementation remains the normative contract, not a new JCS claim); Google algorithm contract https://docs.cloud.google.com/kms/docs/algorithms. Live failure, not a mock, establishes this provider's message limit.
