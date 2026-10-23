/**
 * GHSA-mrhx-c7xc-m3w5 (updated 2026-10-23): npm/zod < 4.6.6, patched 4.6.6+.
 * This is a lockfile/import contract. It does not parse oversized collections
 * or otherwise reproduce exhaustion.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ADVISORY = "GHSA-mrhx-c7xc-m3w5";
const PATCHED_FLOOR = "4.6.6";
const PINNED = "4.6.7";
const DEFAULT_ZOD_IMPORT = /from\s+["']zod["']|require\(\s*["']zod["']\s*\)/;
const SOURCE_ROOTS = ["app", "lib", "scripts", "tests"];

function lockfileZodVersions(lockfile: string): string[] {
  const versions = new Set<string>();
  for (const match of lockfile.matchAll(/^ {2}zod@([^:( \n]+):$/gm)) {
    versions.add(match[1]);
  }
  return [...versions].sort();
}

function compareNpm(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const delta = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") return [];
      return listSourceFiles(path);
    }
    return /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [path] : [];
  });
}

describe(`${ADVISORY} zod tree`, () => {
  it(`installs only official patched zod ${PINNED} (>= ${PATCHED_FLOOR})`, () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      pnpm?: { overrides?: Record<string, string> };
    };
    const lockfile = readFileSync("pnpm-lock.yaml", "utf8");
    const installed = lockfileZodVersions(lockfile);
    const belowFloor = installed.filter((version) => compareNpm(version, PATCHED_FLOOR) < 0);

    expect(pkg.dependencies?.zod).toBe(PINNED);
    expect(pkg.pnpm?.overrides?.zod).toBe(PINNED);
    expect(installed, "pnpm-lock.yaml package keys").toEqual([PINNED]);
    expect(belowFloor).toEqual([]);
  });

  it("keeps application schemas on the official zod/v3 subpath instead of the v4 default export", () => {
    const files = SOURCE_ROOTS.flatMap(listSourceFiles);
    const defaultImports = files.flatMap((file) => {
      if (file === "tests/unit/zod-advisory-tree.test.ts") return [];
      const source = readFileSync(file, "utf8");
      return DEFAULT_ZOD_IMPORT.test(source) ? [file] : [];
    });
    expect(defaultImports).toEqual([]);
  });
});
