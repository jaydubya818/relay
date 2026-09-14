import { createHash } from "node:crypto";
import { posix } from "node:path";
import { performance } from "node:perf_hooks";
import { RelayError } from "@/lib/errors";
import { id } from "@/lib/ids";
import type { BrowserProvider, BrowserProviderRef, BrowserResourcePolicy } from "@/lib/providers/browser";
import { PlaywrightBrowserProvider, assertPublicRequest } from "@/lib/providers/playwright-browser";
import type { SandboxProvider, SandboxProviderRef, SandboxResourcePolicy } from "@/lib/providers/sandbox";
import { DockerSandboxProvider } from "@/lib/providers/docker-sandbox";
import type { ExecutionProviderAdapter, ExecutionProviderManifest, ExecutionSpec, ProviderHealth, ProviderQuote } from "@/lib/v2/execution-providers";

export const relayManagedManifest: ExecutionProviderManifest = {
  schemaVersion: "relay.execution-provider.v1", providerKey: "relay-managed", version: "1.0", kind: "relay_managed",
  features: ["browser.visual", "shell", "files", "pause", "network_policy", "secret_broker"], assurance: "registered",
  regions: ["local"], isolationModes: ["process"], persistenceModes: ["ephemeral"], maximumClassification: "internal",
  evidenceTypes: ["relay_observed"], meteringDimensions: ["COMPUTE_SECONDS", "COMPUTER_SECONDS"], supportsPrivateNetwork: false,
  supportsIdempotentCreate: true, maximumSessionSeconds: 3600,
};

export interface ManagedSessionAuthorizer {
  assertActive(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; capability: string }): Promise<void>;
}

export interface ManagedCredentialBroker {
  bindHandles(input: { accountId: string; taskId: string; audience: string; handles: string[]; expiresAt: string }): Promise<{ bindingId: string }>;
  revokeBinding(input: { accountId: string; bindingId: string }): Promise<void>;
}

type Session = {
  accountId: string; taskId: string; leaseId: string; browser?: BrowserProviderRef; sandbox?: SandboxProviderRef; brokerBindingId?: string;
  createdAtMs: number; expiresAtMs: number; paused: boolean; terminated: boolean; operationCount: number; computeMs: number;
  evidence: Array<Record<string, unknown>>;
};

const browserPolicy: BrowserResourcePolicy = { ttlSeconds: 3600, operationTimeoutMs: 15_000, maxExtractChars: 100_000, network: "PUBLIC_ONLY" };
const sandboxPolicy: SandboxResourcePolicy = { ttlSeconds: 3600, timeoutMs: 30_000, cpuLimit: 1, memoryMb: 512, maxOutputBytes: 256 * 1024, network: "NONE" };

function digest(value: Uint8Array | string) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function safeWorkspacePath(value: string) {
  const normalized = posix.normalize(`/${value}`).slice(1);
  if (!normalized || normalized === "." || value.split("/").includes("..") || value.includes("\0") || posix.isAbsolute(value)) throw new RelayError("INVALID_INPUT", "File path must remain inside the managed workspace.");
  return normalized;
}

export class RelayManagedExecutionAdapter implements ExecutionProviderAdapter {
  readonly providerKey = relayManagedManifest.providerKey;
  readonly version = relayManagedManifest.version;
  private readonly sessions = new Map<string, Session>();
  private readonly tombstones = new Map<string, string>();

  constructor(private readonly authorizer: ManagedSessionAuthorizer, private readonly credentialBroker: ManagedCredentialBroker, private readonly image: { digest: string; sbomReference: string }, private readonly browserProvider: BrowserProvider = new PlaywrightBrowserProvider(), private readonly sandboxProvider: SandboxProvider = new DockerSandboxProvider()) {
    if (!/^sha256:[a-f0-9]{64}$/.test(image.digest) || !image.sbomReference.trim()) throw new RelayError("INVALID_INPUT", "Managed execution requires immutable image provenance and an SBOM reference.");
  }

  async health(): Promise<ProviderHealth> {
    const started = performance.now();
    const [browser, sandbox] = await Promise.all([this.browserProvider.health(), this.sandboxProvider.health()]);
    return { available: browser.ok && sandbox.ok, warmCapacity: 1, latencyMs: Math.round(performance.now() - started), reliabilityBps: browser.ok && sandbox.ok ? 9900 : 0, observedAt: new Date().toISOString() };
  }

