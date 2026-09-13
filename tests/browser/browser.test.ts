import { readFileSync } from "node:fs";
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgent } from "@/lib/agents";
import { db } from "@/lib/db";
import { activities, browserSessions } from "@/lib/db/schema";
import { handleMcp } from "@/lib/mcp";
import { setBrowserProviderForTests } from "@/lib/providers";
import type { BrowserProvider, BrowserProviderRef, BrowserResourcePolicy } from "@/lib/providers/browser";
import { shareBrowserSession } from "@/lib/browsers";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

class FakeBrowserProvider implements BrowserProvider {
  readonly id = "test-browser";
  readonly sessions = new Map<string, { url: string; text: string }>();
  readonly closed: string[] = [];
  private sequence = 0;

  async create() {
    const resourceId = `provider-${++this.sequence}`;
    this.sessions.set(resourceId, { url: "about:blank", text: "" });
    return { resourceId };
  }

  async navigate(resource: BrowserProviderRef, url: string) {
    const session = this.sessions.get(resource.resourceId)!;
    session.url = url;
    session.text = "Relay browser";
    return { url, title: "Relay" };
  }

  async click(resource: BrowserProviderRef, selector: string) {
    this.sessions.get(resource.resourceId)!.text = `clicked:${selector}`;
  }

  async type(resource: BrowserProviderRef, selector: string, text: string) {
    this.sessions.get(resource.resourceId)!.text = `${selector}:${text}`;
  }

  async extract(resource: BrowserProviderRef, _selector: string | undefined, policy: BrowserResourcePolicy) {
    const session = this.sessions.get(resource.resourceId)!;
    return { url: session.url, text: session.text.slice(0, policy.maxExtractChars), truncated: session.text.length > policy.maxExtractChars };
  }

  async screenshot() { return Uint8Array.from([137, 80, 78, 71]); }

  async close(resource: BrowserProviderRef) {
    this.closed.push(resource.resourceId);
    this.sessions.delete(resource.resourceId);
  }

  async health() { return { ok: true }; }
}

function call(secret: string, name: string, args: Record<string, unknown> = {}) {
  return handleMcp(secret, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
}

function value(result: unknown) {
  return JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
}

const browserCapabilities = ["browser.create", "browser.navigate", "browser.click", "browser.type", "browser.extract", "browser.screenshot", "browser.close"] as const;

describe("governed browser sessions", () => {
  let accountId: string;
  let provider: FakeBrowserProvider;

  beforeEach(async () => {
    accountId = (await freshDatabase()).accountId;
    provider = new FakeBrowserProvider();
    setBrowserProviderForTests(provider);
  });

  afterEach(async () => {
    setBrowserProviderForTests(undefined);
    await cleanupDatabase();
  });

  it("depends on BrowserProvider without leaking Playwright into the domain service", () => {
    const service = readFileSync("lib/browsers.ts", "utf8");
    expect(service).toContain('from "@/lib/providers/browser"');
    expect(service.toLowerCase()).not.toContain("playwright");
  });

  it("is agent-private, supports explicit sharing, and remains account-scoped", async () => {
    const owner = await createAgent(accountId, { name: "Owner", capabilities: [...browserCapabilities] });
    const peer = await createAgent(accountId, { name: "Peer", capabilities: ["browser.extract"] });
    const outsiderAccount = await secondAccount();
    const outsider = await createAgent(outsiderAccount, { name: "Outsider", capabilities: ["browser.extract"] });
    const created = value(await call(owner.credential, "relay_browser_create"));
    expect(created).not.toHaveProperty("providerSessionId");
    await expect(call(peer.credential, "relay_browser_extract", { browserSessionId: created.id })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await shareBrowserSession(accountId, created.id, peer.agentId);
    expect(value(await call(peer.credential, "relay_browser_extract", { browserSessionId: created.id })).url).toBe("about:blank");
    await expect(call(outsider.credential, "relay_browser_extract", { browserSessionId: created.id })).rejects.toMatchObject({ status: 404 });
  });

  it("navigates, types, clicks, extracts, screenshots, closes, and audits actions", async () => {
    const owner = await createAgent(accountId, { name: "Owner", capabilities: [...browserCapabilities] });
    const created = value(await call(owner.credential, "relay_browser_create"));
    expect(value(await call(owner.credential, "relay_browser_navigate", { browserSessionId: created.id, url: "https://example.com/path" }))).toMatchObject({ title: "Relay" });
    await call(owner.credential, "relay_browser_type", { browserSessionId: created.id, selector: "#query", text: "provider neutral" });
    expect(value(await call(owner.credential, "relay_browser_extract", { browserSessionId: created.id })).text).toBe("#query:provider neutral");
    await call(owner.credential, "relay_browser_click", { browserSessionId: created.id, selector: "button" });
    expect(value(await call(owner.credential, "relay_browser_screenshot", { browserSessionId: created.id }))).toMatchObject({ mediaType: "image/png", bytes: 4 });
    expect(value(await call(owner.credential, "relay_browser_close", { browserSessionId: created.id })).status).toBe("DESTROYED");
    const actions = await db().select({ action: activities.action, status: activities.status }).from(activities).where(and(eq(activities.accountId, accountId), eq(activities.provider, "BROWSER"))).orderBy(asc(activities.createdAt), asc(activities.id));
    expect(actions).toHaveLength(7);
    expect(actions.every((activity) => activity.status === "SUCCESS")).toBe(true);
  });

  it("rejects unsafe URL schemes and destroys expired provider sessions", async () => {
    const owner = await createAgent(accountId, { name: "Owner", capabilities: [...browserCapabilities] });
    const created = value(await call(owner.credential, "relay_browser_create"));
    await expect(call(owner.credential, "relay_browser_navigate", { browserSessionId: created.id, url: "file:///etc/passwd" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await db().update(browserSessions).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(and(eq(browserSessions.id, created.id), eq(browserSessions.accountId, accountId)));
    await expect(call(owner.credential, "relay_browser_extract", { browserSessionId: created.id })).rejects.toMatchObject({ status: 410 });
    expect(provider.closed).toHaveLength(1);
  });
});
