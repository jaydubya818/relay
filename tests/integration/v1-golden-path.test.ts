import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent, revokeCredential, rotateCredential, setCapabilityGrant } from "@/lib/agents";
import { connectGitHub, connectGoogle, disconnectGoogle } from "@/lib/connections";
import { db } from "@/lib/db";
import { activities, agentInbox, events } from "@/lib/db/schema";
import { RelayError } from "@/lib/errors";
import { ingestEvent } from "@/lib/events";
import { handleMcp } from "@/lib/mcp";
import { setBrowserProviderForTests, setSandboxProviderForTests } from "@/lib/providers";
import type { BrowserProvider, BrowserProviderRef } from "@/lib/providers/browser";
import type { SandboxProvider, SandboxProviderRef } from "@/lib/providers/sandbox";
import { cleanupDatabase, freshDatabase } from "../helpers";

class GoldenSandbox implements SandboxProvider {
  readonly id = "golden-sandbox"; private files = new Map<string, Map<string, Uint8Array>>();
  async create() { const resourceId = crypto.randomUUID(); this.files.set(resourceId, new Map()); return { resourceId }; }
  async exec(_: SandboxProviderRef, command: string) { return { exitCode: 0, stdout: `ran:${command}`, stderr: "", timedOut: false, truncated: false, durationMs: 1 }; }
  async readFile(resource: SandboxProviderRef, path: string) { return this.files.get(resource.resourceId)!.get(path)!; }
  async writeFile(resource: SandboxProviderRef, path: string, content: Uint8Array) { this.files.get(resource.resourceId)!.set(path, content); }
  async listFiles() { return []; }
  async destroy(resource: SandboxProviderRef) { this.files.delete(resource.resourceId); }
  async health() { return { ok: true }; }
}

class GoldenBrowser implements BrowserProvider {
  readonly id = "golden-browser"; private urls = new Map<string, string>();
  async create() { const resourceId = crypto.randomUUID(); this.urls.set(resourceId, "about:blank"); return { resourceId }; }
  async navigate(resource: BrowserProviderRef, url: string) { if (url.includes("127.0.0.1")) throw new RelayError("CAPABILITY_DENIED", "Private network blocked.", "browser.navigate", 403); this.urls.set(resource.resourceId, url); return { url, title: "Example" }; }
  async click() {} async type() {}
  async extract(resource: BrowserProviderRef) { return { url: this.urls.get(resource.resourceId)!, text: "Example Domain", truncated: false }; }
  async screenshot() { return Uint8Array.from([137, 80, 78, 71]); }
  async close(resource: BrowserProviderRef) { this.urls.delete(resource.resourceId); }
  async health() { return { ok: true }; }
}

function call(secret: string, name: string, args: Record<string, unknown> = {}) { return handleMcp(secret, { method: "tools/call", params: { name, arguments: args } }); }
function value(result: unknown) { return JSON.parse((result as { content: Array<{ text: string }> }).content[0].text); }

