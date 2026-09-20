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
