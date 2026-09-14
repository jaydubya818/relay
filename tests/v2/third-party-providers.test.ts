import { describe, expect, it, vi } from "vitest";
import { qualifyExecutionProvider, ProviderDispatchError, type ExecutionSpec } from "@/lib/v2/execution-providers";
import { BrowserbaseExecutionAdapter, browserbaseManifest, type BrowserbaseClient, type BrowserbaseSession } from "@/lib/v2/providers/browserbase";
import { E2BExecutionAdapter, e2bManifest, type E2BClient, type E2BSandbox } from "@/lib/v2/providers/e2b";
import { ProviderApiError, type ProviderKillSwitch } from "@/lib/v2/providers/third-party";

const credentials = { apiKey: vi.fn(async () => "provider-super-secret") };
const enabled = { enabled: vi.fn(async () => true) };
const authorizer = { assertActive: vi.fn(async () => undefined) };
const noWait = { sleep: vi.fn(async () => undefined) };
const browserSpec: ExecutionSpec & { idempotencyKey: string } = { accountId: "acct_12345678", taskId: "tsk_12345678", actionIntentId: "act_12345678", leaseId: "lse_12345678", region: "us-west-2", isolationMode: "process", persistence: "ephemeral", classification: "internal", requiredFeatures: ["browser.visual", "live_observation"], maximumSessionSeconds: 600, credentialHandles: [], idempotencyKey: "bb-one" };
const e2bSpec: ExecutionSpec & { idempotencyKey: string } = { ...browserSpec, region: "us", isolationMode: "microvm", requiredFeatures: ["shell", "files", "pause"], idempotencyKey: "e2b-one" };

class FakeBrowserbase implements BrowserbaseClient {
  sessions = new Map<string, BrowserbaseSession>(); liveCounter = 0; createError?: Error; readonly inputs: unknown[] = [];
  async createSession(input: Parameters<BrowserbaseClient["createSession"]>[0]) { this.inputs.push(input); if (this.createError) throw this.createError; const session = { id: "bb-session-1", status: "RUNNING", expiresAt: new Date(Date.now() + 600_000).toISOString(), connectUrl: "wss://secret-connect" } as const; this.sessions.set(session.id, session); return session; }
  async getSession(input: Parameters<BrowserbaseClient["getSession"]>[0]) { return this.sessions.get(input.sessionId); }
  async endSession(input: Parameters<BrowserbaseClient["endSession"]>[0]) { this.sessions.delete(input.sessionId); }
  async liveUrls() { this.liveCounter += 1; return { debuggerFullscreenUrl: `https://live.example/${this.liveCounter}?short=token`, pages: [{ id: "page-1", url: "https://example.com" }] }; }
  async replayPages() { return [{ pageId: "page-1", startTimeMs: 0, endTimeMs: 1000 }]; }
  async navigate(input: Parameters<BrowserbaseClient["navigate"]>[0]) { return { url: input.url, title: "Relay" }; }
  async click() {} async type() {} async key() {} async scroll() {} async screenshot() { return Uint8Array.from([1, 2, 3]); }
}

class FakeE2B implements E2BClient {
  sessions = new Map<string, E2BSandbox>(); files = new Map<string, Uint8Array>(); createError?: Error; readonly inputs: unknown[] = [];
  async createSandbox(input: Parameters<E2BClient["createSandbox"]>[0]) { this.inputs.push(input); if (this.createError) throw this.createError; const sandbox = { id: "e2b-session-1", state: "running", expiresAt: new Date(Date.now() + 600_000).toISOString() } as const; this.sessions.set(sandbox.id, sandbox); return sandbox; }
  async getSandbox(input: Parameters<E2BClient["getSandbox"]>[0]) { return this.sessions.get(input.sandboxId); }
  async runCommand(input: Parameters<E2BClient["runCommand"]>[0]) { return { exitCode: 0, stdout: input.command === "env" ? "PATH=/bin" : "ok", stderr: "", durationMs: 1200 }; }
  async readFile(input: Parameters<E2BClient["readFile"]>[0]) { return this.files.get(input.path) ?? new Uint8Array(); }
  async writeFile(input: Parameters<E2BClient["writeFile"]>[0]) { this.files.set(input.path, input.bytes); }
  async listFiles() { return [...this.files.keys()].map((path) => ({ path, kind: "FILE" as const })); }
  async deleteFile(input: Parameters<E2BClient["deleteFile"]>[0]) { this.files.delete(input.path); }
  async pause(input: Parameters<E2BClient["pause"]>[0]) { const value = this.sessions.get(input.sandboxId)!; this.sessions.set(input.sandboxId, { ...value, state: "paused" }); }
  async resume(input: Parameters<E2BClient["resume"]>[0]) { const value = { ...this.sessions.get(input.sandboxId)!, state: "running" as const }; this.sessions.set(input.sandboxId, value); return value; }
  async kill(input: Parameters<E2BClient["kill"]>[0]) { this.sessions.delete(input.sandboxId); }
}

