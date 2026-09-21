# Local V2 signing qualification checkpoint

Status: **LOCAL QUALIFIED; LIVE V2 KMS NOT_RUN — SEPARATE AUTHORIZATION REQUIRED**.

Branch: `codex/relay-signing-envelope-v2`.
Starting Relay source: `d817c848a7f6797fe04787e28ac96081b69359ae`.
The implementation, fixed vector, reproducible local fixture runner and evidence are committed together. The checkpoint commit and GitHub SHA parity are reported after push. No canonical branch is merged.

## Scope and protocol

Only Federation assertion serialization/verification and public signer version metadata change in product code. Provider transport, Federation grants, Published Knowledge eligibility and local action authority are unchanged. The aggregate protocol cap remains **262,144 characters**, including signature. No database migration. Legacy V1 verification is explicit; all new Federation assertions use V2. V2 is a Relay compact format, not JOSE/JWS EdDSA; receiver rollout remains an explicit gate.

The public-only fixed vector contains exact canonical payload/material, expected SHA-256 digest, canonical signing envelope/hash, public key, signature and complete token. No private key is retained. SHA-256 covers every original canonical compact header/claims byte. Pure Ed25519 signs the reconstructed domain-separated envelope; this is not Ed25519ph.

## Local qualification

| Case | Authenticated material bytes | Token characters | Provider input bytes | Result |
|---|---:|---:|---:|---|
| Small | 1,291 | 1,378 | 406 | PASS |
| Intermediate | 23,193 | 23,280 | 406 | PASS |
| 64K class | 61,925 | 62,012 | 406 | PASS |
| 132K class | 132,893 | 132,980 | 406 | PASS |
| Near maximum | 260,000 | 260,087 | 407 | PASS |
| Exact maximum | 262,057 | 262,144 | 406 | PASS |
| Maximum + 1 | 262,058 | 262,145 prospective | No call | REJECT |

Separate exact-byte unit boundaries exercise 2,048, 65,536, 132,693, 260,000 and 262,057 bytes through local Ed25519 and the simulated Google adapter. Schema-valid Knowledge submission/publication joins are independently checked before signing. The one-byte envelope difference is due only to a fixture key-ID suffix; fixed identity has constant provider input size across payload lengths.

Payload mutations at the beginning/middle/end of maximum content; digest, purpose, signing version, algorithm, public key, key/version identity and protocol mutations; protected metadata tampering; truncation; noncanonical encodings; cross-purpose/domain replay; and V1/V2 downgrade/upgrade substitutions all reject. Invalid signatures do not reach replay/authority claims. Google adapter simulations retain CRC32C and pinned-version/public-key checks. Local simulation is not a provider attestation.

## Regression evidence

- Full serial Relay suite: **314 passed, 5 skipped**, 53 files passed / 3 skipped. Five opt-in browser/Sandbox/managed-provider live tests remain skipped. This is the normal CI suite excluding E2E and performance-only tests; no unrun suite is claimed.
- Federation subset: **117 passed**, 8 files (included within the full total).
- V2-specific suite: **29 passed**, including the fixed vector and schema-valid large fixtures.
- Existing canonicalization, crypto, Federation authorization, policy/approval, Knowledge and execution regressions are included in the full suite.
- TypeScript: PASS. Lint: PASS. Production build: PASS. Migration-order check: PASS.
- Source diff check and targeted source/evidence secret scan are required before commit and recorded in `evidence/signing-envelope-v2/hygiene.json`.
- Tests used a new disposable loopback PostgreSQL cluster on port 55583, with no shared/production database credentials. The initial migration-order invocation lacked a database configuration and was rerun successfully with the explicit loopback URL; no source migration was added.

Raw successful local gate logs and [measurements](evidence/signing-envelope-v2/local.json) are retained. Run the local measurement checkpoint with `node --import tsx scripts/production-qualification/envelope-v2-local.ts`; it makes no remote requests and generates only disposable in-memory Ed25519 keys.

## Proposed live probe — not authorized or executed by this checkpoint

Exact existing key:

`projects/relay-local-qualification/locations/us-east4/keyRings/fq-compatibility-probe/cryptoKeys/fq-ed25519-probe/cryptoKeyVersions/1`

Project number: `1079783030880`. Expected algorithm/protection: `EC_SIGN_ED25519` / `SOFTWARE`.
Expected public PEM SHA-256 from the prior probe: `00daeee3bee0076681d1cd1927fa2a2d30786320e8e344341b0c981b976517e4`.

Plan: **4 signing requests**, for material sizes 1,291 / 132,893 / 260,000 / 262,057 bytes, with provider inputs 406 / 406 / 407 / 406 bytes. **4 exact-version metadata reads** plus **1 public-key read**: 9 KMS API requests total. No retries, alternate keys, provisioning, WIF, hosted app, Railway or database creation. Stop on first failure. Verify every signature through the same canonical verifier and perform tamper tests locally without more KMS calls.

Estimated operation charge: approximately **$0.000015** for four SOFTWARE signing operations plus one public-key retrieval, at $0.03 per 10,000 operations. Version metadata reads are administrative. Existing key-version storage remains approximately $0.000082192/hour ($0.06/month), independent of this probe; logs/network/taxes are additional. This is an estimate, not a billed amount or provider-enforced ceiling. [Google KMS pricing](https://cloud.google.com/kms/pricing).

The supplied work order §54 explicitly says the previous raw-input authorization does not authorize live V2 qualification. A clean committed and pushed SHA, this exact resource binding, request counts and envelope sizes must be approved before a new live request.

## Authority and external status

Federation: **DISABLED**. Grants changed: NO. Published Knowledge boundary changed: NO. Local action authority changed: NO. New cloud infrastructure: NONE. Production changes: NONE. Live KMS operations in this V2 work: **0**. Actual incremental KMS cost: no operations performed; no billing lookup made. Independent security review: NOT_RUN. Production-platform qualification: NOT_RUN.

No `KMS COMPATIBILITY QUALIFIED` claim is made until the separately authorized live V2 checkpoint succeeds. The prior raw-input incompatibility remains a distinct historical FAILED result.
