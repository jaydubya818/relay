import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserProvider, BrowserProviderRef } from "@/lib/providers/browser";
import type { SandboxProvider, SandboxProviderRef } from "@/lib/providers/sandbox";
import { qualifyExecutionProvider, type ExecutionSpec } from "@/lib/v2/execution-providers";
import { RelayManagedExecutionAdapter, relayManagedManifest } from "@/lib/v2/providers/relay-managed";

class FakeBrowser implements BrowserProvider {
  readonly id = "fake-browser"; readonly sessions = new Set<string>(); readonly calls: string[] = [];
  async create() { const resourceId = crypto.randomUUID(); this.sessions.add(resourceId); return { resourceId }; }
  async navigate(_resource: BrowserProviderRef, url: string) { this.calls.push(`navigate:${url}`); return { url, title: "Relay" }; }
  async click() { this.calls.push("click"); } async type() { this.calls.push("type"); } async key() { this.calls.push("key"); } async scroll() { this.calls.push("scroll"); }
  async extract() { return { url: "data:text/html", text: "Relay", truncated: false }; }
  async screenshot() { return Uint8Array.from([1, 2, 3]); }
  async close(resource: BrowserProviderRef) { this.sessions.delete(resource.resourceId); }
  async health() { return { ok: true }; }
}

class FakeSandbox implements SandboxProvider {
  readonly id = "fake-sandbox"; readonly sessions = new Set<string>(); readonly files = new Map<string, Uint8Array>();
  async create() { const resourceId = crypto.randomUUID(); this.sessions.add(resourceId); return { resourceId }; }
  async exec(_resource: SandboxProviderRef, command: string) { return { exitCode: 0, stdout: command === "env" ? "PATH=/bin" : "ok", stderr: "", timedOut: false, truncated: false, durationMs: 1200 }; }
  async readFile(_resource: SandboxProviderRef, path: string) { return this.files.get(path) ?? new Uint8Array(); }
  async writeFile(_resource: SandboxProviderRef, path: string, content: Uint8Array) { this.files.set(path, content); }
  async listFiles() { return []; }
  async deleteFile(_resource: SandboxProviderRef, path: string) { this.files.delete(path); }
  async destroy(resource: SandboxProviderRef) { this.sessions.delete(resource.resourceId); }
  async health() { return { ok: true }; }
}

const baseSpec: ExecutionSpec & { idempotencyKey: string } = { accountId: "acct_12345678", taskId: "tsk_12345678", actionIntentId: "act_12345678", leaseId: "lse_12345678", region: "local", isolationMode: "process", persistence: "ephemeral", classification: "internal", requiredFeatures: ["browser.visual", "shell", "files"], maximumSessionSeconds: 600, credentialHandles: ["vlt_12345678"], idempotencyKey: "managed-session-one" };
const provenance = { digest: `sha256:${"a".repeat(64)}`, sbomReference: "docs/v2/qualification/relay-managed-sbom.cdx.json" };

