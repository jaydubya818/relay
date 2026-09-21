# Signature v2 qualification

**KMS COMPATIBILITY: PASSED_LIVE — VERSIONED COMMITMENT SIGNATURE.**

**NO-GO — EXTERNAL QUALIFICATION PENDING / HOSTED TARGET INCOMPLETE.** Both external gates remain NOT_RUN. Federation defaults remain disabled; there was no deployment, merge, tag, new key, Railway resource or other cloud provisioning.

## Contract and preserved history

See [architecture and alternatives](federation-signature-v2.md). The new identifier is `Relay-Ed25519-SHA256-v2`, version 2, purpose `federation-delivery`. Ordinary Ed25519 signs the 179-byte canonical JSON object containing domain `relay.signature`, version, purpose, hash algorithm `SHA-256` and the lowercase SHA-256 hash of the exact canonical header.payload representation. The header also binds key ID, algorithm, version and purpose; claims bind issuer, audience, request, lifetime, complete payload, publication and authorization context. Trusted key IDs must map immutably to exact KMS versions. Both provider metadata and response are checked against that version.

This is neither standard EdDSA JWS nor Ed25519ph. Legacy raw EdDSA signatures retain their original verifier; new signing emits only v2. There is no cross-format fallback. Existing evidence, Passport and other-purpose signatures are unchanged. New canonical segments reject alternate field order, duplicate keys, whitespace, escaping, invalid UTF-8 and noncanonical base64url. Canonical producers sort object fields, preserve arrays and Unicode code points, and do not normalize strings. The 262,144-character token ceiling and existing field/128-KiB storage limits remain enforced. Oversized knowledge joins now terminally fail with metadata-only signed audit receipts instead of repeatedly blocking polling. Large content continues using checksum-bound artifact references.

The original failed raw-signing result remains preserved at MyEve readiness `2547a4cdc398d3ad90a6c895888e30109eb5a9a0`: 1,091 / 22,993 / 61,725 bytes passed; 132,693 bytes failed with provider maximum 65,536. The new result supersedes compatibility only for v2; it does not make the legacy raw maximum compatible.

## Live probe

Exact existing version:
`projects/relay-local-qualification/locations/us-east4/keyRings/fq-compatibility-probe/cryptoKeys/fq-ed25519-probe/cryptoKeyVersions/1`

SOFTWARE / EC_SIGN_ED25519 / ENABLED. Six synthetic calls; all succeeded. Canonical header.payload sizes were **1,169; 23,071; 61,803; 132,771; 260,000; 262,057 bytes**. Every provider input was **179 bytes** (240 base64 transport characters). The last complete token was **262,144 characters**. Every case verified exact provider version, CRC32C, 64-byte Ed25519 signature, KMS public key, Relay verifier and MyEve verifier. Both verifiers rejected payload-bit, purpose, version and key-ID substitution for every case. Local adversarial tests separately reject altered preimage purpose/version/hash, exact provider-version substitution and wrong-key results; no call was made to an unauthorized key version.

The operator's existing Google authentication was used solely in memory. This does not qualify deployed OIDC/WIF/IAM. No resource was created. Estimated API cost is **$0.000021** for six signs and one public-key retrieval, plus existing key storage (~$0.06/month prorated); actual billed cost unavailable. Source: https://cloud.google.com/kms/pricing.

[Live results](evidence/signature-v2/kms-live.json), [reproducible probe](../../scripts/qualify-signature-v2.mjs), [regression evidence](evidence/signature-v2/regressions.json), [performance](evidence/signature-v2/browser-performance.json), [local simulation](evidence/signature-v2/three-worker-simulation.json).

## Verification and checkpoints

- Relay full regression: **312 passed / 5 disclosed existing external-provider skips**; 54 passing files and 3 skipped files.
- Adversarial v2: **24 passed** (included above); historical audit and controller admission add seven targeted passes (also included).
- Local performance: **2 passed**. Browser: **2 functional + 1 production performance test**, nine routes; maximum p95 **162.813125 ms <200 ms**.
- Typecheck, lint, production build, Drizzle consistency, fresh migration application and V1/V2 frontier: PASS.
- MyEve adapter: **71 passed**, including referenced-content hash mismatch before storage; peer TypeScript: PASS.
- Controller: **61 Node + 15 Python passed**. Local three-worker simulation: **13 passed**, all eight stop adapters VERIFIED, restart denied after stop, complete cleanup. Simulation uses local signers and mocked inference, not hosted gates; the KMS probe separately uses real Google KMS.

Published Relay checkpoints (remote parity checked after each): design `3a76ffccc5273b7f9807ea2700ae8833e202a8c1`; implementation `11a6964861b135e2f6ae038555591cffe0867a72`; adversarial/history `d4fcf48ec4cf45e5721326e36251c81bf611b88b`; live evidence `c30250ef1ac154b80765c617c83ed371cc57391e`. Final evidence is a separate descendant commit. Branch: `codex/myeve-federation-preprovision` in `jaydubya818/relay`.

MyEve dual verifier is published separately on `codex/myeve-federation-production-readiness` (`e4a4830e0fd5bb7180ede5ff90c58c4bd180ddc1`). The complete tested delta from engineering base `a1aa73ba75cd400c3046bae3d452de35377431f2` is preserved as `evidence/signature-v2/myeve-candidate.patch` on that readiness branch. Its older product baseline does not contain the full hosted runtime; it must not be deployed as a substitute for the engineering candidate.

## Remaining blocker and independent review

The full tested MyEve candidate `6d8dd369eaf8f21ca7c8cab042c9ba429c0e54fa` cannot be pushed because its pre-existing ancestry lacks `7852287e1c5f8eb14119d9e8accdf174d27eeb69`. No history was rewritten. [Source hashes](evidence/signature-v2/peer-source.json) and the published migration patch preserve the entire tested change. Restore the missing ancestor, publish and verify the full candidate, then refresh frozen worker source manifests before calling the hosted target ready for provisioning. Existing frozen packages still refer to pre-v2 sources and must not be deployed with this result.

There are no observed v2 protocol, runtime or regression failures in the tested candidates. Reproducible full-candidate publication/package refresh remains an engineering readiness blocker. The independent assessor must receive the new version contract, both verifiers, original failure, live success, negative vectors and exact frozen source/package from a separate context. Review downgrade/purpose confusion, canonicalization, trust-store version mapping/rotation/revocation and commitment admission. Implementation evidence does not pass independent security. Independent security: NOT_RUN. Production-platform qualification: NOT_RUN. General federation enabled: NO.
