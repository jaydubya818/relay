import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "@/lib/agents";
import { listActivity } from "@/lib/activity";
import { getOverview } from "@/lib/overview";
import { cleanupDatabase, freshDatabase } from "../helpers";

function percentile(values: number[], percentileValue: number) {
  return values.sort((a, b) => a - b)[Math.ceil(values.length * percentileValue) - 1];
}

describe("local dashboard qualification", () => {
  afterEach(cleanupDatabase);
  it("keeps common local read models below the V1 p95 target", async () => {
    const { accountId } = await freshDatabase();
    for (let index = 0; index < 20; index += 1) await createAgent(accountId, { name: `Agent ${index}` });
    const timings: number[] = [];
    for (let index = 0; index < 50; index += 1) {
      const started = performance.now();
      await Promise.all([getOverview(accountId), listActivity(accountId, { limit: 100 })]);
      timings.push(performance.now() - started);
    }
    const p95 = percentile(timings, 0.95);
    console.info(JSON.stringify({ benchmark: "overview-and-activity-read-models", medianMs: percentile(timings, 0.5), p95Ms: p95, samples: timings.length }));
    expect(p95).toBeLessThan(250);
  });
});