describe("Relay-managed execution provider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes the provider SDK conformance contract without overclaiming assurance", () => {
    const provider = new RelayManagedExecutionAdapter({ assertActive: async () => undefined }, { bindHandles: async () => ({ bindingId: "binding" }), revokeBinding: async () => undefined }, provenance, new FakeBrowser(), new FakeSandbox());
    expect(qualifyExecutionProvider(relayManagedManifest, provider)).toMatchObject({ qualified: true });
    expect(relayManagedManifest).toMatchObject({ assurance: "registered", maximumClassification: "internal", persistenceModes: ["ephemeral"] });
  });

  it("executes browser, shell, and file actions while recording hashes rather than sensitive values", async () => {
    const browser = new FakeBrowser(); const sandbox = new FakeSandbox();
    const broker = { bindHandles: vi.fn(async () => ({ bindingId: "binding-1" })), revokeBinding: vi.fn(async () => undefined) };
    const provider = new RelayManagedExecutionAdapter({ assertActive: async () => undefined }, broker, { digest: `sha256:${"a".repeat(64)}`, sbomReference: "sbom:relay-managed:test" }, browser, sandbox);
    const created = await provider.prepareExecution(baseSpec);
    const authority = { accountId: baseSpec.accountId, taskId: baseSpec.taskId, leaseId: baseSpec.leaseId, providerSessionId: created.providerSessionId };
    await provider.browserNavigate({ ...authority, url: "data:text/html,<title>Relay</title>" });
    await provider.browserClick({ ...authority, selector: "#save" });
    await provider.browserType({ ...authority, selector: "#secret", text: "do-not-record-me" });
    await provider.browserKey({ ...authority, key: "Enter" });
    await provider.browserScroll({ ...authority, deltaX: 0, deltaY: 100 });
    expect((await provider.browserScreenshot(authority)).hash).toMatch(/^sha256:/);
    expect(await provider.shellExec({ ...authority, command: "printf ok" })).toMatchObject({ exitCode: 0 });
    await provider.fileWrite({ ...authority, path: "output/result.txt", bytes: new TextEncoder().encode("result") });
    expect(new TextDecoder().decode(await provider.fileRead({ ...authority, path: "output/result.txt" }))).toBe("result");
    await expect(provider.fileList({ ...authority, path: "output" })).resolves.toEqual([]);
    await provider.fileDelete({ ...authority, path: "output/result.txt" });
    const evidence = await provider.collectEvidence({ accountId: baseSpec.accountId, providerSessionId: created.providerSessionId });
    expect(JSON.stringify(evidence)).not.toContain("do-not-record-me");
    expect(JSON.stringify(evidence)).not.toContain("vlt_12345678");
    expect(evidence).toEqual(expect.arrayContaining([expect.objectContaining({ imageDigest: `sha256:${"a".repeat(64)}`, sbomReference: "sbom:relay-managed:test" })]));
    expect(await provider.collectMeters({ accountId: baseSpec.accountId, providerSessionId: created.providerSessionId })).toEqual(expect.arrayContaining([expect.objectContaining({ dimension: "COMPUTE_SECONDS", amount: "2" }), expect.objectContaining({ dimension: "COMPUTER_SECONDS" })]));
    expect(broker.bindHandles).toHaveBeenCalledWith(expect.objectContaining({ handles: ["vlt_12345678"], audience: created.providerSessionId }));
  });

  it("blocks SSRF, path escape, absolute paths, and raw credential material", async () => {
    const provider = new RelayManagedExecutionAdapter({ assertActive: async () => undefined }, { bindHandles: async () => ({ bindingId: "binding" }), revokeBinding: async () => undefined }, provenance, new FakeBrowser(), new FakeSandbox());
    const created = await provider.prepareExecution({ ...baseSpec, credentialHandles: [] });
    const authority = { accountId: baseSpec.accountId, taskId: baseSpec.taskId, leaseId: baseSpec.leaseId, providerSessionId: created.providerSessionId };
    await expect(provider.browserNavigate({ ...authority, url: "http://127.0.0.1:3000" })).rejects.toMatchObject({ status: 403 });
    await expect(provider.fileRead({ ...authority, path: "../etc/passwd" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(provider.fileRead({ ...authority, path: "/etc/passwd" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(provider.prepareExecution({ ...baseSpec, idempotencyKey: "raw-secret", credentialHandles: ["password=secret"] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("enforces tenant/task/lease bindings and rechecks authority on every action", async () => {
    let active = true;
    const authorizer = { assertActive: vi.fn(async () => { if (!active) throw Object.assign(new Error("lease revoked"), { status: 403 }); }) };
    const provider = new RelayManagedExecutionAdapter(authorizer, { bindHandles: async () => ({ bindingId: "binding" }), revokeBinding: async () => undefined }, provenance, new FakeBrowser(), new FakeSandbox());
    const created = await provider.prepareExecution({ ...baseSpec, credentialHandles: [] });
    const authority = { accountId: baseSpec.accountId, taskId: baseSpec.taskId, leaseId: baseSpec.leaseId, providerSessionId: created.providerSessionId };
    await expect(provider.shellExec({ ...authority, accountId: "acct_other123", command: "true" })).rejects.toMatchObject({ status: 404 });
    await expect(provider.collectEvidence({ accountId: "acct_other123", providerSessionId: created.providerSessionId })).rejects.toMatchObject({ status: 404 });
    await expect(provider.terminate({ accountId: "acct_other123", providerSessionId: created.providerSessionId })).resolves.toEqual({ status: "NOT_FOUND" });
    await provider.control({ ...authority, command: "pause" });
    await expect(provider.shellExec({ ...authority, command: "true" })).rejects.toMatchObject({ status: 409 });
    await provider.control({ ...authority, command: "resume" });
    active = false;
    await expect(provider.shellExec({ ...authority, command: "true" })).rejects.toMatchObject({ status: 403 });
    expect(authorizer.assertActive).toHaveBeenCalledWith(expect.objectContaining({ capability: "computer.shell.exec" }));
  });

  it("removes resource and credential access on termination and makes cleanup idempotent", async () => {
    const browser = new FakeBrowser(); const sandbox = new FakeSandbox();
    const broker = { bindHandles: async () => ({ bindingId: "binding-1" }), revokeBinding: vi.fn(async () => undefined) };
    const provider = new RelayManagedExecutionAdapter({ assertActive: async () => undefined }, broker, provenance, browser, sandbox);
    const created = await provider.prepareExecution(baseSpec);
    expect(await provider.terminate({ accountId: baseSpec.accountId, providerSessionId: created.providerSessionId })).toEqual({ status: "TERMINATED" });
    expect(await provider.terminate({ accountId: baseSpec.accountId, providerSessionId: created.providerSessionId })).toEqual({ status: "TERMINATED" });
    expect(browser.sessions.size).toBe(0); expect(sandbox.sessions.size).toBe(0); expect(broker.revokeBinding).toHaveBeenCalledWith({ accountId: baseSpec.accountId, bindingId: "binding-1" });
    await expect(provider.shellExec({ accountId: baseSpec.accountId, taskId: baseSpec.taskId, leaseId: baseSpec.leaseId, providerSessionId: created.providerSessionId, command: "true" })).rejects.toMatchObject({ status: 404 });
    expect(await provider.reconcile({ accountId: baseSpec.accountId, idempotencyKey: baseSpec.idempotencyKey, providerSessionId: created.providerSessionId })).toEqual({ status: "TERMINATED" });
  });
});
