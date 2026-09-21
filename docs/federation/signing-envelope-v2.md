# Relay Federation signing envelope V2

Some remote Ed25519 signing providers impose raw-message limits below Relay's valid token size. The qualification Google Cloud KMS key rejected a 132,693-byte raw input with a 65,536-byte provider limit. V2 authenticates the complete canonical assertion through a small, provider-neutral digest envelope. Federation stays disabled by default; this format does not grant execution authority.

## Wire format and version selection

A V2 assertion is `base64url(canonical(header)).base64url(canonical(claims)).base64url(signature)`, without padding. The header is a strict object:

```json
{"alg":"Ed25519","keyVersion":"immutable-version-identity","kid":"immutable-key-id","typ":"relay-federation-v2"}
```

This is a Relay compact assertion, **not a standard JOSE/JWS EdDSA assertion**. Its signature operation is different from JWS. `signDelivery` explicitly selects V2 for every newly produced assertion, including small ones. It never selects a format by length. The Federation business envelope remains `protocol: relay.federation`, `version: 1.0`; that business schema version is separate from signing-envelope version 2.

The claims retain issuer, audience, request ID, issued-at time, expiry, and the entire Federation envelope. The unchanged `canonicalJson` routine sorts object keys using JavaScript's existing ordering, preserves array order, rejects unsupported/non-finite values, and uses JSON string escaping and number representation. It does not normalize Unicode: composed and decomposed strings remain different authenticated values. Empty values, escapes, whitespace inside strings, and large strings are preserved.

## Exact authenticated bytes

Let `M` be the UTF-8 bytes of the first two canonical base64url segments joined with one ASCII period. Compute `D = SHA-256(M)`, encoded as 64 lowercase hexadecimal characters. Hash the **original canonical compact representation**, never pretty-printed JSON or a parsed/re-serialized approximation.

Construct this strict envelope, serialize with `canonicalJson`, and encode as UTF-8:

```json
{"keyIdentity":{"id":"immutable-key-id","version":"immutable-version-identity"},"payloadDigest":"<64 lowercase hex characters>","payloadDigestAlgorithm":"SHA-256","protocol":"relay.federation","purpose":"federation-delivery","signingAlgorithm":"Ed25519","version":2}
```

The envelope is deterministically reconstructed from the protected header, the complete claims segment, and the fixed V2 contract; it is not redundantly transmitted. Verification recomputes its digest and verifies the resulting envelope. A payload/envelope mismatch therefore fails the same signature check as an altered digest. No unauthenticated digest supplied by a caller is accepted.

Use **pure Ed25519 over these canonical envelope bytes**. This is not Ed25519ph, an Ed25519 digest-mode API, or signing bare digest bytes. [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032.html#section-4) distinguishes the algorithms. The SHA-256 construction is an explicit Relay application protocol.

## Provider neutrality and identity

Both the local/reference signer and `SigningKeyring` receive exactly the same envelope bytes through `AuditSigner.sign`. Google KMS sends these bytes in its raw `data` field, with CRC32C over those actual bytes. Existing exact enabled-version metadata, SOFTWARE/EC_SIGN_ED25519 checks, 64-byte signature validation, response CRC32C and pinned-public-key verification remain in place. The full assertion is never the provider signing input.

`AuditSigner.keyVersion` supplies an immutable version identity. Reference signers use their unique key ID; production keyrings supply their configured exact provider version. Protocol fields are opaque generic identifiers, not Google resource parsers. A key ID must not be rebound to a different version. `trustedPublicKey(keyId, keyVersion)` must resolve an exact trusted binding; an ID-only registry is safe only when IDs uniquely and immutably identify versions. Key identity is never an instruction to fetch an arbitrary URL.

## Canonical verification and compatibility

`verifyDelivery` remains the single canonical verification entry point:

1. Enforce the unchanged total token bound and segment count.
2. Dispatch on an explicit known format identifier. V2 requires the exact V2 algorithm/header schema.
3. Require canonical unpadded base64url, valid UTF-8 and exact canonical JSON for both V2 segments. Reject duplicate keys, alternate property ordering, added JSON whitespace and lossy decoding.
4. Resolve the trusted exact key/version, require Ed25519, reconstruct the digest envelope from the original segments, and verify the canonical 64-byte signature.
5. Apply the unchanged issuer, audience, lifetime, envelope/submission schema and atomic replay-claim rules. Invalid signatures never reach the claim callback.

Legacy V1 `typ: relay-federation+jwt`, `alg: EdDSA` tokens remain readable through their explicit raw-JWS verification branch. New V1 issuance is not exposed. Failed V2 verification never retries V1. Substituting the format header changes both the authenticated material and the signature interpretation, so upgrade/downgrade substitution fails.

This is a wire-format rollout: receiving platforms must explicitly support V2 before Federation is enabled. No automatic version negotiation, silent fallback, canonical branch merge, production rollout, or MyEve receiver qualification is implied by this Relay-only change. Other artifact formats (audit records, passports, leases) retain their existing contracts.

## Bounds and evidence

The full token remains at most **262,144 characters**. A 64-byte Ed25519 signature is 86 unpadded base64url characters, leaving **262,057 bytes** for `M` and one separating period. Maximum-plus-one fails before invoking the signer. Header metadata consumes part of this existing aggregate bound; no additional allowance is added and the aggregate cap is not reduced.

Digest size is always 32 bytes. Provider input depends only on bounded identity metadata, never payload length. The implementation rejects envelope input above 8,192 bytes; qualified fixtures using the exact planned KMS version produce **406–407 bytes** (the one-byte difference is a fixture key-ID suffix). The same identity produces identical input size for every payload size.

See [fixed public-only vector](vectors/signing-envelope-v2.json), [local measurements](evidence/signing-envelope-v2/local.json), and [security analysis](signing-envelope-v2-security.md). No migration is required because the existing opaque token column carries the explicit new header. Grants, Knowledge privacy and local Action Gateway authority are unchanged.
