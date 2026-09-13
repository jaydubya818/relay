import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { activities, agentInbox, agentWakeRequests, agents, events } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { id, now } from "@/lib/ids";

export type EventEnvelope = {
  accountId: string;
  type: string;
  source: string;
  deliveryId: string;
  occurredAt: string;
  subjectType: string;
  subjectId: string;
  payloadReference?: string;
};

export async function ingestEvent(input: EventEnvelope, route: { agentIds: string[]; priority?: number; wake?: boolean; reason?: string; preferredRuntime?: string }) {
  if (!input.deliveryId.trim()) throw new RelayError("INVALID_INPUT", "Event delivery ID is required for idempotency.");
  if (!input.type.trim() || !input.source.trim() || !input.subjectType.trim() || !input.subjectId.trim()) throw new RelayError("INVALID_INPUT", "Event envelope is incomplete.");
  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw new RelayError("INVALID_INPUT", "Event occurrence time is invalid.");

  return db().transaction(async (transaction) => {
    const recipients = route.agentIds.length
      ? await transaction.select({ id: agents.id }).from(agents).where(and(eq(agents.accountId, input.accountId), eq(agents.status, "ACTIVE")))
      : [];
    const allowed = new Set(recipients.map((agent) => agent.id));
    if (route.agentIds.some((agentId) => !allowed.has(agentId))) throw new RelayError("INVALID_INPUT", "Event recipient is not an active Agent in this account.", undefined, 404);
    const timestamp = now();
    const [event] = await transaction.insert(events).values({
      id: id("evt"), accountId: input.accountId, type: input.type.trim(), source: input.source.trim(),
      providerDeliveryId: input.deliveryId.trim(), occurredAt: occurredAt.toISOString(), subjectType: input.subjectType.trim(),
      subjectId: input.subjectId.trim(), payloadReference: input.payloadReference, createdAt: timestamp,
    }).onConflictDoNothing({ target: [events.accountId, events.source, events.providerDeliveryId] }).returning();
    if (!event) {
      const [existing] = await transaction.select().from(events).where(and(eq(events.accountId, input.accountId), eq(events.source, input.source), eq(events.providerDeliveryId, input.deliveryId))).limit(1);
      return { event: existing, duplicate: true, routed: 0 };
    }
    await transaction.insert(activities).values({
      id: id("act"), accountId: input.accountId, sessionId: `event:${input.source}:${input.deliveryId}`,
      capability: "event.ingest", provider: input.source.toUpperCase(), action: "event.ingest",
      status: "SUCCESS", durationMs: 0, resourceType: "event", resourceId: event.id,
      createdAt: timestamp, metadata: { type: input.type, routedAgents: new Set(route.agentIds).size },
    });
    for (const agentId of [...new Set(route.agentIds)]) {
      await transaction.insert(agentInbox).values({ id: id("inb"), accountId: input.accountId, agentId, eventId: event.id, priority: route.priority ?? 0, createdAt: timestamp });
      if (route.wake) await transaction.insert(agentWakeRequests).values({ id: id("wak"), accountId: input.accountId, agentId, eventId: event.id, reason: route.reason ?? input.type, preferredRuntime: route.preferredRuntime, createdAt: timestamp, updatedAt: timestamp });
    }
    return { event, duplicate: false, routed: new Set(route.agentIds).size };
  });
}
