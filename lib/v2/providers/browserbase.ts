import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { RelayError } from "@/lib/errors";
import { assertPublicRequest } from "@/lib/providers/playwright-browser";
import type { ExecutionProviderAdapter, ExecutionProviderManifest, ExecutionSpec, ProviderHealth, ProviderQuote } from "@/lib/v2/execution-providers";
import { assertOpaqueHandles, assertProviderEnabled, classifyCreateError, defaultBackoff, retryReadonly, unavailable, type Backoff, type ProviderCredentialSource, type ProviderKillSwitch, type ThirdPartySessionAuthorizer } from "@/lib/v2/providers/third-party";

export const browserbaseManifest: ExecutionProviderManifest = {
  schemaVersion: "relay.execution-provider.v1", providerKey: "browserbase", version: "1.0", kind: "browser_service",
  features: ["browser.visual", "live_observation"], assurance: "registered",
  regions: ["us-west-2", "us-east-1", "eu-central-1", "ap-southeast-1"], isolationModes: ["process"], persistenceModes: ["ephemeral"], maximumClassification: "internal",
  evidenceTypes: ["relay_observed"], meteringDimensions: ["COMPUTER_SECONDS"], supportsPrivateNetwork: false, supportsIdempotentCreate: false, maximumSessionSeconds: 21_600,
};

export type BrowserbaseSession = { id: string; status: "PENDING" | "RUNNING" | "ERROR" | "TIMED_OUT" | "COMPLETED"; expiresAt: string; connectUrl?: string };
export interface BrowserbaseClient {
  createSession(input: { apiKey: string; projectId?: string; region: string; timeoutSeconds: number; metadata: Record<string, string>; recordSession: boolean }): Promise<BrowserbaseSession>;
  getSession(input: { apiKey: string; sessionId: string }): Promise<BrowserbaseSession | undefined>;
  endSession(input: { apiKey: string; sessionId: string }): Promise<void>;
  liveUrls(input: { apiKey: string; sessionId: string }): Promise<{ debuggerFullscreenUrl: string; pages: Array<{ id: string; url: string }> }>;
  replayPages(input: { apiKey: string; sessionId: string }): Promise<Array<{ pageId: string; startTimeMs: number; endTimeMs: number }>>;
  navigate(input: { apiKey: string; sessionId: string; url: string }): Promise<{ url: string; title: string }>;
  click(input: { apiKey: string; sessionId: string; selector: string }): Promise<void>;
  type(input: { apiKey: string; sessionId: string; selector: string; text: string }): Promise<void>;
  key(input: { apiKey: string; sessionId: string; key: string }): Promise<void>;
  scroll(input: { apiKey: string; sessionId: string; deltaX: number; deltaY: number }): Promise<void>;
  screenshot(input: { apiKey: string; sessionId: string }): Promise<Uint8Array>;
}

type BoundSession = { accountId: string; taskId: string; leaseId: string; idempotencyKey: string; createdAtMs: number; expiresAtMs: number; terminated: boolean; evidence: Array<Record<string, unknown>> };
function digest(value: Uint8Array | string) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

export class BrowserbaseExecutionAdapter implements ExecutionProviderAdapter {
  readonly providerKey = browserbaseManifest.providerKey;
  readonly version = browserbaseManifest.version;
  private readonly sessions = new Map<string, BoundSession>();
  private readonly tombstones = new Map<string, string>();
  private readonly pending = new Map<string, string>();

  constructor(private readonly client: BrowserbaseClient, private readonly credentials: ProviderCredentialSource, private readonly killSwitch: ProviderKillSwitch, private readonly authorizer: ThirdPartySessionAuthorizer, private readonly projectId?: string, private readonly backoff: Backoff = defaultBackoff) {}

  private async key() { return await this.credentials.apiKey(this.providerKey); }
  async health(): Promise<ProviderHealth> { const started = performance.now(); try { await assertProviderEnabled(this.killSwitch, this.providerKey); return { available: true, warmCapacity: 1, latencyMs: Math.round(performance.now() - started), reliabilityBps: 9800, observedAt: new Date().toISOString() }; } catch { return { available: false, warmCapacity: 0, latencyMs: Math.round(performance.now() - started), reliabilityBps: 0, observedAt: new Date().toISOString() }; } }
  async quote(): Promise<ProviderQuote> { return { amount: "0", currency: "USD", validUntil: new Date(Date.now() + 60_000).toISOString() }; }

