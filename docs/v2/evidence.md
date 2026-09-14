# Relay V2 Evidence and Audit Substrate

WO-04 provides the evidence primitive used by every later V2 service. It is additive and does not replace or mutate V1 activity records.

## Audit records

Audit records are account-scoped, canonicalized, hash-chained, and signed. A PostgreSQL transaction-scoped advisory lock serializes appends for one account while allowing independent accounts to append concurrently. The chain head and record are updated atomically. Record details pass through deterministic redaction before hashing or persistence.

Signing is an interface. The local Ed25519 implementation is test/development-only and refuses to initialize in production; hosted deployments must bind the interface to a KMS or HSM. Exports include the public keys required to verify historical records across signing-key rotations. `verifyAuditBundle` has no database or Relay service dependency and is the reference offline verifier.

## Evidence artifacts

Artifact plaintext is encrypted with a unique AES-256-GCM data-encryption key. The data key is wrapped with an account-bound key wrapper and only ciphertext is sent to object storage. Object references are namespaced by account, but authorization never relies on the path: every read and deletion first performs an account-scoped metadata lookup.

Structured JSON evidence must use `storeEvidenceJson`, which redacts before serialization and encryption. Opaque binary capture producers are responsible for applying their domain redaction pipeline before calling `storeEvidenceArtifact`; later WorkOrders must prove this for any new capture type.

The local RSA wrapper and in-memory object client are test/development adapters and are not production credential storage. Production binds the interfaces to account-scoped KMS wrapping and private object storage.

## Retention and deletion

`retentionUntil` is enforced before deletion. Deletion is tenant-scoped, removes the ciphertext, and tombstones metadata. Legal hold is intentionally excluded from V2 WO-04. Production lifecycle processing must invoke the same retention rule and emit an audit record around deletion orchestration.

## Isolation obligation

WO-04 adds audit and object/artifact boundaries. Focused negative tests prove that an account cannot list another account's audit records, unwrap another account's artifact key, read another account's artifact, or delete it. These tests become part of the complete WO-22 cross-boundary suite.
