import { posix } from "node:path";
import { performance } from "node:perf_hooks";
import { RelayError } from "@/lib/errors";
import type { ExecutionProviderAdapter, ExecutionProviderManifest, ExecutionSpec, ProviderHealth, ProviderQuote } from "@/lib/v2/execution-providers";
import { assertOpaqueHandles, assertProviderEnabled, classifyCreateError, defaultBackoff, retryReadonly, unavailable, type Backoff, type ProviderCredentialSource, type ProviderKillSwitch, type ThirdPartySessionAuthorizer } from "@/lib/v2/providers/third-party";

export const e2bManifest: ExecutionProviderManifest = {
  schemaVersion: "relay.execution-provider.v1", providerKey: "e2b", version: "1.0", kind: "sandbox_service",
  features: ["shell", "files", "pause"], assurance: "registered", regions: ["us", "eu"], isolationModes: ["microvm"], persistenceModes: ["ephemeral"], maximumClassification: "internal",
  evidenceTypes: ["relay_observed"], meteringDimensions: ["COMPUTE_SECONDS"], supportsPrivateNetwork: false, supportsIdempotentCreate: false, maximumSessionSeconds: 86_400,
};

export type E2BSandbox = { id: string; state: "running" | "paused" | "killed"; expiresAt: string };
export interface E2BClient {
  createSandbox(input: { apiKey: string; template: string; timeoutMs: number; region: string; metadata: Record<string, string> }): Promise<E2BSandbox>;
  getSandbox(input: { apiKey: string; sandboxId: string }): Promise<E2BSandbox | undefined>;
  runCommand(input: { apiKey: string; sandboxId: string; command: string; timeoutMs: number }): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>;
  readFile(input: { apiKey: string; sandboxId: string; path: string }): Promise<Uint8Array>;
  writeFile(input: { apiKey: string; sandboxId: string; path: string; bytes: Uint8Array }): Promise<void>;
  listFiles(input: { apiKey: string; sandboxId: string; path: string }): Promise<Array<{ path: string; kind: "FILE" | "DIRECTORY" }>>;
  deleteFile(input: { apiKey: string; sandboxId: string; path: string }): Promise<void>;
  pause(input: { apiKey: string; sandboxId: string }): Promise<void>;
  resume(input: { apiKey: string; sandboxId: string }): Promise<E2BSandbox>;
  kill(input: { apiKey: string; sandboxId: string }): Promise<void>;
}

type BoundSandbox = { accountId: string; taskId: string; leaseId: string; idempotencyKey: string; createdAtMs: number; expiresAtMs: number; computeMs: number; paused: boolean; terminated: boolean; evidence: Array<Record<string, unknown>> };
function safePath(value: string) { const normalized = posix.normalize(`/${value}`).slice(1); if (!normalized || normalized === "." || posix.isAbsolute(value) || value.split("/").includes("..") || value.includes("\0")) throw new RelayError("INVALID_INPUT", "File path must remain inside the sandbox workspace."); return `/home/user/${normalized}`; }

