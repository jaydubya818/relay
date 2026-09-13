import { and, asc, count, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { activities, agents, connections } from "@/lib/db/schema";

export async function getOverview(accountId: string) {
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [[agentCount], [operationCount], [connectionCount], [failureCount], recentAgents, [github]] = await Promise.all([
    db().select({ value: count() }).from(agents).where(eq(agents.accountId, accountId)),
    db().select({ value: count() }).from(activities).where(and(eq(activities.accountId, accountId), gte(activities.createdAt, dayAgo))),
    db().select({ value: count() }).from(connections).where(and(eq(connections.accountId, accountId), eq(connections.status, "CONNECTED"))),
    db().select({ value: count() }).from(activities).where(and(eq(activities.accountId, accountId), eq(activities.status, "FAILED"), gte(activities.createdAt, dayAgo))),
    db().select({ id: agents.id, name: agents.name, status: agents.status }).from(agents).where(eq(agents.accountId, accountId)).orderBy(asc(agents.createdAt)).limit(6),
    db().select({ status: connections.status }).from(connections).where(and(eq(connections.accountId, accountId), eq(connections.provider, "GITHUB"))).limit(1),
  ]);
  return { counts: { agents: agentCount.value, operations: operationCount.value, connections: connectionCount.value, failures: failureCount.value }, agents: recentAgents, githubStatus: github?.status ?? "NOT_CONNECTED" };
}
