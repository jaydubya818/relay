import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent, getAgent, revokeCredential } from "@/lib/agents";
import { connectGoogle, disconnectGoogle } from "@/lib/connections";
import { ingestEvent } from "@/lib/events";
import { handleMcp } from "@/lib/mcp";
import { setBrowserProviderForTests, setSandboxProviderForTests } from "@/lib/providers";
import type { BrowserProvider } from "@/lib/providers/browser";
import type { SandboxProvider } from "@/lib/providers/sandbox";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

const sandboxProvider: SandboxProvider = { id: "security-sandbox", async create() { return { resourceId: crypto.randomUUID() }; }, async exec() { return { exitCode: 0, stdout: "ok", stderr: "", timedOut: false, truncated: false, durationMs: 1 }; }, async readFile() { return new Uint8Array(); }, async writeFile() {}, async listFiles() { return []; }, async destroy() {}, async health() { return { ok: true }; } };
const browserProvider: BrowserProvider = { id: "security-browser", async create() { return { resourceId: crypto.randomUUID() }; }, async navigate(_, url) { return { url, title: "Relay" }; }, async click() {}, async type() {}, async extract() { return { url: "about:blank", text: "", truncated: false }; }, async screenshot() { return new Uint8Array(); }, async close() {}, async health() { return { ok: true }; } };
function call(secret: string, name: string, args: Record<string, unknown> = {}) { return handleMcp(secret, { method: "tools/call", params: { name, arguments: args } }); }
function value(result: unknown) { return JSON.parse((result as { content: Array<{ text: string }> }).content[0].text); }

describe("V1 security boundaries", () => {
  let accountId: string;
  beforeEach(async () => { accountId = (await freshDatabase()).accountId; setSandboxProviderForTests(sandboxProvider); setBrowserProviderForTests(browserProvider); resetRateLimitsForTests(); });
  afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); setSandboxProviderForTests(undefined); setBrowserProviderForTests(undefined); resetRateLimitsForTests(); await cleanupDatabase(); });

  it("denies cross-account Agent, sandbox, browser, event, and inbox access", async () => {
    const first = await createAgent(accountId, { name: "First", capabilities: ["sandbox.create", "sandbox.exec", "browser.create", "browser.extract", "agent.inbox.list"] });
    const otherAccount = await secondAccount();
    const second = await createAgent(otherAccount, { name: "Second", capabilities: ["sandbox.exec", "browser.extract", "agent.inbox.list"] });
    await expect(getAgent(otherAccount, first.agentId)).rejects.toMatchObject({ status: 404 });
    const sandbox = value(await call(first.credential, "relay_sandbox_create"));
    const browser = value(await call(first.credential, "relay_browser_create"));
    await expect(call(second.credential, "relay_sandbox_exec", { sandboxId: sandbox.id, command: "id" })).rejects.toMatchObject({ status: 404 });
    await expect(call(second.credential, "relay_browser_extract", { browserSessionId: browser.id })).rejects.toMatchObject({ status: 404 });
    await expect(ingestEvent({ accountId, type: "security.event", source: "test", deliveryId: "security-1", occurredAt: new Date().toISOString(), subjectType: "test", subjectId: "one" }, { agentIds: [second.agentId] })).rejects.toMatchObject({ status: 404 });
    expect(value(await call(second.credential, "relay_agent_inbox_list"))).toEqual([]);
  });

  it("never logs provider tokens or email content", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => String(input).endsWith("/profile") ? Response.json({ emailAddress: "security@example.com" }) : Response.json({ id: "msg", payload: { mimeType: "text/plain", body: { data: Buffer.from("highly-sensitive-email-body").toString("base64url") } } })));
    await connectGoogle(accountId, "never-log-this-token", { expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    const agent = await createAgent(accountId, { name: "Mail", capabilities: ["email.read"] });
    await call(agent.credential, "relay_email_read", { messageId: "msg" });
    const output = JSON.stringify(log.mock.calls);
    expect(output).not.toContain("never-log-this-token");
    expect(output).not.toContain("highly-sensitive-email-body");
  });

  it("enforces credential and connector revocation immediately", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ emailAddress: "security@example.com" })));
    await connectGoogle(accountId, "token", { expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    const agent = await createAgent(accountId, { name: "Revoked", capabilities: ["email.search"] });
    await disconnectGoogle(accountId);
    await expect(call(agent.credential, "relay_email_search", { query: "x" })).rejects.toMatchObject({ code: "CONNECTION_REQUIRED" });
    await revokeCredential(accountId, agent.agentId);
    await expect(handleMcp(agent.credential, { method: "tools/list" })).rejects.toMatchObject({ code: "REVOKED_CREDENTIAL" });
  });

  it("rate limits one credential without affecting another", async () => {
    const first = await createAgent(accountId, { name: "First", capabilities: [] });
    const second = await createAgent(accountId, { name: "Second", capabilities: [] });
    for (let index = 0; index < 120; index += 1) await handleMcp(first.credential, { method: "tools/list" });
    await expect(handleMcp(first.credential, { method: "tools/list" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(handleMcp(second.credential, { method: "tools/list" })).resolves.toBeDefined();
  });
});
