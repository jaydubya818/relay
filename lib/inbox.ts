import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentInbox, events } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { now } from "@/lib/ids";
import type { AgentPrincipal } from "@/lib/types";

const projection = {
  id: agentInbox.id, eventId: agentInbox.eventId, status: agentInbox.status, priority: agentInbox.priority,
  createdAt: agentInbox.createdAt, claimedAt: agentInbox.claimedAt, completedAt: agentInbox.completedAt,
  type: events.type, source: events.source, occurredAt: events.occurredAt, subjectType: events.subjectType,
  subjectId: events.subjectId, payloadReference: events.payloadReference,
};

export async function listInbox(principal: AgentPrincipal, status?: "UNREAD" | "CLAIMED" | "PROCESSED" | "FAILED", limit = 50) {
  return db().select(projection).from(agentInbox).innerJoin(events, and(eq(events.id, agentInbox.eventId), eq(events.accountId, agentInbox.accountId)))
    .where(and(eq(agentInbox.accountId, principal.accountId), eq(agentInbox.agentId, principal.agentId), ...(status ? [eq(agentInbox.status, status)] : [])))
    .orderBy(desc(agentInbox.priority), desc(agentInbox.createdAt)).limit(Math.min(limit, 100));
}

export async function getInboxItem(principal: AgentPrincipal, inboxItemId: string) {
  const [item] = await db().select(projection).from(agentInbox).innerJoin(events, and(eq(events.id, agentInbox.eventId), eq(events.accountId, agentInbox.accountId)))
    .where(and(eq(agentInbox.id, inboxItemId), eq(agentInbox.accountId, principal.accountId), eq(agentInbox.agentId, principal.agentId))).limit(1);
  if (!item) throw new RelayError("INVALID_INPUT", "Inbox item not found.", undefined, 404);
  return item;
}

export async function acknowledgeInboxItem(principal: AgentPrincipal, inboxItemId: string, outcome: "PROCESSED" | "FAILED" = "PROCESSED") {
  const timestamp = now();
  const [item] = await db().update(agentInbox).set({ status: outcome, claimedAt: timestamp, completedAt: timestamp })
    .where(and(eq(agentInbox.id, inboxItemId), eq(agentInbox.accountId, principal.accountId), eq(agentInbox.agentId, principal.agentId))).returning({ id: agentInbox.id, status: agentInbox.status, completedAt: agentInbox.completedAt });
  if (!item) throw new RelayError("INVALID_INPUT", "Inbox item not found.", undefined, 404);
  return item;
}
