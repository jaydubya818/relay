import { afterEach, describe, expect, it } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { GET as ready } from "@/app/api/health/ready/route";
import { cleanupDatabase, freshDatabase } from "../helpers";

describe("health and readiness", () => {
  afterEach(cleanupDatabase);

  it("reports liveness and migration-backed readiness without connector dependencies", async () => {
    await freshDatabase();
    const liveResponse = await health();
    expect(liveResponse.status).toBe(200);
    expect(await liveResponse.json()).toMatchObject({ ok: true, datastore: "postgresql" });
    const readyResponse = await ready();
    expect(readyResponse.status).toBe(200);
    expect(await readyResponse.json()).toMatchObject({ ok: true, checks: { database: "ready", migrations: "ready", events: "ready" } });
  });
});
