# Relay dependency security qualification — 2026-10-10

Live registry audit at native receiver parent `7ecb33bc2aa87faad312654bace8152562c63efd` identified 20 advisories: 3 critical, 9 high and 8 moderate. The production subset contained 2 high and 2 moderate. Exact advisory identities, ranges, dependency paths and retained before/after counts are in `advisories.json`. Following the bounded closure, **full `pnpm audit` reports zero vulnerabilities**. No severity override, ignore list, package alias, gate suppression or deployment change was used.

| Path | Remediation | Exposure and compatibility |
| --- | --- | --- |
| next | 15.5.24 → 15.5.27, matching eslint-config-next | Framework SSG/ISR cache defects; patch release. Production image/cache dependencies are fixed rather than relying on current route reachability. |
| next → sharp | 0.35.4 → 0.35.5 | High librsvg issue in image-processing dependency; fixed native package family. |
| next/Vite → postcss → source-map-js | 1.2.1 → 1.2.2 | High indexed-source-map CPU exhaustion; build tooling. Existing source-map-js API retained. |
| Vitest → mocker/tinypool | Vitest 3.2.4 → 4.1.11, Vite 7.3.6 retained/pinned | Development/test runner critical and moderate findings. The mocker finding has no fixed 3.x release; v4 removes the vulnerable tinypool chain. No test assertion or coverage requirement was relaxed. |
| drizzle-kit → esbuild-kit → esbuild | 0.18.20 → 0.25.12 | Development transform/server dependency; migration and build checks exercise compatibility. |
| lint tooling → minimatch → brace-expansion | Fixed 1.1.21 / 2.1.7 / 5.0.12 within their existing major lines | Source/configuration glob patterns; all nine retained advisories addressed. |
| Next lint plugin / TypeScript lint parser → fast-glob → micromatch → braces | TypeScript ESLint 8.42.0 → 8.48.0; exact Next lint plugin patch uses tinyglobby 0.2.17 | `braces` has no released fix in the audit record. The vulnerable chain is physically removed, including installed metadata and lockfile. No package is merely relabeled. |

The exact lint patch, package-resolution hook and 11 adversarial/compatibility regressions originate from read-only inspection of isolated consumer commit `63ede56c41041855dab6de1379f0313ccbf26760`. Only that bounded security patch and tests were adopted; no consumer integration code, credentials or dependency branch was merged. The tests exercise the installed plugin, ordinary paths, symlinks, arrays, brace/globstar patterns and deeply nested malicious patterns, and verify removal of the vulnerable dependency graph.

The engineering Node minimum is now **22.12.0**, as required by the selected Vite 7 toolchain; hosted CI runs Node 24, matching the qualification runtime. Older Node 22.5 engineering environments must upgrade before installing this candidate. Existing execution, authorization, pricing, budget, wire and native receipt contracts remain unchanged. Production integration is not authorized by a clean audit.

Local qualification on Node 24.19.0 passed: full real PostgreSQL suite **524 passed / 6 explicitly skipped live tests**, **2 performance tests**, TypeScript, ESLint, migration consistency, frontier checks and production build. The 11 installed-plugin compatibility/fuzz cases are included in the 524. Skipped live tests are not qualified external execution. No accounting assertions or test timeouts changed.

CI now installs frozen dependencies with lifecycle scripts disabled and runs the complete audit as a blocking check. Final exact-SHA hosted results and full PostgreSQL/build evidence belong to the PR report; this document does not substitute local audit output for hosted qualification.

Primary references: [Next 15.5.27 release](https://github.com/vercel/next.js/releases/tag/v15.5.27), [sharp security advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w), [Vitest 4 migration](https://v4.vitest.dev/guide/migration.html), and the exact advisory URLs in the retained record.
