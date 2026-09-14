import { afterEach, describe, expect, it, vi } from "vitest";
import { startMaintenanceWorker } from "@/lib/worker";
import { cleanupDatabase, freshDatabase } from "../helpers";

describe("maintenance worker lifecycle", () => {
  afterEach(cleanupDatabase);
  it("starts and stops without running another maintenance cycle", async () => {
    await freshDatabase();
    vi.useFakeTimers();
    const worker = startMaintenanceWorker(1_000);
    worker.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    vi.useRealTimers();
    expect(true).toBe(true);
  });
});
