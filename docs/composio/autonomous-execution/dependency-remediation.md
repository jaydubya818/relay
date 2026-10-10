# Dependency remediation: remove the vulnerable glob implementation

The remaining `braces@3.0.3` advisory, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), has no published fixed release. The preceding parser patch remains in `patches/braces@3.0.3.patch` and historical evidence; its registration is removed because the package is no longer an installed dependency. No finding is ignored or reclassified.

## Exact correction

- Upgrade only the TypeScript ESLint family from `8.42.0` to `8.48.0`. This is the first upstream minor release that [replaces fast-glob with tinyglobby](https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.48.0), through [upstream PR 11740](https://github.com/typescript-eslint/typescript-eslint/pull/11740).
- Preserve `@next/eslint-plugin-next@15.5.27` and its original registry tarball/integrity. A pnpm source patch replaces its sole `fast-glob` call, in `dist/utils/get-root-dirs.js`, with `tinyglobby@0.2.17`, which was already in the lockfile. The patch also updates the installed package manifest.
- `.pnpmfile.cjs` changes only that exact Next plugin release's dependency edge to match the source patch. This is pnpm's documented [readPackage hook](https://pnpm.io/pnpmfile). It does not rename or alias a package, filter an audit report, or leave the removed implementation in use. The hook and patch must be retained together.
- All production dependencies, including Composio `0.22.0`, Next `15.5.27`, and React, remain unchanged. The lockfile removes 28 package/version entries and adds 11, all in the TypeScript ESLint replacement family. The other removals belong to the unused glob subtree. Existing registry integrity entries remain unchanged.

The replacement disables `expandDirectories`, as required by the [tinyglobby migration guide](https://superchupu.dev/tinyglobby/migration). Small compatibility handling preserves static/symlink directories, explicit trailing separators, absolute results, and the exclusion of the base directory for a terminal `/**` pattern. Literal directories are checked with `statSync`; inaccessible unexpected filesystem errors still surface.

## Compatibility and security evidence

An isolated differential experiment compared the original and replacement root-directory resolution across 54 fixtures: default cwd, strings and arrays, empty/non-string array entries, literals, nonexistent paths, spaces, directory-only matching, brace/extglob patterns, hidden roots, symlinks, globstar, negative entries, absolute/relative paths and Windows separators. All 54 directory sets matched. Six fixtures differed only in ordering within a glob expansion; explicit array order remains unchanged. Next's consumers use these as root-directory sets, and the old fast-glob expansion order was already unspecified. This is bounded fixture evidence, not a claim that every possible glob expression is equivalent.

The checked-in security test exercises the real Next plugin installation with five compatibility/provenance groups and six retained malicious patterns. Malicious patterns run in subprocesses with a five-second timeout. They must not hang or raise a stack-overflow `RangeError`; a controlled syntax error or filesystem `ENAMETOOLONG` is acceptable for an invalid pattern. The actual lint graph no longer contains `fast-glob`, `micromatch` or `braces`. An unrelated ancestor `node_modules` directory on a developer machine can still contain those packages; neither the repository graph nor patched code uses it.

A clean external directory installed successfully with `pnpm install --frozen-lockfile --ignore-scripts`, passed all 11 replacement tests, and returned zero findings from the complete `pnpm audit --json`. The shared repository frozen reinstall also passes. Full and production audits report zero findings; no ignore list, severity suppression, alias, fabricated package version or audit exclusion was introduced. The full audit is now an additional CI gate.

## Provenance

Original Next plugin tarball: `https://registry.npmjs.org/@next/eslint-plugin-next/-/eslint-plugin-next-15.5.27.tgz`.

Original Next plugin integrity: `sha512-a94xlzvOLaULh4Fzcvj9B2hwIOtPHJW75gghkXiJ8s1Jk0eo00UknrDVhx04Y+8ARu9ds13vy/jHg5u/PdVGqw==`.

Next source patch SHA-256: `e6c902eb5707486dbfb2b9f0d1c50785e0b6bfea1b8836530aebd07374b265ac`.

Final hook SHA-256: `79d5bffbde8b52f225e8a2c409b5c6de81a4d8544abcbef282ea446f4795e1d7`.

Exact registry metadata, signatures, attestations where supplied, source hashes, complete package-entry delta, the differential fixture outputs, initial failures, final audits and install/test logs are retained in `relay-composio-evidence/final-autonomous/dependency-security/`. The base is accepted Relay `4e0df2cf459b98cc4aab85a5906e4975cf0e4d08`; no historical checkpoint evidence was changed.

This is a development-toolchain correction. It does not qualify canonical positive admission or enable remote Composio execution.
