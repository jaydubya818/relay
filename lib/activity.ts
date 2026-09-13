import { and, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { activities, agents } from "@/lib/db/schema";
import { id, now } from "@/lib/ids";
import type { ActivityStatus } from "@/lib/types";

export async function recordActivity(input: {
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
  await db().insert(activities).values({
    id: id("act"), accountId: input.accountId, agentId: input.agentId,
    sessionId: input.sessionId, capability: input.capability, provider: input.provider,
    action: input.action, status: input.status, durationMs: Math.max(0, Math.round(input.durationMs)),
    createdAt: now(), metadata: input.metadata ?? {},
  });
}

export async function listActivity(accountId: string, filters: { agentId?: string; capability?: string; status?: ActivityStatus; provider?: string; limit?: number } = {}) {
  const conditions: SQL[] = [eq(activities.accountId, accountId)];
  if (filters.agentId) conditions.push(eq(activities.agentId, filters.agentId));
  if (filters.capability) conditions.push(eq(activities.capability, filters.capability));
  if (filters.status) conditions.push(eq(activities.status, filters.status));
  if (filters.provider) conditions.push(eq(activities.provider, filters.provider));
  return db().select({
    id: activities.id, agentId: activities.agentId, agentName: agents.name,
    sessionId: activities.sessionId, capability: activities.capability, provider: activities.provider,
    action: activities.action, status: activities.status, durationMs: activities.durationMs,
    createdAt: activities.createdAt, metadata: activities.metadata,
  }).from(activities).leftJoin(agents, eq(agents.id, activities.agentId)).where(and(...conditions)).orderBy(desc(activities.createdAt), desc(activities.id)).limit(Math.min(filters.limit ?? 100, 250));
}
