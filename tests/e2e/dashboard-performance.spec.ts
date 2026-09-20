import { expect, request as apiRequest, test } from "@playwright/test";

test("critical dashboard routes meet the warm production response target", async ({ request }, testInfo) => {
  test.setTimeout(60_000);
  const baseURL = testInfo.project.use.baseURL;
  expect(baseURL).toBeTruthy();
  const login = await request.post("/api/auth/login", {
    headers: { origin: baseURL! },
    data: { email: "admin@relay.local", password: "relay-e2e" },
  });
  expect(login.ok()).toBe(true);
  const cookie = login.headers()["set-cookie"]?.split(";", 1)[0];
  expect(cookie).toMatch(/^__Host-relay_session=/);
  const authenticated = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { cookie: cookie! } });

  try {
    for (const route of ["/", "/agents", "/memory", "/connections", "/sandboxes", "/browsers", "/events", "/activity", "/developer"]) {
      const warmup = await authenticated.get(route);
      expect(warmup.ok()).toBe(true);
      const samples: number[] = [];
      for (let sample = 0; sample < 20; sample += 1) {
        const started = performance.now();
        const response = await authenticated.get(route);
        samples.push(performance.now() - started);
        expect(response.ok()).toBe(true);
      }
      samples.sort((a, b) => a - b);
      const p50Ms = samples[9];
      const p95Ms = samples[18];
      const p99Ms = samples[19];
      console.info(JSON.stringify({ benchmark: route, mode: "production", p50Ms, p95Ms, p99Ms, samples: samples.length }));
      expect(p95Ms).toBeLessThan(200);
    }
  } finally {
    await authenticated.dispose();
  }
});
