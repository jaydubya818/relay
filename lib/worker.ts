import { flushRelayPolicyFences, flushOwnerPolicyFences, orderingConfiguration } from '@/lib/v2/policy/ordering';
import { cleanupExpiredBrowserSessions } from "@/lib/browsers";
import { cleanupExpiredSandboxes } from "@/lib/sandboxes";
import { expireFederationContent } from "@/lib/v2/federation/service";

export async function runMaintenanceCycle() {
  const started = Date.now();
  const [sandboxes, browsers] = await Promise.all([cleanupExpiredSandboxes(), cleanupExpiredBrowserSessions()]);
  if (process.env.RELAY_FEDERATION_ENABLED === "true") await expireFederationContent();
  const coordination = orderingConfiguration();
  const policyDeliveries: Array<{ accountId: string; owner: 'DRAINED' | 'PENDING_BACKEND'; relay: 'DRAINED' | 'PENDING_BACKEND' }> = [];
  if (coordination) for (const accountId of [...new Set(coordination.destinations.map(item => item.accountId))]) {
    // Independent authorities/accounts must continue even when one receiver is unavailable.
    const [owner, relay] = await Promise.allSettled([flushOwnerPolicyFences(accountId), flushRelayPolicyFences(accountId)]);
    policyDeliveries.push({ accountId,
      owner: owner.status === 'fulfilled' && owner.value.every(item => item.status === 'ACKNOWLEDGED') ? 'DRAINED' : 'PENDING_BACKEND',
      relay: relay.status === 'fulfilled' ? 'DRAINED' : 'PENDING_BACKEND' });
  }
  const result = { sandboxes, browsers, policyDeliveries, durationMs: Date.now() - started };
  console.info(JSON.stringify({ level: "info", event: "maintenance_cycle", ...result }));
  return result;
}

export function startMaintenanceWorker(intervalMs = Number(process.env.RELAY_WORKER_INTERVAL_MS ?? 30_000)) {
  let stopped = false;
  const timer = setInterval(() => { if (!stopped) void runMaintenanceCycle().catch((error) => console.error(JSON.stringify({ level: "error", event: "maintenance_failed", errorClass: error instanceof Error ? error.name : "UnknownError" }))); }, intervalMs);
  return { stop() { stopped = true; clearInterval(timer); } };
}