export class E2BExecutionAdapter implements ExecutionProviderAdapter {
  readonly providerKey = e2bManifest.providerKey;
  readonly version = e2bManifest.version;
  private readonly sessions = new Map<string, BoundSandbox>();
  private readonly tombstones = new Map<string, string>();
  private readonly pending = new Map<string, string>();
  constructor(private readonly client: E2BClient, private readonly credentials: ProviderCredentialSource, private readonly killSwitch: ProviderKillSwitch, private readonly authorizer: ThirdPartySessionAuthorizer, private readonly template: string, private readonly backoff: Backoff = defaultBackoff) { if (!template.trim()) throw new RelayError("INVALID_INPUT", "An E2B template is required."); }
  private async key() { return await this.credentials.apiKey(this.providerKey); }
  async health(): Promise<ProviderHealth> { const started = performance.now(); try { await assertProviderEnabled(this.killSwitch, this.providerKey); return { available: true, warmCapacity: 1, latencyMs: Math.round(performance.now() - started), reliabilityBps: 9800, observedAt: new Date().toISOString() }; } catch { return { available: false, warmCapacity: 0, latencyMs: Math.round(performance.now() - started), reliabilityBps: 0, observedAt: new Date().toISOString() }; } }
  async quote(): Promise<ProviderQuote> { return { amount: "0", currency: "USD", validUntil: new Date(Date.now() + 60_000).toISOString() }; }
  async prepareExecution(input: ExecutionSpec & { idempotencyKey: string }) {
    await assertProviderEnabled(this.killSwitch, this.providerKey); assertOpaqueHandles(input.credentialHandles);
    if (input.persistence !== "ephemeral" || input.isolationMode !== "microvm" || !["public", "internal"].includes(input.classification) || input.requiredFeatures.some((feature) => !e2bManifest.features.includes(feature))) throw new RelayError("CAPABILITY_DENIED", "E2B does not satisfy the requested execution profile.", undefined, 403);
    const existing = [...this.sessions.entries()].find(([, session]) => !session.terminated && session.idempotencyKey === input.idempotencyKey);
    if (existing) { await this.authorizer.assertActive({ accountId: input.accountId, taskId: input.taskId, leaseId: input.leaseId, providerSessionId: existing[0], capability: "computer.session.create" }); return { providerSessionId: existing[0], receipt: { idempotentReplay: true } }; }
    const pendingAccount = this.pending.get(input.idempotencyKey);
    if (pendingAccount && pendingAccount !== input.accountId) throw new RelayError("CAPABILITY_DENIED", "Provider idempotency authority is bound to another account.", undefined, 403);
    this.pending.set(input.idempotencyKey, input.accountId);
    try {
      const created = await this.client.createSandbox({ apiKey: await this.key(), template: this.template, timeoutMs: input.maximumSessionSeconds * 1_000, region: input.region, metadata: { relayAccount: input.accountId, relayTask: input.taskId } });
      await this.authorizer.assertActive({ accountId: input.accountId, taskId: input.taskId, leaseId: input.leaseId, providerSessionId: created.id, capability: "computer.session.create" });
      this.sessions.set(created.id, { accountId: input.accountId, taskId: input.taskId, leaseId: input.leaseId, idempotencyKey: input.idempotencyKey, createdAtMs: Date.now(), expiresAtMs: Date.parse(created.expiresAt), computeMs: 0, paused: false, terminated: false, evidence: [{ type: "e2b.sandbox.created", at: new Date().toISOString(), template: this.template }] });
      return { providerSessionId: created.id, receipt: { acceptedAt: new Date().toISOString(), state: created.state, expiresAt: created.expiresAt, template: this.template } };
    } catch (error) { classifyCreateError(error); }
  }
  private bound(providerSessionId: string) { const session = this.sessions.get(providerSessionId); if (!session || session.terminated) throw new RelayError("PROVIDER_ERROR", "E2B sandbox is unavailable.", undefined, 404); return session; }
  private async active(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; capability: string }, allowPaused = false) { await assertProviderEnabled(this.killSwitch, this.providerKey); const session = this.bound(input.providerSessionId); if (session.accountId !== input.accountId) throw new RelayError("PROVIDER_ERROR", "E2B sandbox is unavailable.", undefined, 404); if (session.taskId !== input.taskId || session.leaseId !== input.leaseId) throw new RelayError("CAPABILITY_DENIED", "E2B sandbox authority binding is invalid.", undefined, 403); if (session.expiresAtMs <= Date.now()) throw new RelayError("CAPABILITY_DENIED", "E2B sandbox expired.", undefined, 410); if (session.paused && !allowPaused) throw new RelayError("CAPABILITY_DENIED", "E2B sandbox is paused.", undefined, 409); await this.authorizer.assertActive(input); return session; }
  async shellExec(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; command: string }) { if (!input.command.trim() || input.command.length > 10_000) throw new RelayError("INVALID_INPUT", "A bounded shell command is required."); const session = await this.active({ ...input, capability: "computer.shell.exec" }); const result = await this.client.runCommand({ apiKey: await this.key(), sandboxId: input.providerSessionId, command: input.command, timeoutMs: 30_000 }); session.computeMs += result.durationMs; session.evidence.push({ type: "shell.exec", at: new Date().toISOString(), exitCode: result.exitCode, outputBytes: Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) }); return result; }
  async fileRead(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; path: string }) { await this.active({ ...input, capability: "computer.files.read" }); const bytes = await this.client.readFile({ apiKey: await this.key(), sandboxId: input.providerSessionId, path: safePath(input.path) }); if (bytes.byteLength > 1024 * 1024) throw new RelayError("PROVIDER_ERROR", "E2B file read exceeded 1 MiB.", undefined, 413); return bytes; }
  async fileWrite(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; path: string; bytes: Uint8Array }) { if (input.bytes.byteLength > 1024 * 1024) throw new RelayError("INVALID_INPUT", "E2B file write exceeds 1 MiB.", undefined, 413); await this.active({ ...input, capability: "computer.files.write" }); await this.client.writeFile({ apiKey: await this.key(), sandboxId: input.providerSessionId, path: safePath(input.path), bytes: input.bytes }); }
  async fileList(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; path?: string }) { await this.active({ ...input, capability: "computer.files.read" }); return await this.client.listFiles({ apiKey: await this.key(), sandboxId: input.providerSessionId, path: input.path ? safePath(input.path) : "/home/user" }); }
  async fileDelete(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; path: string }) { await this.active({ ...input, capability: "computer.files.delete" }); await this.client.deleteFile({ apiKey: await this.key(), sandboxId: input.providerSessionId, path: safePath(input.path) }); }
  async pause(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string }) { const session = await this.active({ ...input, capability: "computer.session.pause" }); await this.client.pause({ apiKey: await this.key(), sandboxId: input.providerSessionId }); session.paused = true; return { status: "PAUSED" }; }
  async resume(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string }) { const session = await this.active({ ...input, capability: "computer.session.resume" }, true); const result = await this.client.resume({ apiKey: await this.key(), sandboxId: input.providerSessionId }); session.paused = false; session.expiresAtMs = Date.parse(result.expiresAt); return { status: "RUNNING" }; }
  async control(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; command: "pause" | "resume" | "terminate" | "takeover" }) { if (input.command === "terminate") return await this.terminate(input); if (input.command === "takeover") return unavailable("Human takeover"); return unavailable("Unscoped pause/resume; use the account-bound control contract"); }
  async observe(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string }) { await this.active({ ...input, capability: "computer.observe.live" }); return {}; }
  async collectEvidence(input: { accountId: string; providerSessionId: string }) { const session = this.bound(input.providerSessionId); if (session.accountId !== input.accountId) throw new RelayError("PROVIDER_ERROR", "E2B sandbox is unavailable.", undefined, 404); return [...session.evidence]; }
  async collectMeters(input: { accountId: string; providerSessionId: string }) { const session = this.bound(input.providerSessionId); if (session.accountId !== input.accountId) throw new RelayError("PROVIDER_ERROR", "E2B sandbox is unavailable.", undefined, 404); return [{ dimension: "COMPUTE_SECONDS", amount: String(Math.ceil(session.computeMs / 1_000)), sourceId: `${input.providerSessionId}:compute` }]; }
  async terminate(input: { accountId: string; providerSessionId: string }) { const session = this.sessions.get(input.providerSessionId); if (!session) return { status: this.tombstones.get(input.providerSessionId) === input.accountId ? "TERMINATED" : "NOT_FOUND" }; if (session.accountId !== input.accountId) return { status: "NOT_FOUND" }; await this.client.kill({ apiKey: await this.key(), sandboxId: input.providerSessionId }); session.terminated = true; this.sessions.delete(input.providerSessionId); this.tombstones.set(input.providerSessionId, input.accountId); return { status: "TERMINATED" }; }
  async reconcile(input: { accountId: string; idempotencyKey: string; providerSessionId?: string }) { if (!input.providerSessionId) return { status: "UNKNOWN" as const }; const local = this.sessions.get(input.providerSessionId); if (local?.accountId !== input.accountId && this.pending.get(input.idempotencyKey) !== input.accountId || !local && this.tombstones.has(input.providerSessionId) && this.tombstones.get(input.providerSessionId) !== input.accountId) return { status: "NOT_FOUND" as const }; const apiKey = await this.key(); const result = await retryReadonly(() => this.client.getSandbox({ apiKey, sandboxId: input.providerSessionId! }), this.backoff); if (!result) return { status: "NOT_FOUND" as const }; if (result.state === "killed") return { status: "TERMINATED" as const, receipt: { state: result.state } }; return { status: "ACCEPTED" as const, receipt: { state: result.state, expiresAt: result.expiresAt } }; }
}
