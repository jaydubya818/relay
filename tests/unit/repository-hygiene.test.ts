import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("repository hygiene", () => {
  it("does not ship SQLite in the production persistence layer", () => {
    const source = readFileSync("lib/db.ts", "utf8");
    expect(source).toContain("drizzle-orm/node-postgres");
    expect(source).not.toContain("node:sqlite");
  });
});