  async quote(): Promise<ProviderQuote> { return { amount: "0", currency: "USD", validUntil: new Date(Date.now() + 60_000).toISOString() }; }

  async prepareExecution(input: ExecutionSpec & { idempotencyKey: string }) {
    if (input.persistence !== "ephemeral" || input.isolationMode !== "process" || input.classification !== "public" && input.classification !== "internal") throw new RelayError("CAPABILITY_DENIED", "Relay-managed local execution does not satisfy the requested isolation or classification.", undefined, 403);
    if (input.requiredFeatures.some((feature) => !relayManagedManifest.features.includes(feature))) throw new RelayError("CAPABILITY_DENIED", "Relay-managed local execution does not provide every requested feature.", undefined, 403);
    if (input.credentialHandles.some((handle) => !/^vlt_[A-Za-z0-9_-]{8,}$/.test(handle))) throw new RelayError("INVALID_INPUT", "Only opaque vault handles may cross the managed provider boundary.");
    const existing = [...this.sessions.entries()].find(([, session]) => !session.terminated && session.evidence.some((entry) => entry.idempotencyKey === input.idempotencyKey));
    if (existing) { await this.authorizer.assertActive({ accountId: input.accountId, taskId: input.taskId, leaseId: input.leaseId, providerSessionId: existing[0], capability: "computer.session.create" }); return { providerSessionId: existing[0], receipt: { idempotentReplay: true, imageDigest: this.image.digest } }; }
    const needsBrowser = input.requiredFeatures.includes("browser.visual");
    const needsSandbox = input.requiredFeatures.some((feature) => feature === "shell" || feature === "files");
    let browser: BrowserProviderRef | undefined;
    let sandbox: SandboxProviderRef | undefined;
    let brokerBindingId: string | undefined;
    const providerSessionId = id("mse");
    const expiresAt = new Date(Date.now() + input.maximumSessionSeconds * 1_000).toISOString();
    try {
      await this.authorizer.assertActive({ accountId: input.accountId, taskId: input.taskId, leaseId: input.leaseId, providerSessionId, capability: "computer.session.create" });
      if (needsBrowser) browser = await this.browserProvider.create({ ...browserPolicy, ttlSeconds: input.maximumSessionSeconds });
      if (needsSandbox) sandbox = await this.sandboxProvider.create({ ...sandboxPolicy, ttlSeconds: input.maximumSessionSeconds });
      if (input.credentialHandles.length) brokerBindingId = (await this.credentialBroker.bindHandles({ accountId: input.accountId, taskId: input.taskId, audience: providerSessionId, handles: input.credentialHandles, expiresAt })).bindingId;
      this.sessions.set(providerSessionId, { accountId: input.accountId, taskId: input.taskId, leaseId: input.leaseId, browser, sandbox, brokerBindingId, createdAtMs: Date.now(), expiresAtMs: Date.parse(expiresAt), paused: false, terminated: false, operationCount: 0, computeMs: 0, evidence: [{ type: "session.created", at: new Date().toISOString(), idempotencyKey: input.idempotencyKey, imageDigest: this.image.digest, sbomReference: this.image.sbomReference, browser: needsBrowser, sandbox: needsSandbox }] });
      return { providerSessionId, receipt: { acceptedAt: new Date().toISOString(), imageDigest: this.image.digest, sbomReference: this.image.sbomReference } };
    } catch (error) {
      if (browser) await this.browserProvider.close(browser).catch(() => undefined);
      if (sandbox) await this.sandboxProvider.destroy(sandbox).catch(() => undefined);
      if (brokerBindingId) await this.credentialBroker.revokeBinding({ accountId: input.accountId, bindingId: brokerBindingId }).catch(() => undefined);
      throw error;
    }
  }

  private session(providerSessionId: string, accountId?: string) {
    const session = this.sessions.get(providerSessionId);
    if (!session || session.terminated || (accountId && session.accountId !== accountId)) throw new RelayError("PROVIDER_ERROR", "Managed execution session is unavailable.", undefined, 404);
    if (session.expiresAtMs <= Date.now()) throw new RelayError("CAPABILITY_DENIED", "Managed execution session expired.", undefined, 410);
    return session;
  }

