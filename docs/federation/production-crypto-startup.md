# Federation cryptographic startup

Federation remains disabled by default. `RELAY_FEDERATION_ENABLED=true` still
requires the existing runtime-action deployment gate. No external qualification
has been performed by this change.

Hosted startup now rejects the exportable `managed-secret` backend. It remains
available only to explicit non-production tests/development. There is no local
production key fallback. This supersedes the earlier managed-secret proposal.

For the no-new-service Alpha/Sofie production test, hosted startup also supports
an explicit `vercel-secret` backend. It requires three separate active Ed25519
keys for evidence, federation delivery, and passports, plus a 3072-bit RSA
wrapping key. Operators supply the keys through production-only Vercel Sensitive
Environment Variables: `RELAY_PRODUCTION_SECRET_SIGNING_KEYS_JSON` and
`RELAY_PRODUCTION_SECRET_WRAPPING_KEY_JSON`. This is a deliberate reduction in
key isolation: function runtimes and sufficiently privileged project members
can access the private material, and disabling an old deployment does not revoke
its copy of a key. Keep this path scoped to the approved public-profile test;
rotate keys and public-key pins if exposure is suspected. Missing keys, wrong
algorithms, public/private mismatch, non-production deployments, and incomplete
purpose registries fail closed. The KMS backend remains available for stronger
key isolation when a paid service is acceptable.

`productionCryptoBindings(environment, { keyring, keyWrapper })` composes an
explicit hosted provider when `RELAY_CRYPTO_BACKEND=kms`. Production Node startup
now builds that provider only when federation is explicitly enabled, qualification
mode is off, and the deployment identifies as Vercel production. It pins Relay's
team issuer, team ID, project ID, production environment, and exact subject. The
Vercel OIDC assertion is read from the current request when Google STS is called;
there is no build token, ADC, or environment-token fallback. All of `evidence`,
`federation-delivery`, and `passport` must have an active signer. Missing lease
and workload-session signers fail closed. An unscoped production lease verifier
also refuses to resolve a key.

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

Production public configuration is supplied in `RELAY_PRODUCTION_IDENTITY_JSON`,
`RELAY_PRODUCTION_KMS_PROJECT_ID`, `RELAY_PRODUCTION_SIGNING_KEYS_JSON`, and
`RELAY_PRODUCTION_WRAPPING_VERSIONS_JSON`. It contains the Google workload
identity provider resource, immutable KMS version names, and Ed25519 public-key
pins only. Signing and wrapping versions must belong to the named KMS project.
The runtime assertion remains request-scoped. The qualification path keeps its
separate custom-environment identity and admission controller.

The code path is now wired, but hosted use is not qualified: production currently
has no such provider, key versions, or public-key pins configured. Durable
admission adapters and provider-size verification also remain external gates.
The injected wrapper is a trusted composition dependency; this factory does not
establish that an arbitrary supplied wrapper is remote KMS. Keep federation and
runtime-action flags false until the separate local Alpha ↔ Sofie conversation
test passes and the production resources are provisioned.

Local verification includes purpose/provider tests, PostgreSQL-backed historical
export rotation, complete Relay tests, and a production-build startup smoke that
requires managed-secret production startup to fail. It is not the hosted golden
path and cannot close either external gate.

## Request-scoped qualification composition

The application composes `qualificationCrypto` from instrumentation only when
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

## Production configuration shape

`RELAY_PRODUCTION_IDENTITY_JSON` has the same fields as the qualification identity
except that `environment` is `production` and `customEnvironmentId` is omitted.
The production owner/team, project, issuer, audience, and subject are pinned in
code; only the Google workload-identity provider resource is operator-supplied.
`RELAY_PRODUCTION_KMS_PROJECT_ID` pins the GCP project containing every signing
and wrapping resource. Do not put assertions, OAuth tokens, private keys, or
other credentials in these variables. The current production Vercel project has
none of these KMS settings, so opting into federation fails closed.
