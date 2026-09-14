import { closeDatabase } from "../lib/db";
import { runMaintenanceCycle, startMaintenanceWorker } from "../lib/worker";

async function main() {
  const worker = startMaintenanceWorker();
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    worker.stop();
    console.info(JSON.stringify({ level: "info", event: "worker_stopped", signal }));
    await closeDatabase();
    process.exit(0);
  }
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  await runMaintenanceCycle();
}

main().catch(async (error) => {
  console.error(JSON.stringify({ level: "error", event: "worker_start_failed", errorClass: error instanceof Error ? error.name : "UnknownError" }));
  await closeDatabase();
  process.exitCode = 1;
});