  private async active(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; capability: string }, needs: "browser" | "sandbox") {
    const session = this.session(input.providerSessionId, input.accountId);
    if (session.taskId !== input.taskId || session.leaseId !== input.leaseId) throw new RelayError("CAPABILITY_DENIED", "Managed session authority binding is invalid.", undefined, 403);
    if (session.paused) throw new RelayError("CAPABILITY_DENIED", "Managed session is paused.", undefined, 409);
    if (needs === "browser" && !session.browser || needs === "sandbox" && !session.sandbox) throw new RelayError("INVALID_INPUT", `Managed session does not provide ${needs}.`, undefined, 409);
    await this.authorizer.assertActive(input);
    session.operationCount += 1;
    return session;
  }

  async browserNavigate(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; url: string }) {
    await assertPublicRequest(input.url);
    const session = await this.active({ ...input, capability: "computer.browser.navigate" }, "browser");
    const result = await this.browserProvider.navigate(session.browser!, input.url, browserPolicy);
    session.evidence.push({ type: "browser.navigate", at: new Date().toISOString(), urlHash: digest(result.url) });
    return result;
  }
  async browserClick(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; selector: string }) { if (!input.selector || input.selector.length > 4096) throw new RelayError("INVALID_INPUT", "A bounded selector is required."); const session = await this.active({ ...input, capability: "computer.input.click" }, "browser"); await this.browserProvider.click(session.browser!, input.selector, browserPolicy); session.evidence.push({ type: "browser.click", at: new Date().toISOString(), selectorHash: digest(input.selector) }); }
  async browserType(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; selector: string; text: string }) { if (!input.selector || input.selector.length > 4096 || input.text.length > 100_000) throw new RelayError("INVALID_INPUT", "Browser type input exceeds managed bounds."); const session = await this.active({ ...input, capability: "computer.input.type" }, "browser"); await this.browserProvider.type(session.browser!, input.selector, input.text, browserPolicy); session.evidence.push({ type: "browser.type", at: new Date().toISOString(), selectorHash: digest(input.selector), characterCount: input.text.length }); }
  async browserKey(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; key: string }) { if (!input.key || input.key.length > 64) throw new RelayError("INVALID_INPUT", "A bounded browser key is required."); const session = await this.active({ ...input, capability: "computer.input.key" }, "browser"); if (!this.browserProvider.key) throw new RelayError("PROVIDER_ERROR", "Browser key input is unsupported.", undefined, 501); await this.browserProvider.key(session.browser!, input.key, browserPolicy); }
  async browserScroll(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; deltaX: number; deltaY: number }) { if (![input.deltaX, input.deltaY].every((value) => Number.isFinite(value) && Math.abs(value) <= 100_000)) throw new RelayError("INVALID_INPUT", "Browser scroll delta is invalid."); const session = await this.active({ ...input, capability: "computer.input.scroll" }, "browser"); if (!this.browserProvider.scroll) throw new RelayError("PROVIDER_ERROR", "Browser scroll is unsupported.", undefined, 501); await this.browserProvider.scroll(session.browser!, input.deltaX, input.deltaY, browserPolicy); }
  async browserScreenshot(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string }) { const session = await this.active({ ...input, capability: "computer.screen.capture" }, "browser"); const bytes = await this.browserProvider.screenshot(session.browser!, browserPolicy); const hash = digest(bytes); session.evidence.push({ type: "browser.screenshot", at: new Date().toISOString(), hash, bytes: bytes.byteLength }); return { bytes, hash }; }
  async shellExec(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; command: string }) { if (!input.command.trim() || input.command.length > 10_000) throw new RelayError("INVALID_INPUT", "A bounded shell command is required."); const session = await this.active({ ...input, capability: "computer.shell.exec" }, "sandbox"); const result = await this.sandboxProvider.exec(session.sandbox!, input.command, sandboxPolicy); session.computeMs += result.durationMs; session.evidence.push({ type: "shell.exec", at: new Date().toISOString(), commandHash: digest(input.command), resultHash: digest(`${result.exitCode}:${result.stdout}:${result.stderr}`), exitCode: result.exitCode }); return result; }
  async fileRead(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; path: string }) { const path = safeWorkspacePath(input.path); const session = await this.active({ ...input, capability: "computer.files.read" }, "sandbox"); const bytes = await this.sandboxProvider.readFile(session.sandbox!, path, 1024 * 1024); session.evidence.push({ type: "file.read", at: new Date().toISOString(), pathHash: digest(path), contentHash: digest(bytes), bytes: bytes.byteLength }); return bytes; }
  async fileWrite(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; path: string; bytes: Uint8Array }) { const path = safeWorkspacePath(input.path); if (input.bytes.byteLength > 1024 * 1024) throw new RelayError("INVALID_INPUT", "Managed file write exceeds 1 MiB.", undefined, 413); const session = await this.active({ ...input, capability: "computer.files.write" }, "sandbox"); await this.sandboxProvider.writeFile(session.sandbox!, path, input.bytes); session.evidence.push({ type: "file.write", at: new Date().toISOString(), pathHash: digest(path), contentHash: digest(input.bytes), bytes: input.bytes.byteLength }); }
  async fileList(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; path?: string }) { const path = input.path ? safeWorkspacePath(input.path) : ""; const session = await this.active({ ...input, capability: "computer.files.read" }, "sandbox"); return await this.sandboxProvider.listFiles(session.sandbox!, path); }
  async fileDelete(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; path: string }) { const path = safeWorkspacePath(input.path); const session = await this.active({ ...input, capability: "computer.files.delete" }, "sandbox"); if (!this.sandboxProvider.deleteFile) throw new RelayError("PROVIDER_ERROR", "Managed file deletion is unsupported.", undefined, 501); await this.sandboxProvider.deleteFile(session.sandbox!, path); session.evidence.push({ type: "file.delete", at: new Date().toISOString(), pathHash: digest(path) }); }

  async control(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; command: "pause" | "resume" | "terminate" | "takeover" }) {
    const session = this.session(input.providerSessionId, input.accountId);
    if (input.command === "terminate") return await this.terminate(input);
    if (input.command === "takeover") throw new RelayError("PROVIDER_ERROR", "Live takeover is introduced in WO-15.", undefined, 501);
    if (session.taskId !== input.taskId || session.leaseId !== input.leaseId) throw new RelayError("CAPABILITY_DENIED", "Managed session authority binding is invalid.", undefined, 403);
    await this.authorizer.assertActive({ ...input, capability: `computer.session.${input.command}` });
    session.paused = input.command === "pause";
    session.evidence.push({ type: `session.${input.command}`, at: new Date().toISOString() });
    return { status: session.paused ? "PAUSED" : "RUNNING" };
  }
  async observe(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string }) { const session = await this.active({ ...input, capability: "computer.observe.live" }, "browser"); return { screenshot: await this.browserProvider.screenshot(session.browser!, browserPolicy) }; }
  async collectEvidence(input: { accountId: string; providerSessionId: string }) { return [...this.session(input.providerSessionId, input.accountId).evidence]; }
  async collectMeters(input: { accountId: string; providerSessionId: string }) { const session = this.session(input.providerSessionId, input.accountId); return [{ dimension: "COMPUTER_SECONDS", amount: String(Math.max(0, Math.ceil((Date.now() - session.createdAtMs) / 1000))), sourceId: `${input.providerSessionId}:computer` }, { dimension: "COMPUTE_SECONDS", amount: String(Math.ceil(session.computeMs / 1000)), sourceId: `${input.providerSessionId}:compute` }]; }
  async terminate(input: { accountId: string; providerSessionId: string }) {
    const session = this.sessions.get(input.providerSessionId);
    if (!session) return { status: this.tombstones.get(input.providerSessionId) === input.accountId ? "TERMINATED" : "NOT_FOUND" };
    if (session.accountId !== input.accountId) return { status: "NOT_FOUND" };
    session.terminated = true;
    const results = await Promise.allSettled([...(session.browser ? [this.browserProvider.close(session.browser)] : []), ...(session.sandbox ? [this.sandboxProvider.destroy(session.sandbox)] : []), ...(session.brokerBindingId ? [this.credentialBroker.revokeBinding({ accountId: session.accountId, bindingId: session.brokerBindingId })] : [])]);
    if (results.some((result) => result.status === "rejected")) throw new RelayError("PROVIDER_ERROR", "Managed session termination requires cleanup reconciliation.", undefined, 502);
    this.sessions.delete(input.providerSessionId);
    this.tombstones.set(input.providerSessionId, input.accountId);
    return { status: "TERMINATED" };
  }
  async reconcile(input: { accountId: string; idempotencyKey: string; providerSessionId?: string }) { if (!input.providerSessionId) return { status: "NOT_FOUND" as const }; const session = this.sessions.get(input.providerSessionId); if (session && !session.terminated && session.accountId === input.accountId) return { status: "ACCEPTED" as const }; if (this.tombstones.get(input.providerSessionId) === input.accountId) return { status: "TERMINATED" as const }; return { status: "UNKNOWN" as const }; }
}