function browserbase(client = new FakeBrowserbase(), switchValue: ProviderKillSwitch = enabled) { return { client, adapter: new BrowserbaseExecutionAdapter(client, credentials, switchValue, authorizer, "project", noWait) }; }
function e2b(client = new FakeE2B(), switchValue: ProviderKillSwitch = enabled) { return { client, adapter: new E2BExecutionAdapter(client, credentials, switchValue, authorizer, "relay-v2", noWait) }; }

describe("WO-13 third-party execution providers", () => {
  it("passes the common provider contract without translating vendor claims into Relay assurance", () => {
    expect(qualifyExecutionProvider(browserbaseManifest, browserbase().adapter)).toMatchObject({ qualified: true });
    expect(qualifyExecutionProvider(e2bManifest, e2b().adapter)).toMatchObject({ qualified: true });
    expect(browserbaseManifest).toMatchObject({ assurance: "registered", persistenceModes: ["ephemeral"], supportsIdempotentCreate: false });
    expect(e2bManifest).toMatchObject({ assurance: "registered", persistenceModes: ["ephemeral"], supportsIdempotentCreate: false });
  });

  it.each(["browserbase", "e2b"])("substitutes %s through the same Agent-facing execution contract", async (kind) => {
    const adapter = kind === "browserbase" ? browserbase().adapter : e2b().adapter;
    const spec = kind === "browserbase" ? browserSpec : e2bSpec;
    const result = await adapter.prepareExecution(spec);
    expect(result.providerSessionId).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("provider-super-secret");
    await expect(adapter.terminate({ accountId: spec.accountId, providerSessionId: result.providerSessionId })).resolves.toEqual({ status: "TERMINATED" });
  });

  it("refreshes Browserbase live URLs and exposes replay metadata without exposing the API key", async () => {
    const { adapter } = browserbase(); const created = await adapter.prepareExecution(browserSpec);
    const authority = { accountId: browserSpec.accountId, taskId: browserSpec.taskId, leaseId: browserSpec.leaseId, providerSessionId: created.providerSessionId };
    const first = await adapter.getLiveView(authority); const second = await adapter.getLiveView(authority);
    expect(first.debuggerFullscreenUrl).not.toBe(second.debuggerFullscreenUrl);
    expect(await adapter.replayPages(authority)).toEqual([{ pageId: "page-1", startTimeMs: 0, endTimeMs: 1000 }]);
    expect(JSON.stringify([first, second])).not.toContain("provider-super-secret");
  });

  it("controls Browserbase through the same bounded visual-browser actions without recording typed values", async () => {
    const { adapter } = browserbase(); const created = await adapter.prepareExecution(browserSpec);
    const authority = { accountId: browserSpec.accountId, taskId: browserSpec.taskId, leaseId: browserSpec.leaseId, providerSessionId: created.providerSessionId };
    await expect(adapter.browserNavigate({ ...authority, url: "https://example.com" })).resolves.toMatchObject({ title: "Relay" });
    await adapter.browserClick({ ...authority, selector: "#save" });
    await adapter.browserType({ ...authority, selector: "#secret", text: "do-not-record-me" });
    await adapter.browserKey({ ...authority, key: "Enter" }); await adapter.browserScroll({ ...authority, deltaX: 0, deltaY: 100 });
    expect((await adapter.browserScreenshot(authority)).hash).toMatch(/^sha256:/);
    expect(JSON.stringify(await adapter.collectEvidence({ accountId: browserSpec.accountId, providerSessionId: created.providerSessionId }))).not.toContain("do-not-record-me");
  });

  it("supports E2B shell/files and account-bound beta pause/resume", async () => {
    const { adapter } = e2b(); const created = await adapter.prepareExecution(e2bSpec);
    const authority = { accountId: e2bSpec.accountId, taskId: e2bSpec.taskId, leaseId: e2bSpec.leaseId, providerSessionId: created.providerSessionId };
    await adapter.fileWrite({ ...authority, path: "output/result.txt", bytes: new TextEncoder().encode("ok") });
    expect(new TextDecoder().decode(await adapter.fileRead({ ...authority, path: "output/result.txt" }))).toBe("ok");
    expect(await adapter.shellExec({ ...authority, command: "true" })).toMatchObject({ exitCode: 0 });
    await expect(adapter.pause(authority)).resolves.toEqual({ status: "PAUSED" });
    await expect(adapter.shellExec({ ...authority, command: "true" })).rejects.toMatchObject({ status: 409 });
    await expect(adapter.resume(authority)).resolves.toEqual({ status: "RUNNING" });
  });

  it.each(["browserbase", "e2b"])("keeps %s API credentials server-side and refuses unqualified secret injection", async (kind) => {
    const selection = kind === "browserbase" ? browserbase() : e2b(); const spec = kind === "browserbase" ? browserSpec : e2bSpec;
    await expect(selection.adapter.prepareExecution({ ...spec, credentialHandles: ["vlt_12345678"] })).rejects.toMatchObject({ status: 403 });
    expect(selection.client.inputs).toHaveLength(0);
  });

  it.each(["browserbase", "e2b"])("classifies %s create 429 as rejected and 5xx/timeout as ambiguous", async (kind) => {
    const make = () => kind === "browserbase" ? browserbase() : e2b(); const spec = kind === "browserbase" ? browserSpec : e2bSpec;
    const limited = make(); limited.client.createError = new ProviderApiError("secret body", "HTTP", 429, 10);
    await expect(limited.adapter.prepareExecution(spec)).rejects.toMatchObject({ phase: "PRE_EFFECT", errorClass: "ProviderRateLimited" });
    const failed = make(); failed.client.createError = new ProviderApiError("secret body", "HTTP", 503);
    await expect(failed.adapter.prepareExecution(spec)).rejects.toMatchObject({ phase: "POSSIBLY_COMMITTED", errorClass: "ProviderHTTP" });
    const timeout = make(); timeout.client.createError = new ProviderApiError("secret body", "TIMEOUT");
    await expect(timeout.adapter.prepareExecution(spec)).rejects.toMatchObject({ phase: "POSSIBLY_COMMITTED", errorClass: "ProviderTIMEOUT" });
  });

  it("fails unsupported provider features explicitly", async () => {
    await expect(browserbase().adapter.control({ accountId: browserSpec.accountId, taskId: browserSpec.taskId, leaseId: browserSpec.leaseId, providerSessionId: "missing", command: "pause" })).rejects.toMatchObject({ status: 501 });
    await expect(e2b().adapter.control({ accountId: e2bSpec.accountId, taskId: e2bSpec.taskId, leaseId: e2bSpec.leaseId, providerSessionId: "missing", command: "takeover" })).rejects.toMatchObject({ status: 501 });
    await expect(browserbase().adapter.prepareExecution({ ...browserSpec, requiredFeatures: ["shell"] })).rejects.toMatchObject({ status: 403 });
  });

  it.each(["browserbase", "e2b"])("enforces the new %s tenant/session boundary on every scoped operation", async (kind) => {
    const adapter = kind === "browserbase" ? browserbase().adapter : e2b().adapter; const spec = kind === "browserbase" ? browserSpec : e2bSpec;
    const created = await adapter.prepareExecution(spec);
    if (adapter instanceof BrowserbaseExecutionAdapter) await expect(adapter.getLiveView({ accountId: "acct_other123", taskId: spec.taskId, leaseId: spec.leaseId, providerSessionId: created.providerSessionId })).rejects.toMatchObject({ status: 404 });
    else await expect(adapter.shellExec({ accountId: "acct_other123", taskId: spec.taskId, leaseId: spec.leaseId, providerSessionId: created.providerSessionId, command: "true" })).rejects.toMatchObject({ status: 404 });
    await expect(adapter.collectEvidence({ accountId: "acct_other123", providerSessionId: created.providerSessionId })).rejects.toMatchObject({ status: 404 });
    await expect(adapter.terminate({ accountId: "acct_other123", providerSessionId: created.providerSessionId })).resolves.toEqual({ status: "NOT_FOUND" });
    await expect(adapter.reconcile({ accountId: "acct_other123", idempotencyKey: spec.idempotencyKey, providerSessionId: created.providerSessionId })).resolves.toEqual({ status: "NOT_FOUND" });
  });

  it.each(["browserbase", "e2b"])("honors the %s provider kill switch before create", async (kind) => {
    const off = { enabled: async () => false }; const selection = kind === "browserbase" ? browserbase(new FakeBrowserbase(), off) : e2b(new FakeE2B(), off);
    await expect(selection.adapter.prepareExecution(kind === "browserbase" ? browserSpec : e2bSpec)).rejects.toBeInstanceOf(ProviderDispatchError);
  });
});
