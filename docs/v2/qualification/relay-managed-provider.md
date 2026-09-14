# Relay-managed Provider Qualification

Status: locally qualified for the declared V2 profile on 2026-09-13.

## Qualified profile

- Provider: `relay-managed@1.0`
- Lifetime: ephemeral, maximum 3,600 seconds
- Assurance: `registered`
- Maximum data classification: `internal`
- Common isolation claim: `process` (the shell component additionally runs in a locked-down Docker container)
- Network: browser public-only with DNS/IP validation; shell network `none`
- Features: visual browser, click/type/key/scroll/screenshot, shell, bounded file read/write/list/delete, pause/resume, evidence, metering, opaque credential-broker handles
- Explicitly unsupported: persistent desktops, live takeover, private networks, restricted-data execution, highest-assurance hostile code

This deliberately conservative manifest reflects the weakest isolation boundary in the combined local profile. Docker container isolation for shell execution does not justify advertising the browser context as a container or microVM.

## Provenance

- Shell image: `alpine:3.20`
- OCI digest: `sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc`
- Playwright: `1.55.0`
- Chromium: `140.0.7339.16`, Playwright revision `1187`
- Repository lockfile SHA-256: `f71dacb4954660f181d1e3b2e288aaecd1ae9d5409855d12d148416260dd48f9`
- CycloneDX substrate SBOM: `docs/v2/qualification/relay-managed-sbom.cdx.json`

The adapter refuses to initialize without an immutable SHA-256 provenance value and a non-empty SBOM reference. A production build pipeline must replace this local-reference evidence with its signed image attestation; that is a WO-22 deployment gate, not a stronger claim in this qualification.

## Security results

- Docker uses no mounts, no new privileges, all capabilities dropped, PID/CPU/memory/output/time bounds, an isolated workspace, and no network for the qualified profile.
- Browser requests reject non-HTTP(S) schemes except local `data/blob/about` documents, localhost, private/link-local ranges, and DNS resolutions containing private addresses.
- Managed file paths reject traversal, absolute paths, NULs, and empty roots; file payloads are capped at 1 MiB.
- Commands, selectors, text, keys, and scroll deltas are bounded.
- Only `vlt_…` opaque handles cross the provider boundary. Handles are bound to the provider session through a broker and are absent from command environments, action evidence, and result evidence.
- Account, task, and lease bindings are checked for every browser/shell/file action. Revoked authority blocks the next action.
- Termination closes browser context, destroys the container, revokes the credential binding, removes session access, and leaves an idempotent tombstone. Partial cleanup returns reconciliation-required failure rather than claiming success.
- Evidence records operation metadata and hashes; typed text and vault handles are not retained. Meters report computer and compute seconds with stable source IDs.

## Executed evidence

- Focused managed-provider + WO-11 conformance suite: 12/12 passed.
- Live component qualification: 4/4 passed across Playwright context/SSRF, Docker isolation/files/time/output/cleanup, and the combined managed browser/shell/file lifecycle.
- Full repository serial qualification is recorded in `docs/v2-implementation.md`.

## Residual risk

The browser runs as a local Playwright process and is therefore capped at `registered` assurance and `internal` data. Promoting this profile to confidential/restricted or attested/managed-equivalent requires a hardened browser container or microVM, signed build provenance, workload attestation, egress enforcement tests, and an independent security review. Those are not silently inferred from this local pass.
