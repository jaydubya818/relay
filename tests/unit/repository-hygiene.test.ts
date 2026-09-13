import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("repository hygiene", () => {
  it("ignores SQLite database sidecar files", () => {
    for (const path of ["data/relay.db", "data/relay.db-wal", "data/relay.db-shm"]) {
      const ignored = execFileSync("git", ["check-ignore", path], { encoding: "utf8" }).trim();
      expect(ignored).toBe(path);
    }
  });
});
