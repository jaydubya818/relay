import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent } from "@/lib/agents";
import { connectGoogle, disconnectGoogle } from "@/lib/connections";
import { handleMcp } from "@/lib/mcp";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

function call(secret: string, name: string, args: Record<string, unknown> = {}) { return handleMcp(secret, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }); }
function value(result: unknown) { return JSON.parse((result as { content: Array<{ text: string }> }).content[0].text); }

describe("Google read capabilities", () => {
  let accountId: string;
  beforeEach(async () => {
    accountId = (await freshDatabase()).accountId;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/profile")) return Response.json({ emailAddress: "workspace@example.com" });
      if (url.includes("/messages?")) return Response.json({ messages: [{ id: "msg-1", threadId: "thread-1" }], resultSizeEstimate: 1 });
      if (url.includes("/messages/msg-1")) return Response.json({ id: "msg-1", threadId: "thread-1", snippet: "hello", payload: { headers: [{ name: "Subject", value: "Relay" }], mimeType: "text/plain", body: { data: Buffer.from("private body").toString("base64url") } } });
      if (url.includes("/events/evt-1")) return Response.json({ id: "evt-1", summary: "Review" });
      if (url.includes("/events?")) return Response.json({ items: [{ id: "evt-1", summary: "Review" }] });
      if (url.endsWith("/freeBusy") && init?.method === "POST") return Response.json({ calendars: { primary: { busy: [] } } });
      throw new Error(`Unexpected Google URL: ${url}`);
    }));
    await connectGoogle(accountId, "valid-google-token", { refreshToken: "refresh", expiresAt: new Date(Date.now() + 3600_000).toISOString(), scopes: ["gmail.readonly", "calendar.readonly"] });
  });
  afterEach(async () => { vi.unstubAllGlobals(); await cleanupDatabase(); });

  it("projects and executes only explicitly granted email and calendar reads", async () => {
    const allowed = await createAgent(accountId, { name: "Allowed", capabilities: ["email.search", "email.read", "calendar.event.list", "calendar.event.read", "calendar.availability.read"] });
    const denied = await createAgent(accountId, { name: "Denied", capabilities: [] });
    const tools = await handleMcp(allowed.credential, { jsonrpc: "2.0", id: 1, method: "tools/list" }) as { tools: Array<{ name: string }> };
    expect(tools.tools.map((tool) => tool.name)).toContain("relay_email_search");
    expect(value(await call(allowed.credential, "relay_email_search", { query: "from:team@example.com" })).messages).toHaveLength(1);
    expect(value(await call(allowed.credential, "relay_email_read", { messageId: "msg-1" }))).toMatchObject({ headers: { subject: "Relay" }, body: "private body" });
    expect(value(await call(allowed.credential, "relay_calendar_event_list"))).toMatchObject({ items: [{ id: "evt-1" }] });
    expect(value(await call(allowed.credential, "relay_calendar_event_read", { eventId: "evt-1" }))).toMatchObject({ id: "evt-1" });
    expect(value(await call(allowed.credential, "relay_calendar_availability_read", { timeMin: "2026-09-13T00:00:00.000Z", timeMax: "2026-09-14T00:00:00.000Z" }))).toHaveProperty("calendars.primary");
    await expect(call(denied.credential, "relay_email_search", { query: "anything" })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  });

  it("fails cleanly after disconnect and never borrows another account's connection", async () => {
    const agent = await createAgent(accountId, { name: "Agent", capabilities: ["email.search"] });
    await disconnectGoogle(accountId);
    await expect(call(agent.credential, "relay_email_search", { query: "anything" })).rejects.toMatchObject({ code: "CONNECTION_REQUIRED" });
    const other = await secondAccount();
    await connectGoogle(other, "other-google-token", { expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    await expect(call(agent.credential, "relay_email_search", { query: "anything" })).rejects.toMatchObject({ code: "CONNECTION_REQUIRED" });
  });
});
