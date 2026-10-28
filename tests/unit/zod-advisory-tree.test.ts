/**
 * GHSA-mrhx-c7xc-m3w5 (updated 2026-10-23): npm/zod < 4.6.6, patched 4.6.6+.
 *
 * Official fix (colinhacks/zod@a0ebf97 / #6652) lives in the v4 parser only.
 * A package pin plus `zod/v3` imports is not runtime remediation: the v3
 * ZodArray parser in 4.6.7 is byte-identical to 3.25.76.
 *
 * These checks read installed source and parse two-element fixtures. They do
 * not build oversized collections or reproduce exhaustion.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { actionIntentSchema, resourceConstraintSchema } from "@/lib/v2/contracts/schemas";

const ADVISORY = "GHSA-mrhx-c7xc-m3w5";
const PATCHED_FLOOR = "4.6.6";
const PINNED = "4.6.7";
const V3_IMPORT = /from\s+["']zod\/v3["']|require\(\s*["']zod\/v3["']\s*\)/;
const SOURCE_ROOTS = ["app", "lib", "scripts", "tests"];
const UNPATCHED_V3_PARSER_SHA256 = "273e22bfded98b8856da82ecf4504ed7add7256eeb58b1fca05fd543ef745835";
const CAP_SIZE_COMMENT = "an oversized container fails its leading size checks before any element is parsed";
const require = createRequire(import.meta.url);

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

function extractZodArrayParse(source: string): string {
  const start = source.indexOf("class ZodArray");
  expect(start, "v3 ZodArray class").toBeGreaterThan(-1);
  const parse = source.indexOf("_parse(input)", start);
  expect(parse, "v3 ZodArray._parse").toBeGreaterThan(start);
  const end = source.indexOf("\n    get element()", parse);
  expect(end, "v3 ZodArray element getter").toBeGreaterThan(parse);
  return source.slice(parse, end);
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

  it("keeps application schemas on the v4 default export that contains #6652, not zod/v3", () => {
    const files = SOURCE_ROOTS.flatMap(listSourceFiles);
    const v3Imports = files.flatMap((file) => {
      if (file === "tests/unit/zod-advisory-tree.test.ts") return [];
      return V3_IMPORT.test(readFileSync(file, "utf8")) ? [file] : [];
    });
    expect(v3Imports, "application must not import the unpatched v3 subpath").toEqual([]);

    expect("_zod" in actionIntentSchema, "Relay actionIntentSchema must be a v4 instance").toBe(true);
    expect("_zod" in resourceConstraintSchema).toBe(true);
  });

  it("loads the official v4 capSize wrapper and documents that v3 ZodArray is still the 3.25.76 parser", () => {
    const pkgRoot = dirname(require.resolve("zod/package.json"));
    const v4Schemas = readFileSync(join(pkgRoot, "v4/core/schemas.js"), "utf8");
    expect(v4Schemas).toContain(CAP_SIZE_COMMENT);
    expect(v4Schemas).toContain("function capSize(inst, size)");
    expect(v4Schemas).toContain("capSize(inst, arraySize)");

    const v3Types = readFileSync(join(pkgRoot, "v3/types.js"), "utf8");
    const parserSha = createHash("sha256").update(extractZodArrayParse(v3Types)).digest("hex");
    expect(parserSha).toBe(UNPATCHED_V3_PARSER_SHA256);
    expect(v3Types).not.toContain("function capSize");
  });

  it("rejects a two-element array against .max(1) before walking element issues", () => {
    const result = z.array(z.uuid()).max(1).safeParse(["not-a-uuid", "also-not"]);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.code)).toEqual(["too_big"]);
    expect(result.error.issues.some((issue) => issue.code === "invalid_format")).toBe(false);
  });
});
