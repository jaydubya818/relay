import { closeDatabase } from "../lib/db";
import { runMaintenanceCycle, startMaintenanceWorker } from "../lib/worker";

const worker = startMaintenanceWorker();
await runMaintenanceCycle();
async function shutdown(signal: string) { worker.stop(); console.info(JSON.stringify({ level: "info", event: "worker_stopped", signal })); await closeDatabase(); process.exit(0); }
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
