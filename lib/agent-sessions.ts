import { and, desc, eq, gt } from "drizzle-orm";
import { db, withTransaction } from "@/lib/db";
import { lockActiveAccount } from "@/lib/account-fence";
import { agentSessions } from "@/lib/db/schema";
import { id, now } from "@/lib/ids";
import type { AgentPrincipal } from "@/lib/types";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export async function touchAgentSession(principal: AgentPrincipal, runtime = "mcp") {
  return withTransaction(async (transaction) => {
    await lockActiveAccount(transaction, principal.accountId);
    const timestamp = now();
    const [existing] = await transaction.select().from(agentSessions).where(and(
      eq(agentSessions.accountId, principal.accountId), eq(agentSessions.agentId, principal.agentId),
      eq(agentSessions.credentialId, principal.credentialId), eq(agentSessions.runtime, runtime),
      eq(agentSessions.status, "ACTIVE"), gt(agentSessions.expiresAt, timestamp),
    )).orderBy(desc(agentSessions.lastSeenAt)).limit(1);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    if (existing) {
      await transaction.update(agentSessions).set({ lastSeenAt: timestamp, expiresAt }).where(and(eq(agentSessions.id, existing.id), eq(agentSessions.accountId, principal.accountId)));
      return { ...existing, lastSeenAt: timestamp, expiresAt };
    }
    const [session] = await transaction.insert(agentSessions).values({ id: id("ags"), accountId: principal.accountId, agentId: principal.agentId, runtime, credentialId: principal.credentialId, createdAt: timestamp, lastSeenAt: timestamp, expiresAt }).returning();
    return session;
  });
}

export async function listAgentSessions(accountId: string, agentId: string) {
  return db().select().from(agentSessions).where(and(eq(agentSessions.accountId, accountId), eq(agentSessions.agentId, agentId))).orderBy(desc(agentSessions.lastSeenAt)).limit(25);
}
