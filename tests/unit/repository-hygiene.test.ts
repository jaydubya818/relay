import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("repository hygiene", () => {
  it("does not ship SQLite in the production persistence layer", () => {
    const source = readFileSync("lib/db.ts", "utf8");
    expect(source).toContain("drizzle-orm/node-postgres");
    expect(source).not.toContain("node:sqlite");
  });

  it("records an immutable and isolated Relay V2 implementation frontier", () => {
    const adr = readFileSync("docs/adr/ADR-016-relay-v2-implementation-frontier.md", "utf8");
    const verifier = readFileSync("scripts/verify-v2-frontier.ts", "utf8");

    expect(adr).toContain("43e0160eb2b9552f71154d18369e4626e0e79339");
    expect(adr).toContain("codex/relay-v1-rc-soak");
    expect(adr).toContain("BLOCKED_EXTERNAL_CONFIGURATION");
    expect(verifier).toContain('const FROZEN_BRANCHES = ["feat/relay-v1", "codex/relay-v1-rc-soak"]');
    expect(verifier).toContain('"refs/remotes/origin/feat/relay-v1": V2_BASE');
    expect(verifier).toContain('const V2_BASE_TAG = "relay-v1.0.0-rc.1"');
  });
});
