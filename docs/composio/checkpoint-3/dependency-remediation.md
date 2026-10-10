# Baseline dependency advisory investigation

Investigated 2026-10-10 against Relay `35300e8da774e2e521dc8892d7fbc776a0bc0fa6`. Refreshed `pnpm audit --prod --json` reports **2 high, 2 moderate, 0 critical** across 114 production dependencies. Nonzero audit exit is the vulnerability finding, not a test infrastructure failure. No packages were installed or upgraded.

The lockfile and `pnpm why --prod` put all four advisories under the unchanged Next.js dependency path. Comparison with pre-Composio baseline `403411394fe5641b95d1a53db7f231147ec850f9` confirms these affected resolutions predate the adapter. The pinned Composio SDK does not introduce another path to these packages. This does not certify the SDK dependency tree or future advisory coverage.

| Advisory | Severity; installed path | Prerequisites and observed Relay exposure | Minimal candidate |
|---|---|---|---|
| [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), CVE-2026-93749 | High; Next 15.5.24 → PostCSS 8.5.23 → source-map-js 1.2.1 | Malicious indexed source-map offsets can block the event loop. PostCSS imports SourceMapConsumer and processes CSS source maps. No application request path feeds provider content to this processor; untrusted build CSS/maps remain relevant. | source-map-js 1.2.2 |
| [GHSA-wq5f-xc86-pv6w](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w), advisory title CVE-2026-96889 | High; Next 15.5.24 → sharp 0.35.4 | librsvg memory flaw can permit RCE under runtime-specific conditions on glibc Linux. No direct sharp/next-image use was found in application code. Next defaults reject SVG before decoding, with no configured remote patterns or SVG enablement. This narrows exposure but is not proof against every decoding/sniffing path. Production OS, binary hardening and global libraries were not inspected. | sharp 0.35.5; verify bundled/global librsvg 2.63.2 |
| [GHSA-4jqv-mc3x-m676](https://github.com/vercel/next.js/security/advisories/GHSA-4jqv-mc3x-m676), CVE-2026-94543 | Moderate; Next 15.5.24 | Self-hosted Pages Router with SSG/ISR permits shared cache substitution. Relay uses App Router, has no Pages Router source or getStaticProps, and catalog data is session/database dependent. Listed prerequisites were not found. No production exploit was attempted. | Next 15.5.27 |
| [GHSA-mcj8-r9mp-w47p](https://github.com/vercel/next.js/security/advisories/GHSA-mcj8-r9mp-w47p), CVE-2026-94484 | Moderate; Next 15.5.24 | Root-level catch-all SSG/ISR cache poisoning. No root catch-all page or relevant static generation was found. Composio catalog adds neither prerequisite. | Next 15.5.27 |

Severity labels are advisory classifications, not an assessment that Relay is exploitable. Current web advisory CVSS v4 values and retained audit CVSS v3 values differ; an absent audit score is not zero severity. High-severity parser updates remain the remediation priority despite limited observed reachability.

Evidence checked: `package.json`, `pnpm-lock.yaml`, Next image configuration/optimizer source, PostCSS previous-map source, application routes/imports, and local prerender route names. Default image optimizer presence is not denied merely because no component imports next/image. Provider tool schemas/results are never passed to image decoding or source-map processing in this integration.

## Minimal proposal — NOT APPLIED

1. Pin `dependencies.next` from `15.5.24` to `15.5.27`; align `devDependencies.eslint-config-next` to `15.5.27`.
2. Change existing `pnpm.overrides["next>sharp"]` from `0.35.4` to `0.35.5`.
3. Add narrow `pnpm.overrides["postcss>source-map-js"]: "1.2.2"`; retain PostCSS `8.5.23`.
4. Regenerate and review only the necessary lockfile closure. Preserve Composio `0.22.0`, client `2.0.0-rc.8`, React and unrelated dependencies. Reject incidental broad version movement. No dependency merge is included in this proposal.

The official [Next 15.5.27 release](https://github.com/vercel/next.js/releases/tag/v15.5.27) names both cache fixes, resolving placeholder patch numbers still visible on some maintainer advisory pages. The [source-map-js 1.2.2 release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2) confirms the parser fix. Sharp's linked maintainer advisory confirms 0.35.5 and librsvg 2.63.2. These are exact proposed patch versions, not a recommendation to install unbounded latest versions.

Qualification after separate dependency review: frozen-lockfile install in a clean hosted checkout; inspect package integrity/provenance and actual sharp runtime library versions; fresh production audit; all 27 frozen groups; typecheck/lint/build; real PostgreSQL security/integration suites; owner/catalog browser and accessibility journeys; relevant image rejection and cache routing regressions. Do not enable SVG as a workaround or alter policy/runtime authority. Retain rollback to the accepted dependency lockfile, without claiming that rollback removes the advisories.

No new exposure from Composio to these four vulnerable paths was identified. The independent SDK descriptor finding IR-1 is a separate adapter concern, not one of these package advisories.
