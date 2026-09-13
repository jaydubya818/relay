import { eq } from "drizzle-orm";
import { createAgent, listAgents, setCapabilityGrant } from "@/lib/agents";
import { hashPassword } from "@/lib/crypto";
import { db } from "@/lib/db";
import { accounts, memories, users } from "@/lib/db/schema";
import { id, now } from "@/lib/ids";
import { addMemory } from "@/lib/memory";

export async function seedDemo() {
  const email = process.env.RELAY_ADMIN_EMAIL ?? "admin@relay.local";
  const password = process.env.RELAY_ADMIN_PASSWORD ?? "relay-local-only";
  let [account] = await db().select({ id: accounts.id }).from(accounts).limit(1);
  if (!account) {
    const accountId = id("acct");
    const timestamp = now();
    await db().insert(accounts).values({ id: accountId, name: "Relay Demo", createdAt: timestamp, updatedAt: timestamp });
    await db().insert(users).values({ id: id("usr"), accountId, email: email.toLowerCase(), name: "Relay Operator", passwordHash: hashPassword(password), createdAt: timestamp });
    account = { id: accountId };
  }

  const existing = await listAgents(account.id);
  const credentials: Array<{ agent: string; secret: string }> = [];
  let claudeId = existing.find((agent) => agent.name === "Claude Agent")?.id;
  if (!claudeId) {
    const created = await createAgent(account.id, { name: "Claude Agent", description: "Primary research and execution agent", capabilities: ["memory.read", "memory.write", "memory.forget", "github.repo.read"] });
    credentials.push({ agent: "Claude Agent", secret: created.credential });
    claudeId = created.agentId;
  }
  let codexId = existing.find((agent) => agent.name === "Codex Agent")?.id;
  if (!codexId) {
    const created = await createAgent(account.id, { name: "Codex Agent", description: "Software implementation agent", capabilities: ["memory.read"] });
    credentials.push({ agent: "Codex Agent", secret: created.credential });
    codexId = created.agentId;
  }
  await setCapabilityGrant(account.id, codexId, "github.repo.read", "DENY");

  const [hasMemory] = await db().select({ id: memories.id }).from(memories).where(eq(memories.accountId, account.id)).limit(1);
  if (!hasMemory) {
    await addMemory({ credentialId: "seed", accountId: account.id, agentId: claudeId, agentName: "Claude Agent" }, { content: "Project Atlas uses Node 24.", type: "FACT", scope: "SHARED", source: "demo seed" });
  }
  return { accountId: account.id, email, password, credentials };
}
