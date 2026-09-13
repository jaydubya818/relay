import { and, asc, count, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { activities, agentInbox, agentWakeRequests, agents, browserSessions, connections, events, sandboxes } from "@/lib/db/schema";

export async function getOverview(accountId: string) {
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [[agentCount], [operationCount], [connectionCount], [failureCount], [denialCount], [sandboxCount], [browserCount], [eventCount], [inboxCount], [wakeCount], recentAgents, providerConnections] = await Promise.all([
    db().select({ value: count() }).from(agents).where(eq(agents.accountId, accountId)),
    db().select({ value: count() }).from(activities).where(and(eq(activities.accountId, accountId), gte(activities.createdAt, dayAgo))),
    db().select({ value: count() }).from(connections).where(and(eq(connections.accountId, accountId), eq(connections.status, "CONNECTED"))),
    db().select({ value: count() }).from(activities).where(and(eq(activities.accountId, accountId), eq(activities.status, "FAILED"), gte(activities.createdAt, dayAgo))),
    db().select({ value: count() }).from(activities).where(and(eq(activities.accountId, accountId), eq(activities.status, "DENIED"), gte(activities.createdAt, dayAgo))),
    db().select({ value: count() }).from(sandboxes).where(and(eq(sandboxes.accountId, accountId), eq(sandboxes.status, "RUNNING"))),
    db().select({ value: count() }).from(browserSessions).where(and(eq(browserSessions.accountId, accountId), eq(browserSessions.status, "RUNNING"))),
    db().select({ value: count() }).from(events).where(eq(events.accountId, accountId)),
    db().select({ value: count() }).from(agentInbox).where(and(eq(agentInbox.accountId, accountId), eq(agentInbox.status, "UNREAD"))),
    db().select({ value: count() }).from(agentWakeRequests).where(and(eq(agentWakeRequests.accountId, accountId), eq(agentWakeRequests.status, "QUEUED"))),
    db().select({ id: agents.id, name: agents.name, status: agents.status }).from(agents).where(eq(agents.accountId, accountId)).orderBy(asc(agents.createdAt)).limit(6),
    db().select({ provider: connections.provider, status: connections.status }).from(connections).where(eq(connections.accountId, accountId)),
  ]);
  const statuses = new Map(providerConnections.map((connection) => [connection.provider, connection.status]));
  return { counts: { agents: agentCount.value, operations: operationCount.value, connections: connectionCount.value, failures: failureCount.value, denials: denialCount.value, sandboxes: sandboxCount.value, browsers: browserCount.value, events: eventCount.value, inbox: inboxCount.value, wakes: wakeCount.value }, agents: recentAgents, githubStatus: statuses.get("GITHUB") ?? "NOT_CONNECTED", googleStatus: statuses.get("GOOGLE") ?? "NOT_CONNECTED" };
}
