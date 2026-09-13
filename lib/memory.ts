import { db } from "@/lib/db";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import type { AgentPrincipal, MemoryScope, MemoryType } from "@/lib/types";

type MemoryFilters = { query?: string; type?: MemoryType; scope?: MemoryScope; createdByAgentId?: string; limit?: number };

export function addMemory(principal: AgentPrincipal, input: { content: string; type: MemoryType; scope: MemoryScope; source?: string }) {
  const timestamp = now();
  const memoryId = id("mem");
  db().prepare(`
    INSERT INTO memories (id, account_id, created_by_agent_id, scope, type, content, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(memoryId, principal.accountId, principal.agentId, input.scope, input.type, input.content.trim(), input.source ?? "agent", timestamp, timestamp);
  return getMemory(principal, memoryId);
}

export function getMemory(principal: AgentPrincipal, memoryId: string) {
  const memory = db().prepare(`
    SELECT m.id, m.content, m.type, m.scope, m.created_by_agent_id createdByAgentId, a.name createdByAgent,
      m.source, m.created_at createdAt, m.updated_at updatedAt
    FROM memories m JOIN agents a ON a.id = m.created_by_agent_id
    WHERE m.id = ? AND m.account_id = ? AND m.forgotten_at IS NULL
      AND (m.scope = 'SHARED' OR m.created_by_agent_id = ?)
  `).get(memoryId, principal.accountId, principal.agentId) as any;
  if (!memory) throw new RelayError("INVALID_INPUT", "Memory not found.", "memory.read", 404);
  return memory;
}

export function listMemories(principal: AgentPrincipal, filters: MemoryFilters = {}) {
  const conditions = ["m.account_id = ?", "m.forgotten_at IS NULL", "(m.scope = 'SHARED' OR m.created_by_agent_id = ?)"];
  const params: Array<string | number | null> = [principal.accountId, principal.agentId];
  if (filters.query) {
    const words = filters.query.toLowerCase().split(/\W+/).filter((word) => word.length > 2);
    if (words.length) {
      conditions.push(`(${words.map(() => "lower(m.content) LIKE ?").join(" OR ")})`);
      params.push(...words.map((word) => `%${word}%`));
    }
  }
  if (filters.type) { conditions.push("m.type = ?"); params.push(filters.type); }
  if (filters.scope) { conditions.push("m.scope = ?"); params.push(filters.scope); }
  if (filters.createdByAgentId) { conditions.push("m.created_by_agent_id = ?"); params.push(filters.createdByAgentId); }
  params.push(Math.min(filters.limit ?? 100, 250));
  return db().prepare(`
    SELECT m.id, m.content, m.type, m.scope, m.created_by_agent_id createdByAgentId, a.name createdByAgent,
      m.source, m.created_at createdAt, m.updated_at updatedAt
    FROM memories m JOIN agents a ON a.id = m.created_by_agent_id
    WHERE ${conditions.join(" AND ")} ORDER BY m.created_at DESC LIMIT ?
  `).all(...params) as any[];
}

export function forgetMemoryAsUser(accountId: string, memoryId: string) {
  const result = db().prepare("UPDATE memories SET forgotten_at = ?, updated_at = ? WHERE id = ? AND account_id = ? AND forgotten_at IS NULL").run(now(), now(), memoryId, accountId);
  if (!result.changes) throw new RelayError("INVALID_INPUT", "Memory not found.", undefined, 404);
}

export function forgetMemory(principal: AgentPrincipal, memoryId: string) {
  const result = db().prepare(`
    UPDATE memories SET forgotten_at = ?, updated_at = ?
    WHERE id = ? AND account_id = ? AND forgotten_at IS NULL
      AND (created_by_agent_id = ? OR scope = 'SHARED')
  `).run(now(), now(), memoryId, principal.accountId, principal.agentId);
  if (!result.changes) throw new RelayError("INVALID_INPUT", "Memory not found.", "memory.forget", 404);
}

export function dashboardMemories(accountId: string, filters: MemoryFilters = {}) {
  const conditions = ["m.account_id = ?", "m.forgotten_at IS NULL"];
  const params: Array<string | number | null> = [accountId];
  if (filters.query) { conditions.push("lower(m.content) LIKE ?"); params.push(`%${filters.query.toLowerCase()}%`); }
  if (filters.type) { conditions.push("m.type = ?"); params.push(filters.type); }
  if (filters.scope) { conditions.push("m.scope = ?"); params.push(filters.scope); }
  if (filters.createdByAgentId) { conditions.push("m.created_by_agent_id = ?"); params.push(filters.createdByAgentId); }
  return db().prepare(`SELECT m.id, m.content, m.type, m.scope, m.created_by_agent_id createdByAgentId, a.name createdByAgent, m.created_at createdAt FROM memories m JOIN agents a ON a.id = m.created_by_agent_id WHERE ${conditions.join(" AND ")} ORDER BY m.created_at DESC LIMIT 250`).all(...params) as any[];
}
