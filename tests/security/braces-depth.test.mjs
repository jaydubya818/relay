import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Resolve the real audited consumer chain, not an extra direct test dependency.
let require = createRequire(import.meta.url);
for (const name of ["eslint-config-next", "@next/eslint-plugin-next", "fast-glob"]) {
  require = createRequire(require.resolve(name));
}
const micromatch = require("micromatch");
require = createRequire(require.resolve("micromatch"));
const braces = require("braces");
const nested = (open, close, depth) => open.repeat(depth) + "x" + close.repeat(depth);
const methods = ["parse", "compile", "expand", "stringify"];

describe("braces registry patch: bounded string parsing on the actual lint path", () => {
  it.each(methods)("%s rejects reproduced deep patterns without stack exhaustion", method => {
    for (const pattern of [nested("{", "}", 4500), nested("(", ")", 4500),
      nested("({", "})", 2200), "{".repeat(4500), "(".repeat(4500)]) {
      expect(() => braces[method](pattern)).toThrow(new SyntaxError("Input exceeds max nesting depth (100)"));
    }
  });
  it.each(methods)("%s accepts depth 100 and denies depth 101, including mixed nesting", method => {
    for (const pattern of [nested("{", "}", 100), nested("(", ")", 100), nested("({", "})", 50)]) {
      expect(() => braces[method](pattern)).not.toThrow();
    }
    for (const pattern of [nested("{", "}", 101), nested("(", ")", 101), "(" + nested("({", "})", 50) + ")"]) {
      expect(() => braces[method](pattern, { maxDepth: Infinity, maxLength: Infinity })).toThrow(SyntaxError);
    }
  });
  it("protects default and expand entrypoints used by micromatch", () => {
    const pattern = nested("{", "}", 4500);
    for (const expand of [false, true]) {
      expect(() => braces(pattern, { expand })).toThrow(SyntaxError);
      expect(() => micromatch.braces(pattern, { expand })).toThrow(SyntaxError);
    }
  });
  it("preserves ordinary glob, range, escaped, quoted and bracketed behavior", () => {
    expect(braces.compile("src/{a,b}/*.ts")).toBe("src/(a|b)/*.ts");
    expect(braces.expand("file-{01..03}.{js,ts}")).toEqual([
      "file-01.js", "file-01.ts", "file-02.js", "file-02.ts", "file-03.js", "file-03.ts",
    ]);
    expect(micromatch(["src/a/x.ts", "src/b/y.ts", "src/c/z.ts"], "src/{a,b}/*.ts")).toEqual(["src/a/x.ts", "src/b/y.ts"]);
    for (const pattern of ["\\{".repeat(500), '"' + "{".repeat(500) + '"', "[" + "{".repeat(500) + "]", "x".repeat(9000)]) {
      for (const method of methods) expect(() => braces[method](pattern)).not.toThrow();
    }
    // Many sibling blocks do not consume nested depth.
    expect(() => braces.compile("{a,b}".repeat(500))).not.toThrow();
    expect(braces.expand("a/{b,c")).toEqual(["a/{b,c"]);
  });
});
