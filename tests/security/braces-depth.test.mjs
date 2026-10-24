import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

// Exercise the actual replacement used by Next ESLint, not a direct test dependency.
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
const nested = (open, close, depth) => open.repeat(depth) + "x" + close.repeat(depth);
function globPatternStatus(pattern) {
  const script = `
    const pluginRequire = require("node:module").createRequire(${JSON.stringify(pluginPath)});
    const getRootDirs = pluginRequire("./utils/get-root-dirs.js").getRootDirs;
    try {
      getRootDirs({ cwd: process.cwd(), settings: { next: { rootDir: ${JSON.stringify(pattern)} } } });
    } catch (error) {
      if (error instanceof RangeError || /call stack/i.test(error.message)) process.exit(2);
      if (!(error instanceof SyntaxError) && error.code !== "ENAMETOOLONG") process.exit(3);
    }
  `;
  return spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 5000 });
}

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

  it("keeps official Next 15.5.28 plugin metadata and typescript-eslint 8.48.0 tinyglobby", () => {
    const metadata = pluginRequire("../package.json");
    expect(metadata.name).toBe("@next/eslint-plugin-next");
    expect(metadata.version).toBe("15.5.28");
    // Official 15.5.28 still requires fast-glob. Canonical 231b closed nested-brace
    // exhaustion with a 15.5.27 tinyglobby patchedDependencies hook; that private
    // patch is not taken while GHSA pins stay on official next 15.5.28.
    expect(metadata.dependencies).toEqual({ "fast-glob": "3.3.1" });
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(pkg.pnpm?.patchedDependencies).toBeUndefined();
    const lockfile = readFileSync(new URL("../../pnpm-lock.yaml", import.meta.url), "utf8");
    expect(lockfile).not.toContain("patchedDependencies");
    expect(lockfile).toMatch(/^ {2}fast-glob@3\.3\.1:$/m);
    const typescriptRequire = createRequire(require.resolve("typescript-eslint"));
    const typescriptMetadata = typescriptRequire("@typescript-eslint/typescript-estree/package.json");
    expect(typescriptMetadata.version).toBe("8.48.0");
    expect(typescriptMetadata.dependencies["fast-glob"]).toBeUndefined();
    expect(typescriptMetadata.dependencies.tinyglobby).toBeTruthy();
  });

  it.each([
    nested("(", ")", 4500), "{".repeat(4500), "(".repeat(4500), nested("{a,", "}", 2000),
  ])("handles retained malicious patterns without stack exhaustion", pattern => {
    const result = globPatternStatus(pattern);
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
  });

  // Residual on official 15.5.28: nested brace patterns still overflow because
  // get-root-dirs requires fast-glob. Canonical 231b closed these with a 15.5.27
  // tinyglobby patchedDependencies hook, which this GHSA pin does not take.
  it.skip.each([
    nested("{", "}", 4500), nested("({", "})", 2200),
  ])("nested brace glob patterns without stack exhaustion", pattern => {
    const result = globPatternStatus(pattern);
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
  });
});
