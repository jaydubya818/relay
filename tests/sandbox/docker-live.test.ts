import { describe, expect, it } from "vitest";
import { DockerSandboxProvider } from "@/lib/providers/docker-sandbox";
import type { SandboxResourcePolicy } from "@/lib/providers/sandbox";

const live = process.env.RELAY_LIVE_DOCKER === "1" ? it : it.skip;

describe("DockerSandboxProvider live", () => {
  live("creates, executes, isolates files, enforces timeout, and destroys", async () => {
    const provider = new DockerSandboxProvider();
    const policy: SandboxResourcePolicy = { ttlSeconds: 60, timeoutMs: 500, cpuLimit: 0.5, memoryMb: 128, maxOutputBytes: 16_384, network: "NONE" };
    expect(await provider.health()).toEqual({ ok: true });
    const resource = await provider.create(policy);
    try {
      const execution = await provider.exec(resource, "printf relay-live", policy);
      expect(execution).toMatchObject({ exitCode: 0, stdout: "relay-live", timedOut: false });
      expect((await provider.exec(resource, "env", policy)).stdout).not.toContain("RELAY_");
      expect((await provider.exec(resource, "cat /proc/net/route", policy)).stdout).not.toMatch(/\s00000000\s/);
      const binary = Uint8Array.from([0, 1, 2, 255]);
      await provider.writeFile(resource, "nested/evidence.bin", binary);
      expect(await provider.readFile(resource, "nested/evidence.bin", 1024)).toEqual(binary);
      expect(await provider.listFiles(resource, "nested")).toEqual([{ path: "nested/evidence.bin", kind: "FILE" }]);
      const timed = await provider.exec(resource, "sleep 2", policy);
      expect(timed.timedOut).toBe(true);
      const bounded = await provider.exec(resource, "yes x | head -c 50000", policy);
      expect(bounded.truncated).toBe(true);
      expect(Buffer.byteLength(bounded.stdout)).toBeLessThanOrEqual(policy.maxOutputBytes);
    } finally {
      await provider.destroy(resource);
    }
  }, 120_000);
});
