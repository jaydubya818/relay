import { cleanupExpiredBrowserSessions } from "@/lib/browsers";
import { cleanupExpiredSandboxes } from "@/lib/sandboxes";
import { expireFederationContent } from "@/lib/v2/federation/service";

export async function runMaintenanceCycle() {
  const started = Date.now();
  const [sandboxes, browsers] = await Promise.all([cleanupExpiredSandboxes(), cleanupExpiredBrowserSessions()]);
  if (process.env.RELAY_FEDERATION_ENABLED === "true") await expireFederationContent();
  const result = { sandboxes, browsers, durationMs: Date.now() - started };
  console.info(JSON.stringify({ level: "info", event: "maintenance_cycle", ...result }));
  return result;
}

export function startMaintenanceWorker(intervalMs = Number(process.env.RELAY_WORKER_INTERVAL_MS ?? 30_000)) {
  let stopped = false;
  const timer = setInterval(() => { if (!stopped) void runMaintenanceCycle().catch((error) => console.error(JSON.stringify({ level: "error", event: "maintenance_failed", errorClass: error instanceof Error ? error.name : "UnknownError" }))); }, intervalMs);
  return { stop() { stopped = true; clearInterval(timer); } };
}
