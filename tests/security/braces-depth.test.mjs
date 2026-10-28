import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Successor to the 6f881e4 braces graph-absence contract.
 *
 * Historical 6f test (failed official quality 40047434000 / job 120732260306):
 * expected `@next/eslint-plugin-next@15.5.27` with private-patch
 * `{ tinyglobby: "0.2.17" }` and lockfile absence of `fast-glob` /
 * `micromatch` / `braces`. That closure came from
 * `patchedDependencies` on 15.5.27, which this tree does not take.
 *
 * Primary advisory GHSA-vfj7-8cjw-p6xm was withdrawn 2026-10-23
 * (`withdrawn_at` 2026-10-23T12:53:02Z) as not practically exploitable.
 * Official `@next/eslint-plugin-next@15.5.28` and even `16.4.3` still
 * depend on `fast-glob@3.3.1`. There is no supported public replacement
 * on the Next 15.5.28 line. Do not restore 15.5.27, private patches,
 * aliases, or advisory ignores. Do not claim lockfile chain absence.
 *
 * 3ca9a59 skip/subprocess residual is unselected. Original 6f logs remain
 * history. Nested-pattern exhaustion cases from 6f are retired with the
 * withdrawn advisory; they are not skipped.
 */
const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("eslint-config-next"));
const pluginPath = nextRequire.resolve("@next/eslint-plugin-next");
const pluginRequire = createRequire(pluginPath);
const { getRootDirs } = pluginRequire("./utils/get-root-dirs.js");
const root = mkdtempSync(join(tmpdir(), "relay-glob-test-"));
for (const name of ["apps/alpha/pages", "apps/beta/app", "apps/.hidden/pages", "space app/pages"]) {
  mkdirSync(join(root, name), { recursive: true });
}
writeFileSync(join(root, "apps/file.txt"), "fixture");
symlinkSync(join(root, "apps/alpha"), join(root, "linked"), "dir");
afterAll(() => rmSync(root, { recursive: true, force: true }));
const resolve = rootDir => getRootDirs({
  cwd: root,
  settings: { next: rootDir === undefined ? {} : { rootDir } },
});

describe("real lint dependency replacement", () => {
  it("preserves default cwd, literal directories and symlink roots", () => {
    expect(resolve(undefined)).toEqual([root]);
    for (const path of ["apps/alpha", "linked", "space app"]) {
      expect(resolve(join(root, path))).toEqual([join(root, path)]);
    }
    expect(resolve(join(root, "missing"))).toEqual([]);
    expect(resolve(join(root, "apps/file.txt"))).toEqual([]);
  });

  it("preserves absolute directory sets, braces, hidden roots and path separators", () => {
    for (const pattern of ["apps/*", "apps/{alpha,beta}", "apps/@(alpha|beta)"]) {
      const expected = [join(root, "apps/alpha"), join(root, "apps/beta")];
      expect(resolve(join(root, pattern)).sort()).toEqual(expected);
      expect(resolve(join(root, pattern).replaceAll("/", "\\")).sort()).toEqual(expected);
    }
    expect(resolve(join(root, "apps/.hidden"))).toEqual([join(root, "apps/.hidden")]);
  });

  it("preserves explicit array order and ignores non-string entries", () => {
    expect(resolve([join(root, "apps/beta"), null, 3, join(root, "apps/alpha")]))
      .toEqual([join(root, "apps/beta"), join(root, "apps/alpha")]);
    expect(resolve([])).toEqual([]);
  });

  it("retains per-entry negative-pattern semantics and globstar base behavior", () => {
    expect(resolve([join(root, "apps/*"), "!" + join(root, "apps/beta")]).sort())
      .toEqual([join(root, "apps/alpha"), join(root, "apps/beta")]);
    expect(resolve(join(root, "apps/**")).sort()).toEqual([
      "apps/alpha", "apps/alpha/pages", "apps/beta", "apps/beta/app",
    ].map(path => join(root, path)).sort());
  });

  it("records official Next 15.5.28 plugin identity without private patch or aliases", () => {
    const metadata = pluginRequire("../package.json");
    expect(metadata.name).toBe("@next/eslint-plugin-next");
    expect(metadata.version).toBe("15.5.28");
    expect(metadata.dependencies).toEqual({ "fast-glob": "3.3.1" });

    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies?.next).toBe("15.5.28");
    expect(pkg.devDependencies?.["eslint-config-next"]).toBe("15.5.28");
    expect(pkg.pnpm?.patchedDependencies).toBeUndefined();
    expect(pkg.pnpm?.auditConfig).toBeUndefined();
    expect(pkg.pnpm?.overrides?.["fast-glob"]).toBeUndefined();
    expect(pkg.pnpm?.overrides?.micromatch).toBeUndefined();
    expect(pkg.pnpm?.overrides?.braces).toBeUndefined();

    const lockfile = readFileSync(new URL("../../pnpm-lock.yaml", import.meta.url), "utf8");
    expect(lockfile).not.toContain("patchedDependencies");
    expect(lockfile).not.toMatch(/^ {2}['"]?(?:fast-glob|micromatch|braces)@npm:/m);
    expect(lockfile).toMatch(/^ {2}fast-glob@3\.3\.1:$/m);
    expect(lockfile).toMatch(/^ {2}micromatch@4\.0\.8:$/m);
    expect(lockfile).toMatch(/^ {2}braces@3\.0\.3:$/m);

    const typescriptRequire = createRequire(require.resolve("typescript-eslint"));
    const typescriptMetadata = typescriptRequire("@typescript-eslint/typescript-estree/package.json");
    expect(typescriptMetadata.version).toBe("8.48.0");
    expect(typescriptMetadata.dependencies["fast-glob"]).toBeUndefined();
    expect(typescriptMetadata.dependencies.tinyglobby).toBeTruthy();
  });
});
