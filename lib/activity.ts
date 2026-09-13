import { db } from "@/lib/db";
import { id, now } from "@/lib/ids";
import type { ActivityStatus } from "@/lib/types";

export function recordActivity(input: {
  accountId: string;
  agentId?: string;
  sessionId: string;
  capability: string;
  provider?: string;
  action: string;
  status: ActivityStatus;
  durationMs: number;
  metadata?: Record<string, string | number | boolean>;
}) {
  db().prepare(`
    INSERT INTO activities (id, account_id, agent_id, session_id, capability, provider, action, status, duration_ms, created_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id("act"), input.accountId, input.agentId ?? null, input.sessionId, input.capability, input.provider ?? null, input.action, input.status, Math.max(0, Math.round(input.durationMs)), now(), JSON.stringify(input.metadata ?? {}));
}

export function listActivity(accountId: string, filters: { agentId?: string; capability?: string; status?: string; provider?: string; limit?: number } = {}) {
  const conditions = ["a.account_id = ?"];
  const params: Array<string | number | null> = [accountId];
  for (const [column, value] of [["a.agent_id", filters.agentId], ["a.capability", filters.capability], ["a.status", filters.status], ["a.provider", filters.provider]] as const) {
    if (value) { conditions.push(`${column} = ?`); params.push(value); }
  }
  params.push(Math.min(filters.limit ?? 100, 250));
  return db().prepare(`
    SELECT a.id, a.agent_id agentId, agents.name agentName, a.session_id sessionId, a.capability,
      a.provider, a.action, a.status, a.duration_ms durationMs, a.created_at createdAt, a.metadata
    FROM activities a LEFT JOIN agents ON agents.id = a.agent_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?
  `).all(...params) as any[];
}
