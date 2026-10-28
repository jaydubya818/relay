import { afterEach, beforeEach, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ reads: 0, exists: true }));
vi.mock("@/lib/db", () => ({
  db: () => ({
    select: () => {
      runtime.reads++;
      return { from: () => ({ where: () => ({ limit: async () => runtime.exists ? [{ id: "rtc_public_fixture" }] : [] }) }) };
    },
  }),
  withTransaction: vi.fn(),
}));
import { authenticateDeveloperClient } from "@/lib/v2/developer-platform";

// Public adapter-boundary fixtures only. No actual OAuth token, database,
// lease, provider operation or deployment is created by these tests.
const now = 1_800_000_000_000;
const input = (expiresAt: string) => ({
  accountId: "acct_public_fixture",
  credential: "public-oauth-fixture",
  expectedResource: "https://relay.example/api/v2/mcp",
  oauthVerifier: { verify: async () => ({
    accountId: "acct_public_fixture", runtimeClientId: "rtc_public_fixture",
    audience: "https://relay.example/api/v2/mcp", expiresAt,
  }) },
});
beforeEach(() => {
  runtime.reads = 0;
  runtime.exists = true;
  vi.spyOn(Date, "now").mockReturnValue(now);
});
afterEach(() => vi.restoreAllMocks());

it.each(["", "not-a-date", "999999999999999999999999"])("denies malformed verified expiry %j before runtime lookup", async (expiresAt) => {
  await expect(authenticateDeveloperClient(input(expiresAt))).rejects.toMatchObject({ code: "INVALID_CREDENTIAL", status: 401 });
  expect(runtime.reads).toBe(0);
});

it.each([-1, 0])("denies expiry at now plus %ims before runtime lookup", async (offset) => {
  await expect(authenticateDeveloperClient(input(new Date(now + offset).toISOString()))).rejects.toMatchObject({ code: "INVALID_CREDENTIAL", status: 401 });
  expect(runtime.reads).toBe(0);
});

it("preserves a valid future verified claim with a current runtime", async () => {
  await expect(authenticateDeveloperClient(input(new Date(now + 60_000).toISOString()))).resolves.toMatchObject({
    accountId: "acct_public_fixture", runtimeClientId: "rtc_public_fixture", authentication: "oauth",
  });
  expect(runtime.reads).toBe(1);
});

it("still denies valid future metadata without a current runtime registration", async () => {
  runtime.exists = false;
  await expect(authenticateDeveloperClient(input(new Date(now + 60_000).toISOString()))).rejects.toMatchObject({ code: "INVALID_CREDENTIAL", status: 401 });
  expect(runtime.reads).toBe(1);
});
