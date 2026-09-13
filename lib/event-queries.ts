import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentInbox, agents, events } from "@/lib/db/schema";

export async function listEvents(accountId: string, limit = 100) {
  return db().select({ id: events.id, type: events.type, source: events.source, occurredAt: events.occurredAt, subjectType: events.subjectType, subjectId: events.subjectId, createdAt: events.createdAt, routed: sql<number>`count(${agentInbox.id})`.mapWith(Number) })
    .from(events).leftJoin(agentInbox, eq(agentInbox.eventId, events.id)).where(eq(events.accountId, accountId)).groupBy(events.id).orderBy(desc(events.createdAt)).limit(limit);
}

export async function listAccountInbox(accountId: string, limit = 100) {
  return db().select({ id: agentInbox.id, agentId: agentInbox.agentId, agentName: agents.name, eventId: agentInbox.eventId, status: agentInbox.status, priority: agentInbox.priority, createdAt: agentInbox.createdAt, completedAt: agentInbox.completedAt, type: events.type, subjectId: events.subjectId })
    .from(agentInbox).innerJoin(agents, eq(agents.id, agentInbox.agentId)).innerJoin(events, eq(events.id, agentInbox.eventId)).where(eq(agentInbox.accountId, accountId)).orderBy(desc(agentInbox.createdAt)).limit(limit);
}
