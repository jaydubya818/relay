import { beforeEach, expect, it, vi } from "vitest";

const expire = vi.hoisted(() => vi.fn());
vi.mock("@/lib/v2/federation/service", () => ({ expireFederationContent: expire }));

import { GET } from "@/app/api/internal/federation-maintenance/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "test-only-cron-secret-long-enough");
  vi.stubEnv("RELAY_FEDERATION_ENABLED", "true");
  expire.mockResolvedValue(undefined);
});

const request = (authorization?: string) => new Request("https://relay.example/api/internal/federation-maintenance", {
  headers: authorization ? { authorization } : {},
});

it("expires Federation content only for the authenticated production cron", async () => {
  expect((await GET(request())).status).toBe(401);
  expect((await GET(request("Bearer wrong-secret"))).status).toBe(401);
  expect(expire).not.toHaveBeenCalled();

  const response = await GET(request("Bearer test-only-cron-secret-long-enough"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(expire).toHaveBeenCalledOnce();
});

it("does not run while Federation is disabled", async () => {
  vi.stubEnv("RELAY_FEDERATION_ENABLED", "false");
  expect((await GET(request("Bearer test-only-cron-secret-long-enough"))).status).toBe(503);
  expect(expire).not.toHaveBeenCalled();
});