  async prepareExecution(input: ExecutionSpec & { idempotencyKey: string }) {
    await assertProviderEnabled(this.killSwitch, this.providerKey);
    assertOpaqueHandles(input.credentialHandles);
    if (input.persistence !== "ephemeral" || input.isolationMode !== "process" || !["public", "internal"].includes(input.classification) || input.requiredFeatures.some((feature) => !browserbaseManifest.features.includes(feature))) throw new RelayError("CAPABILITY_DENIED", "Browserbase does not satisfy the requested execution profile.", undefined, 403);
    const existing = [...this.sessions.entries()].find(([, session]) => !session.terminated && session.idempotencyKey === input.idempotencyKey);
    if (existing) { await this.authorizer.assertActive({ accountId: input.accountId, taskId: input.taskId, leaseId: input.leaseId, providerSessionId: existing[0], capability: "computer.session.create" }); return { providerSessionId: existing[0], receipt: { idempotentReplay: true } }; }
    const pendingAccount = this.pending.get(input.idempotencyKey);
    if (pendingAccount && pendingAccount !== input.accountId) throw new RelayError("CAPABILITY_DENIED", "Provider idempotency authority is bound to another account.", undefined, 403);
    this.pending.set(input.idempotencyKey, input.accountId);
    try {
      const created = await this.client.createSession({ apiKey: await this.key(), projectId: this.projectId, region: input.region, timeoutSeconds: input.maximumSessionSeconds, metadata: { relayAccount: input.accountId, relayTask: input.taskId }, recordSession: true });
      await this.authorizer.assertActive({ accountId: input.accountId, taskId: input.taskId, leaseId: input.leaseId, providerSessionId: created.id, capability: "computer.session.create" });
      this.sessions.set(created.id, { accountId: input.accountId, taskId: input.taskId, leaseId: input.leaseId, idempotencyKey: input.idempotencyKey, createdAtMs: Date.now(), expiresAtMs: Date.parse(created.expiresAt), terminated: false, evidence: [{ type: "browserbase.session.created", at: new Date().toISOString(), recording: true }] });
      return { providerSessionId: created.id, receipt: { acceptedAt: new Date().toISOString(), status: created.status, expiresAt: created.expiresAt, recording: true } };
    } catch (error) { classifyCreateError(error); }
  }

