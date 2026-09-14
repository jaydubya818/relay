import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Relay V2 security architecture", () => {
  const document = readFileSync("docs/v2/security/security-architecture.md", "utf8");

  it("maps every approved threat to controls and tests", () => {
    for (let number = 1; number <= 20; number += 1) {
      const id = `T${String(number).padStart(2, "0")}`;
      const row = document.split("\n").find((line) => line.startsWith(`| ${id} `));
      expect(row, `${id} must have a traceability row`).toBeDefined();
      expect(row?.split("|").length).toBeGreaterThanOrEqual(7);
    }
  });

  it("records non-negotiable authority and secret boundaries", () => {
    expect(document).toContain("Runner is not a policy, approval, grant, budget, or revocation authority");
    expect(document).toContain("there is no plaintext read contract");
    expect(document).toContain("Financial, destructive, new-recipient communication, and restricted-data egress always require online authorization");
    expect(document).toContain("no generic bypass flag exists");
  });
});

