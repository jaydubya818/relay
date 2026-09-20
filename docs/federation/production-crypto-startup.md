# Federation cryptographic startup

Federation remains disabled by default. `RELAY_FEDERATION_ENABLED=true` still
requires the existing runtime-action deployment gate. No external qualification
has been performed by this change.

Hosted startup now rejects the exportable `managed-secret` backend. It remains
available only to explicit non-production tests/development. There is no local
production key fallback. This supersedes the earlier managed-secret proposal.

`productionCryptoBindings(environment, { keyring, keyWrapper })` composes an
explicit hosted provider when `RELAY_CRYPTO_BACKEND=kms`. All of `evidence`,
`federation-delivery`, and `passport` must have an active signer. Missing lease
and workload-session signers fail closed. An unscoped production lease verifier
also refuses to resolve a key. Normal startup has no composed KMS provider yet
and therefore remains unavailable when federation is opted in.

The Google KMS provider sends the exact UTF-8 signing input in `data`, never
`digest`. It checks version identity/state/algorithm/protection, CRC32C, signature
length, and the public-key signature. Provider errors are sanitized; it performs
no retry or alternate-key fallback. Local contract tests use a simulated provider,
not Google keys or an assertion of Google's maximum accepted request size.

The immutable public registry binds key ID, provider version, purpose, algorithm,
activation, retirement and revocation metadata. Rotation changes the registry,
not the existing signed-message format. Exports use the explicitly selected active
evidence signer and include historical public keys. `verifyAuditBundle` preserves
the existing offline integrity contract; `verifyAuditBundleWithLifecycle` adds a
trusted registry and timestamp/purpose/revocation checks. Bundled public keys by
themselves do not establish independent trust or current revocation status.

A retired or administratively disabled key can verify retained historical evidence.
A compromised/revoked key is rejected by lifecycle verification, including old
signatures; retain affected evidence for investigation rather than declaring it
trusted. Revocation requires its timestamp. Unknown keys and algorithm/purpose
mismatches fail closed. Private signing never selects a historical key.

Rotation procedure: close qualification admission, disable the previous provider
version and verify that state, install a registry with the previous public key
retired and the new version active, restart every signing process, then reopen
only after operator validation. Old public keys survive the 30-day synthetic
retention period. Do not overlap private signing rights across old/new deployments.
KMS disablement is required to fence processes still holding an old registry.

Still required before hosted use: request-scoped Vercel OIDC → Google STS binding,
real KMS versions/public-key pins, the account-bound KMS envelope wrapper,
qualification-only identity policy, durable admission adapters, and provider
size verification. The injected wrapper is a trusted composition dependency;
this factory does not establish that an arbitrary supplied wrapper is remote KMS.

Local verification includes purpose/provider tests, PostgreSQL-backed historical
export rotation, complete Relay tests, and a production-build startup smoke that
requires managed-secret production startup to fail. It is not the hosted golden
path and cannot close either external gate.

## Request-scoped qualification composition

The candidate now composes `qualificationCrypto` from instrumentation only when
both federation and qualification flags are explicitly true. It requires Vercel's
`federation-qualification` custom environment and the pinned Relay project/team.
Public configuration variables are `RELAY_QUALIFICATION_IDENTITY_JSON`,
`RELAY_QUALIFICATION_SIGNING_KEYS_JSON` (public SPKI registry only), and
`RELAY_QUALIFICATION_WRAPPING_VERSIONS_JSON`. Actual resource IDs must be supplied
by the operator after provisioning approval. Do not put credentials in these JSON
values. STS reads the current request's OIDC header; no ADC or environment token
fallback is used. KMS key-level roles include metadata reads on signing and
wrapping versions.

The wrapper authenticates owner and immutable key version through symmetric KMS
AAD, recording the version inside opaque wrapped-key data. Retired enabled
versions can decrypt; disabled/revoked versions cannot. The producer refuses
compact JWS tokens above 262,144 characters before signing.

This composition is **not approval to deploy or enable qualification**. Maximum
raw Ed25519 request compatibility is unverified, and controller enforcement still
needs integration into the origin/provider paths. Both external gates remain
NOT_RUN. Keep flags false until those engineering prerequisites and explicit
hosted authorization are satisfied.
