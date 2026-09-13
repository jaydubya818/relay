import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createAgent } from "@/lib/agents";
import { connectGoogle, disconnectGoogle, googleSecret } from "@/lib/connections";
import { decryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { connectionCredentials, connections } from "@/lib/db/schema";
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

  it("recovers an ERROR connection when its existing refresh grant succeeds later", async () => {
    const agent = await createAgent(accountId, { name: "Recovery Agent", capabilities: ["email.search", "calendar.event.list"] });
    await db().update(connectionCredentials).set({ tokenExpiresAt: new Date(Date.now() - 60_000).toISOString() });
    let refreshAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        refreshAttempts += 1;
        if (refreshAttempts === 1) return Response.json({ error: "unauthorized_client", error_description: "Unauthorized" }, { status: 401 });
        return Response.json({ access_token: "recovered-google-token", expires_in: 3600 });
      }
      if (url.endsWith("/profile")) return Response.json({ emailAddress: "workspace@example.com" });
      if (url.includes("/messages?")) return Response.json({ messages: [{ id: "msg-after-refresh" }], resultSizeEstimate: 1 });
      if (url.includes("/events?")) return Response.json({ items: [{ id: "event-after-refresh" }] });
      throw new Error(`Unexpected Google URL: ${url}`);
    }));

    await expect(call(agent.credential, "relay_email_search", { query: "after:refresh" })).rejects.toMatchObject({ code: "CONNECTION_REQUIRED" });
    let [connection] = await db().select().from(connections).where(eq(connections.accountId, accountId));
    expect(connection.status).toBe("ERROR");
    const failedAt = connection.updatedAt;

    expect(value(await call(agent.credential, "relay_email_search", { query: "after:refresh" }))).toMatchObject({ messages: [{ id: "msg-after-refresh" }] });
    expect(value(await call(agent.credential, "relay_calendar_event_list"))).toMatchObject({ items: [{ id: "event-after-refresh" }] });

    [connection] = await db().select().from(connections).where(eq(connections.accountId, accountId));
    const [credential] = await db().select().from(connectionCredentials);
    expect(connection.status).toBe("CONNECTED");
    expect(new Date(connection.updatedAt).getTime()).toBeGreaterThan(new Date(failedAt).getTime());
    expect(decryptSecret(credential.encryptedAccessToken)).toBe("recovered-google-token");
    if (!credential.encryptedRefreshToken || !credential.tokenExpiresAt) throw new Error("Expected durable refresh credentials.");
    expect(decryptSecret(credential.encryptedRefreshToken)).toBe("refresh");
    expect(new Date(credential.tokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(refreshAttempts).toBe(2);
  });

  it("keeps a concurrent successful refresh from being overwritten by a late failure", async () => {
    await db().update(connectionCredentials).set({ tokenExpiresAt: new Date(Date.now() - 60_000).toISOString() });
    let releaseFailure!: () => void;
    const delayedFailure = new Promise<void>((resolve) => { releaseFailure = resolve; });
    let refreshAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (!url.includes("oauth2.googleapis.com/token")) throw new Error(`Unexpected Google URL: ${url}`);
      refreshAttempts += 1;
      if (refreshAttempts === 1) {
        await delayedFailure;
        return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
      }
      return Response.json({ access_token: "concurrent-google-token", expires_in: 3600 });
    }));

    const first = googleSecret(accountId, "email.read");
    await vi.waitFor(() => expect(refreshAttempts).toBe(1));
    const second = googleSecret(accountId, "email.read");
    await expect(second).resolves.toBe("concurrent-google-token");
    releaseFailure();
    await expect(first).resolves.toBe("concurrent-google-token");

    const [connection] = await db().select().from(connections).where(eq(connections.accountId, accountId));
    expect(connection.status).toBe("CONNECTED");
  });
});
