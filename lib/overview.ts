import { db } from "@/lib/db";

export function getOverview(accountId: string) {
  const counts = db().prepare(`
    SELECT
      (SELECT COUNT(*) FROM agents WHERE account_id = ?) agents,
      (SELECT COUNT(*) FROM activities WHERE account_id = ? AND created_at >= datetime('now', '-1 day')) operations,
      (SELECT COUNT(*) FROM connections WHERE account_id = ? AND status = 'CONNECTED') connections,
      (SELECT COUNT(*) FROM activities WHERE account_id = ? AND status = 'FAILED' AND created_at >= datetime('now', '-1 day')) failures
  `).get(accountId, accountId, accountId, accountId) as { agents: number; operations: number; connections: number; failures: number };
  const agents = db().prepare("SELECT id, name, status FROM agents WHERE account_id = ? ORDER BY created_at LIMIT 6").all(accountId);
  const connection = db().prepare("SELECT status FROM connections WHERE account_id = ? AND provider = 'GITHUB'").get(accountId) as { status: string } | undefined;
  return { counts, agents, githubStatus: connection?.status ?? "NOT_CONNECTED" };
}
