import { describe, expect, it } from "vitest";
import { findViolations, isDatabaseKey } from "../../scripts/ci/vercel-env-scope";

const none = { branchOverrides: [] };

describe("vercel env scope guard", () => {
  it("recognizes database credential keys", () => {
    for (const key of ["DATABASE_URL", "RELAY_DATABASE_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_PRISMA_URL", "PGPASSWORD", "PGHOST_UNPOOLED", "NEON_PROJECT_ID"]) {
      expect(isDatabaseKey(key)).toBe(true);
    }
    for (const key of ["RELAY_DATABASE_POOL_SIZE", "RELAY_SESSION_SECRET", "NEXT_PUBLIC_RELAY_URL"]) {
      expect(isDatabaseKey(key)).toBe(false);
    }
  });

  it("passes production-only database variables", () => {
    expect(findViolations("relay", [{ key: "DATABASE_URL", target: ["production"] }], none)).toEqual([]);
  });

  it("fails when production credentials are shared with preview or development", () => {
    const violations = findViolations("relay", [{ key: "DATABASE_URL", target: ["production", "preview", "development"] }], none);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/shared with non-production/);
  });

  it("fails when a database variable targets every preview", () => {
    expect(findViolations("relay", [{ key: "RELAY_DATABASE_URL", target: ["preview"] }], none)).toHaveLength(1);
  });

  it("fails on custom environments", () => {
    expect(findViolations("relay", [{ key: "DATABASE_URL", target: ["production"], customEnvironmentIds: ["env_staging"] }], none)).toHaveLength(1);
  });

  it("allows only allowlisted branch-scoped preview overrides", () => {
    const env = { key: "DATABASE_URL", target: ["preview"], gitBranch: "codex/isolated" };
    expect(findViolations("relay", [env], none)).toHaveLength(1);
    expect(findViolations("relay", [env], { branchOverrides: ["relay/DATABASE_URL@codex/isolated"] })).toEqual([]);
  });
});
