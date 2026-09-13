import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgent } from "@/lib/agents";
import { db } from "@/lib/db";
import { agentInbox, agentWakeRequests, events } from "@/lib/db/schema";
import { ingestEvent } from "@/lib/events";
import { handleMcp } from "@/lib/mcp";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

function call(secret: string, name: string, args: Record<string, unknown> = {}) {
  return handleMcp(secret, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
}

function value(result: unknown) { return JSON.parse((result as { content: Array<{ text: string }> }).content[0].text); }

describe("durable events and Agent inbox", () => {
  let accountId: string;
  beforeEach(async () => { accountId = (await freshDatabase()).accountId; });
  afterEach(cleanupDatabase);

  it("ingests idempotently and transactionally routes inbox and wake records", async () => {
    const agent = await createAgent(accountId, { name: "Worker", capabilities: ["agent.inbox.list", "agent.inbox.get", "agent.inbox.ack"] });
    const envelope = { accountId, type: "github.push", source: "github", deliveryId: "delivery-1", occurredAt: new Date().toISOString(), subjectType: "repository", subjectId: "acme/relay", payloadReference: "blob://events/delivery-1" };
    const first = await ingestEvent(envelope, { agentIds: [agent.agentId], priority: 5, wake: true, reason: "Repository changed" });
    const duplicate = await ingestEvent(envelope, { agentIds: [agent.agentId], wake: true });
    expect(first).toMatchObject({ duplicate: false, routed: 1 });
    expect(duplicate).toMatchObject({ duplicate: true, routed: 0 });
    expect(await db().select().from(events).where(eq(events.accountId, accountId))).toHaveLength(1);
    expect(await db().select().from(agentInbox).where(eq(agentInbox.accountId, accountId))).toHaveLength(1);
    expect(await db().select().from(agentWakeRequests).where(eq(agentWakeRequests.accountId, accountId))).toHaveLength(1);
  });

  it("exposes only the owning Agent's inbox and acknowledges durably", async () => {
    const owner = await createAgent(accountId, { name: "Owner", capabilities: ["agent.inbox.list", "agent.inbox.get", "agent.inbox.ack"] });
    const peer = await createAgent(accountId, { name: "Peer", capabilities: ["agent.inbox.list", "agent.inbox.get", "agent.inbox.ack"] });
    const created = await ingestEvent({ accountId, type: "relay.test", source: "relay", deliveryId: "internal-1", occurredAt: new Date().toISOString(), subjectType: "test", subjectId: "one" }, { agentIds: [owner.agentId] });
    const listed = value(await call(owner.credential, "relay_agent_inbox_list"));
    expect(listed).toHaveLength(1);
    expect(value(await call(peer.credential, "relay_agent_inbox_list"))).toHaveLength(0);
    await expect(call(peer.credential, "relay_agent_inbox_get", { inboxItemId: listed[0].id })).rejects.toMatchObject({ status: 404 });
    expect(value(await call(owner.credential, "relay_agent_inbox_ack", { inboxItemId: listed[0].id }))).toMatchObject({ status: "PROCESSED" });
    const [stored] = await db().select().from(agentInbox).where(and(eq(agentInbox.eventId, created.event.id), eq(agentInbox.agentId, owner.agentId)));
    expect(stored.completedAt).toBeTruthy();
  });

  it("rejects routing to another account and exposes searchable capability metadata", async () => {
    const owner = await createAgent(accountId, { name: "Owner", capabilities: ["capabilities.search"] });
    const otherAccount = await secondAccount();
    const outsider = await createAgent(otherAccount, { name: "Outsider" });
    await expect(ingestEvent({ accountId, type: "relay.test", source: "relay", deliveryId: "internal-2", occurredAt: new Date().toISOString(), subjectType: "test", subjectId: "two" }, { agentIds: [outsider.agentId] })).rejects.toMatchObject({ status: 404 });
    const found = value(await call(owner.credential, "relay_capabilities_search", { query: "browser", limit: 20 }));
    expect(found.some((capability: { name: string }) => capability.name === "browser.navigate")).toBe(true);
  });
});