describe("Relay V1 final golden path", () => {
  let accountId: string;
  beforeEach(async () => {
    accountId = (await freshDatabase()).accountId; setSandboxProviderForTests(new GoldenSandbox()); setBrowserProviderForTests(new GoldenBrowser());
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("api.github.com/user")) return Response.json({ id: 818, login: "relay", name: "Relay" });
      if (url.includes("api.github.com/user/repos")) return Response.json([{ id: 1, full_name: "relay/relay" }]);
      if (url.endsWith("/profile")) return Response.json({ emailAddress: "relay@example.com" });
      if (url.includes("/messages?")) return Response.json({ messages: [{ id: "mail-1" }] });
      if (url.includes("/events?")) return Response.json({ items: [{ id: "calendar-1" }] });
      throw new Error(`Unexpected URL ${url}`);
    }));
  });
  afterEach(async () => { vi.unstubAllGlobals(); setSandboxProviderForTests(undefined); setBrowserProviderForTests(undefined); await cleanupDatabase(); });

  it("qualifies memory, connectors, execution, browser, events, revocation, and Activity", async () => {
    const claude = await createAgent(accountId, { name: "Claude", capabilities: ["memory.read", "memory.write", "github.repo.read", "email.search", "calendar.event.list", "sandbox.create", "sandbox.exec", "sandbox.file.write", "sandbox.file.read", "sandbox.destroy", "browser.create", "browser.navigate", "browser.extract", "browser.screenshot", "browser.close"] });
    const codex = await createAgent(accountId, { name: "Codex", capabilities: ["memory.read", "agent.inbox.list", "agent.inbox.ack"] });
    await connectGitHub(accountId, "github-token");
    await connectGoogle(accountId, "google-token", { refreshToken: "refresh", expiresAt: new Date(Date.now() + 3600_000).toISOString() });

    await call(claude.credential, "relay_memory_add", { content: "Shared V1 fact", scope: "SHARED" });
    await call(claude.credential, "relay_memory_add", { content: "Claude private fact", scope: "AGENT_PRIVATE" });
    expect(JSON.stringify(await call(codex.credential, "relay_memory_search", { query: "V1 fact" }))).toContain("Shared V1 fact");
    expect(JSON.stringify(await call(codex.credential, "relay_memory_search", { query: "Claude private" }))).not.toContain("Claude private fact");

    expect(JSON.stringify(await call(claude.credential, "relay_github_repo_list"))).toContain("relay/relay");
    await expect(call(codex.credential, "relay_github_repo_list")).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await setCapabilityGrant(accountId, codex.agentId, "github.repo.read", "ALLOW");
    expect(JSON.stringify(await call(codex.credential, "relay_github_repo_list"))).toContain("relay/relay");
    expect(value(await call(claude.credential, "relay_email_search", { query: "newer:1d" })).messages).toHaveLength(1);
    await expect(call(codex.credential, "relay_email_search", { query: "newer:1d" })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await setCapabilityGrant(accountId, codex.agentId, "email.search", "ALLOW");
    expect(value(await call(codex.credential, "relay_email_search", { query: "newer:1d" })).messages).toHaveLength(1);
    expect(value(await call(claude.credential, "relay_calendar_event_list")).items).toHaveLength(1);
    await expect(call(codex.credential, "relay_calendar_event_list")).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });

    const sandbox = value(await call(claude.credential, "relay_sandbox_create"));
    expect(value(await call(claude.credential, "relay_sandbox_exec", { sandboxId: sandbox.id, command: "printf relay" })).stdout).toBe("ran:printf relay");
    await call(claude.credential, "relay_sandbox_file_write", { sandboxId: sandbox.id, path: "proof.txt", content: "sandbox proof" });
    expect(value(await call(claude.credential, "relay_sandbox_file_read", { sandboxId: sandbox.id, path: "proof.txt" })).content).toBe("sandbox proof");
    await expect(call(codex.credential, "relay_sandbox_exec", { sandboxId: sandbox.id, command: "id" })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await call(claude.credential, "relay_sandbox_destroy", { sandboxId: sandbox.id });

    const browser = value(await call(claude.credential, "relay_browser_create"));
    await call(claude.credential, "relay_browser_navigate", { browserSessionId: browser.id, url: "https://example.com" });
    expect(value(await call(claude.credential, "relay_browser_extract", { browserSessionId: browser.id })).text).toBe("Example Domain");
    expect(value(await call(claude.credential, "relay_browser_screenshot", { browserSessionId: browser.id })).bytes).toBe(4);
    await expect(call(claude.credential, "relay_browser_navigate", { browserSessionId: browser.id, url: "http://127.0.0.1" })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await call(claude.credential, "relay_browser_close", { browserSessionId: browser.id });

    const envelope = { accountId, type: "github.push", source: "github", deliveryId: "golden-delivery", occurredAt: new Date().toISOString(), subjectType: "repository", subjectId: "relay/relay" };
    await ingestEvent(envelope, { agentIds: [codex.agentId] }); await ingestEvent(envelope, { agentIds: [codex.agentId] });
    expect(await db().select().from(events).where(and(eq(events.accountId, accountId), eq(events.providerDeliveryId, envelope.deliveryId)))).toHaveLength(1);
    const inbox = value(await call(codex.credential, "relay_agent_inbox_list")); expect(inbox).toHaveLength(1);
    await call(codex.credential, "relay_agent_inbox_ack", { inboxItemId: inbox[0].id });
    expect((await db().select().from(agentInbox).where(eq(agentInbox.id, inbox[0].id)))[0].status).toBe("PROCESSED");

    await revokeCredential(accountId, claude.agentId);
    await expect(handleMcp(claude.credential, { method: "tools/list" })).rejects.toMatchObject({ code: "REVOKED_CREDENTIAL" });
    const replacement = await rotateCredential(accountId, claude.agentId);
    await expect(handleMcp(replacement.secret, { method: "tools/list" })).resolves.toBeDefined();
    await disconnectGoogle(accountId);
    await expect(call(codex.credential, "relay_email_search", { query: "x" })).rejects.toMatchObject({ code: "CONNECTION_REQUIRED" });

    const ledger = await db().select().from(activities).where(eq(activities.accountId, accountId));
    expect([...new Set(ledger.map((entry) => entry.status))]).toEqual(expect.arrayContaining(["SUCCESS", "DENIED", "FAILED"]));
    expect(ledger.every((entry) => Boolean(entry.sessionId))).toBe(true);
    expect(ledger.some((entry) => entry.provider === "GOOGLE")).toBe(true);
    expect(ledger.some((entry) => entry.provider === "SANDBOX" && entry.resourceId === sandbox.id)).toBe(true);
  }, 30_000);
});
