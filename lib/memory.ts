import { and, desc, eq, ilike, isNull, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents, memories } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";
import type { AgentPrincipal, MemoryScope, MemoryType } from "@/lib/types";

type MemoryFilters = { query?: string; type?: MemoryType; scope?: MemoryScope; createdByAgentId?: string; limit?: number };

const memoryColumns = {
  id: memories.id,
  content: memories.content,
  type: memories.type,
  scope: memories.scope,
  createdByAgentId: memories.createdByAgentId,
  createdByAgent: agents.name,
  source: memories.source,
  createdAt: memories.createdAt,
  updatedAt: memories.updatedAt,
};

export async function addMemory(principal: AgentPrincipal, input: { content: string; type: MemoryType; scope: MemoryScope; source?: string }) {
  const timestamp = now();
  const memoryId = id("mem");
  await db().insert(memories).values({ id: memoryId, accountId: principal.accountId, createdByAgentId: principal.agentId, scope: input.scope, type: input.type, content: input.content.trim(), source: input.source ?? "agent", createdAt: timestamp, updatedAt: timestamp });
  return getMemory(principal, memoryId);
}

export async function getMemory(principal: AgentPrincipal, memoryId: string) {
  const [memory] = await db().select(memoryColumns).from(memories).innerJoin(agents, eq(agents.id, memories.createdByAgentId)).where(and(
    eq(memories.id, memoryId),
    eq(memories.accountId, principal.accountId),
    isNull(memories.forgottenAt),
    or(eq(memories.scope, "SHARED"), eq(memories.createdByAgentId, principal.agentId)),
  )).limit(1);
  if (!memory) throw new RelayError("INVALID_INPUT", "Memory not found.", "memory.read", 404);
  return memory;
}

function authorizedConditions(principal: AgentPrincipal, filters: MemoryFilters) {
  const conditions: SQL[] = [
    eq(memories.accountId, principal.accountId),
    isNull(memories.forgottenAt),
    or(eq(memories.scope, "SHARED"), eq(memories.createdByAgentId, principal.agentId))!,
  ];
  if (filters.query) {
    const words = filters.query.toLowerCase().split(/\W+/).filter((word) => word.length > 2);
    if (words.length) conditions.push(or(...words.map((word) => ilike(memories.content, `%${word}%`)))!);
  }
  if (filters.type) conditions.push(eq(memories.type, filters.type));
  if (filters.scope) conditions.push(eq(memories.scope, filters.scope));
  if (filters.createdByAgentId) conditions.push(eq(memories.createdByAgentId, filters.createdByAgentId));
  return conditions;
}

export async function listMemories(principal: AgentPrincipal, filters: MemoryFilters = {}) {
  return db().select(memoryColumns).from(memories).innerJoin(agents, eq(agents.id, memories.createdByAgentId)).where(and(...authorizedConditions(principal, filters))).orderBy(desc(memories.createdAt)).limit(Math.min(filters.limit ?? 100, 250));
}

export async function forgetMemoryAsUser(accountId: string, memoryId: string) {
  const timestamp = now();
  const updated = await db().update(memories).set({ forgottenAt: timestamp, updatedAt: timestamp }).where(and(eq(memories.id, memoryId), eq(memories.accountId, accountId), isNull(memories.forgottenAt))).returning({ id: memories.id });
  if (!updated.length) throw new RelayError("INVALID_INPUT", "Memory not found.", undefined, 404);
}

export async function forgetMemory(principal: AgentPrincipal, memoryId: string) {
  const timestamp = now();
  const updated = await db().update(memories).set({ forgottenAt: timestamp, updatedAt: timestamp }).where(and(
    eq(memories.id, memoryId),
    eq(memories.accountId, principal.accountId),
    isNull(memories.forgottenAt),
    or(eq(memories.createdByAgentId, principal.agentId), eq(memories.scope, "SHARED")),
  )).returning({ id: memories.id });
  if (!updated.length) throw new RelayError("INVALID_INPUT", "Memory not found.", "memory.forget", 404);
}

export async function dashboardMemories(accountId: string, filters: MemoryFilters = {}) {
  const conditions: SQL[] = [eq(memories.accountId, accountId), isNull(memories.forgottenAt)];
  if (filters.query) conditions.push(ilike(memories.content, `%${filters.query}%`));
  if (filters.type) conditions.push(eq(memories.type, filters.type));
  if (filters.scope) conditions.push(eq(memories.scope, filters.scope));
  if (filters.createdByAgentId) conditions.push(eq(memories.createdByAgentId, filters.createdByAgentId));
  return db().select({ ...memoryColumns }).from(memories).innerJoin(agents, eq(agents.id, memories.createdByAgentId)).where(and(...conditions)).orderBy(desc(memories.createdAt)).limit(250);
}
