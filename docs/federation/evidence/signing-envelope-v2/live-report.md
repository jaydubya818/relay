# KMS COMPATIBILITY QUALIFIED

Observed 2026-09-21 UTC. The authorized live probe ran against clean branch `codex/relay-signing-envelope-v2` at `68c8d8c92b65f7acfd6993e1714f0d1c1204f6b2`; local and remote SHA parity was verified before the first KMS operation. Source remained unchanged and clean throughout the probe. This subsequent evidence commit does not alter product source.

Exact resource: `projects/relay-local-qualification/locations/us-east4/keyRings/fq-compatibility-probe/cryptoKeys/fq-ed25519-probe/cryptoKeyVersions/1`. Project number: `1079783030880` (owner-verified). Algorithm `EC_SIGN_ED25519`, protection `SOFTWARE`, state `ENABLED`. Every signing operation validated the exact version metadata. The public key matched the previously pinned PEM SHA-256 and its Google CRC32C.

| Authenticated material bytes | Canonical envelope / KMS input bytes | Token characters | KMS API | Request/response CRC32C | Signature bytes | Public key verify | Relay V2 verify | Mutated payload rejected |
|---:|---:|---:|---|---|---:|---|---|---|
| 1,291 | 406 | 1,378 | PASS | PASS/PASS | 64 | PASS | PASS | PASS |
| 132,893 | 406 | 132,980 | PASS | PASS/PASS | 64 | PASS | PASS | PASS |
| 260,000 | 407 | 260,087 | PASS | PASS/PASS | 64 | PASS | PASS | PASS |
| 262,057 | 406 | 262,144 | PASS | PASS/PASS | 64 | PASS | PASS | PASS |

“Payload bytes” in this qualification means the complete canonical authenticated compact header-and-claims material, including the Relay payload. SHA-256 covers those exact bytes. Google received only the canonical, domain-separated V2 envelope, signed with pure Ed25519. The harness checked exact byte equality, digest equality, version, purpose, algorithm and key identity. Each live signature was verified against the pinned public key and through the canonical Relay verifier. A schema-valid payload mutation reusing each signature was rejected as an invalid signature before the replay-claim callback.

Historical V1 raw signing of 132,693 bytes was rejected by Google's 65,536-byte input limit. No V1 request was repeated. V2 passed at 132,893 bytes, 260,000 bytes and the full 262,057-byte authenticated-material boundary. Maximum provider input was 407 bytes. The one-byte variation reflects fixture key-ID length, not payload length. Signing input remains effectively independent of payload size; Relay's 262,144-character contract is unchanged.

Actual KMS operations: 4/4 signing POSTs, 4/4 metadata GETs, 1/1 public-key GET; all returned HTTP 200. Retries 0. Resources created 0. Actual billed operation cost unavailable; approved operation estimate USD 0.000015, excluding existing key storage. No billing query was added.

Digest, version, algorithm and key binding PASS. Domain separation and downgrade protection remain preserved, supported by the prior local qualification. The existing local checkpoint remains applicable: 314 CI tests passed, 5 opt-in live tests skipped; 117 Federation tests and 29 V2 tests passed as subsets. No product source changed during or after this live run.

Federation remained DISABLED. The standalone harness exercised signing/verification functions only: no application server or database was used, no grants changed, no Knowledge was published or its boundary changed, and no local Action authority changed. No deployment, production configuration changes, production KMS operations, merges or further provisioning occurred. Independent security review NOT_RUN. Production-platform qualification NOT_RUN.

Authentication used the previously approved gcloud account mechanism. The access token was captured only in process memory, never printed or persisted by the harness. No Vercel credential was accessed. Evidence contains public metadata, synthetic payload digests, counts and verification results only. `live-harness.mjs` is the exact operator harness retained for audit; its absolute paths and one-run evidence guard intentionally prevent treating it as a general launcher. Do not rerun it without separate authorization.
