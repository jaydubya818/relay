import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import type { AgentPrincipal, SessionUser } from "@/lib/types";

export async function dashboardAgent(user: SessionUser, agentId: string): Promise<AgentPrincipal> {
  const [agent] = await db().select({ id: agents.id, name: agents.name }).from(agents).where(and(eq(agents.id, agentId), eq(agents.accountId, user.accountId), eq(agents.status, "ACTIVE"))).limit(1);
  if (!agent) throw new RelayError("INVALID_INPUT", "Active Agent not found.", undefined, 404);
  return { credentialId: `dashboard:${user.id}`, agentId: agent.id, accountId: user.accountId, agentName: agent.name };
}
