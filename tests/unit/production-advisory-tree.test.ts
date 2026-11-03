/**
 * Production dependency inventory at ccd3287 (historical, not a PASS for
 * this tree): pnpm audit --prod 1 critical / 3 high / 2 moderate.
 *
 * Official patched lines:
 * - next 15.5.28 (GHSA-2464-fhr4-w9xw, GHSA-p3m5-59mp-jv5r; also 15.5.27
 *   cache GHSA-4jqv-mc3x-m676 / GHSA-mcj8-r9mp-w47p)
 * - source-map-js >= 1.2.2 (GHSA-68fv-2mgg-jv7q)
 * - sharp >= 0.35.5 (GHSA-wq5f-xc86-pv6w)
 *
 * Next 15.5.28 optionalDependencies.sharp is `^0.34.3 || ^0.35.5`. Pinning
 * sharp 0.35.5 is the supported 0.35 patch, not a Next 16 migration.
 * These checks read package metadata and the lockfile. They do not send
 * image payloads, craft Server Actions, or otherwise reproduce advisory
 * behavior.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const NEXT = "15.5.28";
const SHARP = "0.35.5";
const SOURCE_MAP_JS = "1.2.2";

function lockfilePackageVersions(lockfile: string, name: string): string[] {
  const versions = new Set<string>();
  const pattern = new RegExp(`^ {2}${name.replace("/", "\\/")}@([^:( \\n]+):$`, "gm");
  for (const match of lockfile.matchAll(pattern)) versions.add(match[1]);
  return [...versions].sort();
}

type InstalledPackage = { name?: string; version: string; optionalDependencies?: Record<string, string> };

function readPackageJson(path: string): InstalledPackage | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as InstalledPackage;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function installedPackage(name: string): InstalledPackage {
  let dir = dirname(require.resolve(name));
  while (true) {
    const pkg = readPackageJson(join(dir, "package.json"));
    if (pkg?.name === name) return pkg;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`installed package.json for ${name} not found`);
    dir = parent;
  }
}

describe("production advisory tree", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    pnpm?: { overrides?: Record<string, string>; auditConfig?: unknown; patchedDependencies?: unknown };
  };
  const lockfile = readFileSync("pnpm-lock.yaml", "utf8");

  it("pins official next 15.5.28 and matching eslint-config-next", () => {
    expect(pkg.dependencies?.next).toBe(NEXT);
    expect(pkg.devDependencies?.["eslint-config-next"]).toBe(NEXT);
    expect(lockfilePackageVersions(lockfile, "next")).toEqual([NEXT]);
    expect(lockfilePackageVersions(lockfile, "eslint-config-next")).toEqual([NEXT]);
  });

  it("keeps Next's optional sharp on the patched 0.35.5 line that 15.5.28 supports", () => {
    expect(pkg.pnpm?.overrides?.["next>sharp"]).toBe(SHARP);
    expect(lockfilePackageVersions(lockfile, "sharp")).toEqual([SHARP]);

    const nextPkg = installedPackage("next");
    expect(nextPkg.version).toBe(NEXT);
    expect(nextPkg.optionalDependencies?.sharp).toBe("^0.34.3 || ^0.35.5");
    expect(installedPackage("sharp").version).toBe(SHARP);
  });

  it("overrides source-map-js to official 1.2.2 under the existing PostCSS pin", () => {
    expect(pkg.pnpm?.overrides?.["next>postcss"]).toBe("8.5.23");
    expect(pkg.pnpm?.overrides?.["source-map-js"]).toBe(SOURCE_MAP_JS);
    expect(lockfilePackageVersions(lockfile, "source-map-js")).toEqual([SOURCE_MAP_JS]);

    expect(installedPackage("source-map-js").version).toBe(SOURCE_MAP_JS);
  });

  it("does not ignore or patch around these advisories", () => {
    expect(pkg.pnpm?.auditConfig).toBeUndefined();
    expect(pkg.pnpm?.patchedDependencies).toBeUndefined();
    expect(lockfile).not.toContain("patchedDependencies");
  });
});
