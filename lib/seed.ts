import { createAgent, listAgents, setCapabilityGrant } from "@/lib/agents";
import { hashPassword } from "@/lib/crypto";
import { db } from "@/lib/db";
import { id, now } from "@/lib/ids";
import { addMemory } from "@/lib/memory";

export function seedDemo() {
  const email = process.env.RELAY_ADMIN_EMAIL ?? "admin@relay.local";
  const password = process.env.RELAY_ADMIN_PASSWORD ?? "relay-local-only";
  let account = db().prepare("SELECT id FROM accounts LIMIT 1").get() as { id: string } | undefined;
  if (!account) {
    const accountId = id("acct");
    const timestamp = now();
    db().prepare("INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, 'Relay Demo', ?, ?)").run(accountId, timestamp, timestamp);
    db().prepare("INSERT INTO users (id, account_id, email, name, password_hash, created_at) VALUES (?, ?, ?, 'Relay Operator', ?, ?)")
      .run(id("usr"), accountId, email, hashPassword(password), timestamp);
    account = { id: accountId };
  }

  const existing = listAgents(account.id);
  const credentials: Array<{ agent: string; secret: string }> = [];
  let claude = existing.find((agent) => agent.name === "Claude Agent");
  if (!claude) {
    const created = createAgent(account.id, { name: "Claude Agent", description: "Primary research and execution agent", capabilities: ["memory.read", "memory.write", "memory.forget", "github.repo.read"] });
    credentials.push({ agent: "Claude Agent", secret: created.credential });
    claude = { id: created.agentId };
  }
  let codex = existing.find((agent) => agent.name === "Codex Agent");
  if (!codex) {
    const created = createAgent(account.id, { name: "Codex Agent", description: "Software implementation agent", capabilities: ["memory.read"] });
    credentials.push({ agent: "Codex Agent", secret: created.credential });
    codex = { id: created.agentId };
  }
  setCapabilityGrant(account.id, codex.id, "github.repo.read", "DENY");

  const hasMemory = db().prepare("SELECT id FROM memories WHERE account_id = ? LIMIT 1").get(account.id);
  if (!hasMemory) {
    addMemory({ credentialId: "seed", accountId: account.id, agentId: claude.id, agentName: "Claude Agent" }, { content: "Project Atlas uses Node 24.", type: "FACT", scope: "SHARED", source: "demo seed" });
  }
  return { accountId: account.id, email, password, credentials };
}
