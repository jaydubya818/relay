import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { eq, sql } from "drizzle-orm";
import { db, migrateDatabase, closeDatabase } from "../lib/db";
import { createAccountOwner } from "../lib/auth";
import { createAgent } from "../lib/agents";
import { principals } from "../lib/db/schema";
import { productionCryptoBindings } from "../lib/v2/production-crypto";
import { providerUserId, type IntegrationBinding } from "../lib/integrations/contracts";
import { IntegrationConnectionStore } from "../lib/integrations/persistence";
import { integrationConnections } from "../lib/integrations/schema";

async function main() {
  const target = new URL(process.env.RELAY_DATABASE_URL ?? "");
  if (target.hostname !== "127.0.0.1" || target.pathname !== "/relay_e2e_integrations") throw new Error("Dedicated loopback integration fixture database required.");
  const admin = new URL(target); admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() }); await client.connect();
  try {
    await client.query("DROP DATABASE IF EXISTS relay_e2e_integrations WITH (FORCE)");
    await client.query("CREATE DATABASE relay_e2e_integrations");
  } finally { await client.end(); }
  await migrateDatabase();
  await db().execute(sql.raw(await readFile("lib/integrations/qualification.sql", "utf8")));
  for (const persona of ["owner", "other", "paginated"]) {
    const user = await createAccountOwner({ accountName: `Synthetic ${persona}`, name: `Synthetic ${persona}`, email: `${persona}@integration-fixture.example`, password: "synthetic-integration-password" });
    if (persona === "other") continue;
    const [principal] = await db().select().from(principals).where(eq(principals.userId, user.id));
    const agent = await createAgent(user.accountId, { name: "Synthetic Research Agent", capabilities: ["github.repo.read"] });
    const scope = { accountId: user.accountId, ownerPrincipalId: principal.id, agentId: agent.agentId, installationId: "installation_synthetic" };
    const store = new IntegrationConnectionStore(productionCryptoBindings(process.env).signer);
    const binding: IntegrationBinding = { ...scope, connectionId: "cnx_browser_synthetic", provider: "composio", toolkit: "github",
      providerUserId: providerUserId(scope), connectedAccountId: "ca_browser_synthetic", authConfigId: "ac_synthetic", custody: "COMPOSIO",
      scopes: ["repo:read"], authorityVersion: 1, status: "CONNECTED", expiresAt: null, revokedAt: null };
    if (persona === "paginated") {
      // Listing/revocation regression data only; no provider connections are created.
      await db().insert(integrationConnections).values(Array.from({ length: 101 }, (_, index) => {
        const connectionId = `cnx_paged_${String(index).padStart(3, "0")}`;
        const connectedAccountId = `ca_paged_${index}`;
        return { id: connectionId, ...scope, connectedAccountId, binding: { ...binding, connectionId, connectedAccountId },
          updatedAt: new Date(index === 100 ? 0 : Date.now()).toISOString() };
      }));
      continue;
    }
    // Deterministic provider confirmation, no SDK or network credentials involved.
    await store.persistConfirmed(scope, binding, "browser-fixture-connect", { async connectionStatus() { return { connectedAccountId: binding.connectedAccountId, status: "ACTIVE", disabled: false }; } });
  }
  await closeDatabase();
}
main().catch(async () => { console.error("Synthetic integration fixture setup failed."); await closeDatabase(); process.exitCode = 1; });
