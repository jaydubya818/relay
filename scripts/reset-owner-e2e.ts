import { Client } from "pg";
import { db, migrateDatabase, closeDatabase } from "../lib/db";
import { createAccountOwner } from "../lib/auth";
import { agents, capabilityGrants, activities, users, accountMemberships, connections } from "../lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const target = new URL(process.env.RELAY_DATABASE_URL ?? "");
  if (target.hostname !== "127.0.0.1" || target.pathname !== "/relay_e2e_owner_experience") throw new Error("Dedicated loopback owner fixture database required.");
  const admin = new URL(target); admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query("DROP DATABASE IF EXISTS relay_e2e_owner_experience WITH (FORCE)");
    await client.query("CREATE DATABASE relay_e2e_owner_experience");
  } finally { await client.end(); }
  await migrateDatabase();
  const timestamp = "2026-01-15T12:00:00.000Z";
  for (const persona of ["owner", "empty", "member", "operator", "connection"] as const) {
    const user = await createAccountOwner({ accountName: `Synthetic ${persona}`, name: `Synthetic ${persona}`, email: `${persona}@owner-fixture.example`, password: "synthetic-owner-password" });
    if (persona === "member" || persona === "operator") {
      await db().update(users).set({ role: "MEMBER" }).where(eq(users.id, user.id));
      await db().update(accountMemberships).set({ role: persona === "operator" ? "OPERATOR" : "MEMBER" }).where(eq(accountMemberships.accountId, user.accountId));
    }
    if (persona === "connection") {
      await db().insert(connections).values({ id: "conn_layout_fixture", accountId: user.accountId, provider: "GITHUB", displayName: "Synthetic repository connection", status: "CONNECTED", scopes: [], createdAt: timestamp, updatedAt: timestamp });
      await db().insert(activities).values({ id: "act_connection_fixture", accountId: user.accountId, sessionId: "session_layout_fixture", provider: "GITHUB", action: "github.repo.get", capability: "github.repo.read", status: "SUCCESS", durationMs: 24, createdAt: timestamp });
    }
    if (persona !== "owner") continue;
    await db().insert(agents).values({ id: "agt_owner_fixture_sofie", accountId: user.accountId, name: "Sofie", description: "Personal Agent", status: "ACTIVE", createdAt: timestamp, updatedAt: timestamp });
    await db().insert(capabilityGrants).values({ id: "grant_owner_fixture", accountId: user.accountId, agentId: "agt_owner_fixture_sofie", capability: "agent.inbox.get", effect: "ALLOW", createdAt: timestamp });
    await db().insert(connections).values({ id: "conn_owner_fixture", accountId: user.accountId, provider: "GITHUB", displayName: "Synthetic repository connection", status: "CONNECTED", scopes: [], createdAt: timestamp, updatedAt: timestamp });
    await db().insert(activities).values([
      { id: "act_owner_fixture_success", accountId: user.accountId, agentId: "agt_owner_fixture_sofie", sessionId: "session_fixture", action: "agent.inbox.get", capability: "agent.inbox.get", status: "SUCCESS", durationMs: 24, createdAt: timestamp },
      { id: "act_owner_fixture_denied", accountId: user.accountId, agentId: "agt_owner_fixture_sofie", sessionId: "session_fixture", action: "memory.read", capability: "memory.read", status: "DENIED", durationMs: 2, createdAt: timestamp },
    ]);
  }
  await closeDatabase();
}
main().catch(async (error: unknown) => { console.error(error); await closeDatabase(); process.exitCode = 1; });