  private bound(providerSessionId: string) { const session = this.sessions.get(providerSessionId); if (!session || session.terminated) throw new RelayError("PROVIDER_ERROR", "Browserbase session is unavailable.", undefined, 404); return session; }
  private async active(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; capability: string }) { await assertProviderEnabled(this.killSwitch, this.providerKey); const session = this.bound(input.providerSessionId); if (session.accountId !== input.accountId) throw new RelayError("PROVIDER_ERROR", "Browserbase session is unavailable.", undefined, 404); if (session.taskId !== input.taskId || session.leaseId !== input.leaseId) throw new RelayError("CAPABILITY_DENIED", "Browserbase session authority binding is invalid.", undefined, 403); if (session.expiresAtMs <= Date.now()) throw new RelayError("CAPABILITY_DENIED", "Browserbase session expired.", undefined, 410); await this.authorizer.assertActive(input); return session; }

  async getLiveView(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string }) { await this.active({ ...input, capability: "computer.observe.live" }); return await this.withKey((apiKey) => retryReadonly(() => this.client.liveUrls({ apiKey, sessionId: input.providerSessionId }), this.backoff)); }
  private async withKey<T>(operation: (apiKey: string) => Promise<T>) { return await operation(await this.key()); }
  async replayPages(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string }) { await this.active({ ...input, capability: "computer.observe.replay" }); return await this.withKey((apiKey) => retryReadonly(() => this.client.replayPages({ apiKey, sessionId: input.providerSessionId }), this.backoff)); }
  async browserNavigate(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; url: string }) { await assertPublicRequest(input.url); const session = await this.active({ ...input, capability: "computer.browser.navigate" }); const result = await this.withKey((apiKey) => this.client.navigate({ apiKey, sessionId: input.providerSessionId, url: input.url })); session.evidence.push({ type: "browser.navigate", at: new Date().toISOString(), urlHash: digest(result.url) }); return result; }
  async browserClick(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; selector: string }) { if (!input.selector || input.selector.length > 4096) throw new RelayError("INVALID_INPUT", "A bounded selector is required."); const session = await this.active({ ...input, capability: "computer.input.click" }); await this.withKey((apiKey) => this.client.click({ apiKey, sessionId: input.providerSessionId, selector: input.selector })); session.evidence.push({ type: "browser.click", at: new Date().toISOString(), selectorHash: digest(input.selector) }); }
  async browserType(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; selector: string; text: string }) { if (!input.selector || input.selector.length > 4096 || input.text.length > 100_000) throw new RelayError("INVALID_INPUT", "Browser type input exceeds provider bounds."); const session = await this.active({ ...input, capability: "computer.input.type" }); await this.withKey((apiKey) => this.client.type({ apiKey, sessionId: input.providerSessionId, selector: input.selector, text: input.text })); session.evidence.push({ type: "browser.type", at: new Date().toISOString(), selectorHash: digest(input.selector), characterCount: input.text.length }); }
  async browserKey(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; key: string }) { if (!input.key || input.key.length > 64) throw new RelayError("INVALID_INPUT", "A bounded key is required."); await this.active({ ...input, capability: "computer.input.key" }); await this.withKey((apiKey) => this.client.key({ apiKey, sessionId: input.providerSessionId, key: input.key })); }
  async browserScroll(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; deltaX: number; deltaY: number }) { if (![input.deltaX, input.deltaY].every((value) => Number.isFinite(value) && Math.abs(value) <= 100_000)) throw new RelayError("INVALID_INPUT", "Browser scroll delta is invalid."); await this.active({ ...input, capability: "computer.input.scroll" }); await this.withKey((apiKey) => this.client.scroll({ apiKey, sessionId: input.providerSessionId, deltaX: input.deltaX, deltaY: input.deltaY })); }
  async browserScreenshot(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string }) { const session = await this.active({ ...input, capability: "computer.screen.capture" }); const bytes = await this.withKey((apiKey) => this.client.screenshot({ apiKey, sessionId: input.providerSessionId })); const hash = digest(bytes); session.evidence.push({ type: "browser.screenshot", at: new Date().toISOString(), hash, bytes: bytes.byteLength }); return { bytes, hash }; }

  async control(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; command: "pause" | "resume" | "terminate" | "takeover" }) { if (input.command === "terminate") return await this.terminate(input); return unavailable(input.command === "takeover" ? "Human takeover" : "Session pause/resume"); }
  async observe(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string }) { await this.active({ ...input, capability: "computer.observe.live" }); return await this.withKey(async (apiKey) => { const live = await retryReadonly(() => this.client.liveUrls({ apiKey, sessionId: input.providerSessionId }), this.backoff); return { liveUrl: live.debuggerFullscreenUrl }; }); }
  async collectEvidence(input: { accountId: string; providerSessionId: string }) { const session = this.bound(input.providerSessionId); if (session.accountId !== input.accountId) throw new RelayError("PROVIDER_ERROR", "Browserbase session is unavailable.", undefined, 404); const pages = await this.withKey((apiKey) => retryReadonly(() => this.client.replayPages({ apiKey, sessionId: input.providerSessionId }), this.backoff)); return [...session.evidence, { type: "browserbase.session", providerSessionId: input.providerSessionId, recordingPages: pages.length, expiresAt: new Date(session.expiresAtMs).toISOString() }]; }
  async collectMeters(input: { accountId: string; providerSessionId: string }) { const session = this.bound(input.providerSessionId); if (session.accountId !== input.accountId) throw new RelayError("PROVIDER_ERROR", "Browserbase session is unavailable.", undefined, 404); return [{ dimension: "COMPUTER_SECONDS", amount: String(Math.max(0, Math.ceil((Date.now() - session.createdAtMs) / 1_000))), sourceId: `${input.providerSessionId}:computer` }]; }
  async terminate(input: { accountId: string; providerSessionId: string }) { const session = this.sessions.get(input.providerSessionId); if (!session) return { status: this.tombstones.get(input.providerSessionId) === input.accountId ? "TERMINATED" : "NOT_FOUND" }; if (session.accountId !== input.accountId) return { status: "NOT_FOUND" }; await this.withKey((apiKey) => this.client.endSession({ apiKey, sessionId: input.providerSessionId })); session.terminated = true; this.sessions.delete(input.providerSessionId); this.tombstones.set(input.providerSessionId, input.accountId); return { status: "TERMINATED" }; }
  async reconcile(input: { accountId: string; idempotencyKey: string; providerSessionId?: string }) { if (!input.providerSessionId) return { status: "UNKNOWN" as const }; const local = this.sessions.get(input.providerSessionId); if (local?.accountId !== input.accountId && this.pending.get(input.idempotencyKey) !== input.accountId || !local && this.tombstones.has(input.providerSessionId) && this.tombstones.get(input.providerSessionId) !== input.accountId) return { status: "NOT_FOUND" as const }; const result = await this.withKey((apiKey) => retryReadonly(() => this.client.getSession({ apiKey, sessionId: input.providerSessionId! }), this.backoff)); if (!result) return { status: "NOT_FOUND" as const }; if (["COMPLETED", "TIMED_OUT", "ERROR"].includes(result.status)) return { status: "TERMINATED" as const, receipt: { status: result.status } }; return { status: "ACCEPTED" as const, receipt: { status: result.status, expiresAt: result.expiresAt } }; }
}
