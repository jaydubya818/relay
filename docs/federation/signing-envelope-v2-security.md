# Signing envelope V2 security analysis

This is the implementation team's bounded protocol analysis, **not an independent security review**. Independent review and live V2 KMS qualification remain NOT_RUN. Federation remains disabled.

| Concern | Analysis and qualification |
|---|---|
| Second preimage / collisions | Every canonical header/claims byte contributes to SHA-256. Substituting an already-signed payload requires a second preimage or signature forgery; adversarial preselected pairs also require collision resistance. Ideal SHA-256 second-preimage and collision strengths are 256 and 128 bits respectively. This construction adds reliance on SHA-256 collision resistance compared with directly signing arbitrary raw messages; it is not claimed cryptographically identical to raw Ed25519. No application hash truncation occurs. |
| Domain separation | The Ed25519 message explicitly binds `relay.federation`, signing version 2, purpose `federation-delivery`, SHA-256 and Ed25519, plus key identity. Tests reject otherwise valid signatures over envelopes for another protocol or purpose. |
| Canonicalization ambiguity | Existing Relay canonical JSON is used unchanged. V2 verification rejects alternate byte encodings, duplicate keys, ordering changes, whitespace and invalid UTF-8. Hashing uses the original validated compact representation. Unicode normalization is intentionally absent. |
| Version / downgrade confusion | Distinct strict V1 and V2 headers; no try-V2-then-V1 fallback. The same signature cannot survive header substitution. Both explicit legacy reading and upgrade/downgrade rejection are tested. |
| Algorithm confusion | V2 requires exact Ed25519 metadata, an Ed25519 public key and canonical 64-byte signature. An alternate signed algorithm envelope and modified protected algorithm are rejected. Google metadata algorithm/protection checks are unchanged. |
| Key confusion | Both immutable key ID and version are signed, including inside the digested protected header. Trust resolution remains out of band. Tests reject wrong public keys, version bindings and altered identities. Operators must not remap an ID or resolve keys from attacker-selected endpoints. Existing ID-only resolver callbacks require immutable per-version IDs. |
| Cross-purpose replay | A signature for a passport/other domain does not verify as a Federation delivery, even when made with the same test private key. Issuer, audience, expiry and atomic replay claims remain mandatory after cryptographic verification. |
| Truncation / mismatch | Full material is hashed; no chunks or prefixes are signed independently. Maximum-sized first/middle/last content mutations, changed digest envelopes and truncated signatures fail. Maximum-plus-one invokes no signer. |
| Provider transport | Local KMS-adapter tests exercise exact raw envelope bytes, request CRC32C, metadata identity/algorithm/protection, returned version, response CRC32C and pinned public-key verification. These are simulations, not a live attestation. |
| Secret material | Protocol metadata includes only public identity, algorithm and digest. Fixed vectors retain public keys/signatures only; disposable vector private material was never persisted. Test credentials are named synthetic literals. |
| Authority | This patch changes signing representation only. No grant, policy, publication, Action Gateway, Federation enablement or database migration is changed. Full local authority/Federation regressions remain required. |

## Residual gates

1. Independent cryptographic/security review has not run.
2. A fresh, separately authorized live V2 probe must verify the committed source against the exact existing qualification key. The old raw-input probe neither qualifies V2 nor authorizes new calls.
3. Receiving platforms, including MyEve, must adopt the explicit V2 format before any Federation rollout. Keeping legacy tokens readable does not make a V1-only receiver accept V2.
4. Trusted key registries must enforce immutable ID/version mappings and their existing revocation policy. No trust is derived from an embedded key identity.

No live V2 compatibility or production-readiness claim is made by this analysis.
