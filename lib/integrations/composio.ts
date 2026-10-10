import { Composio, type Tool } from "@composio/core";
import { z } from "zod";
import { canonicalHash } from "@/lib/v2/contracts";
import { redactForEvidence } from "@/lib/v2/evidence/redaction";
import { assertBinding, assertBindingIdentity, IntegrationError, providerUserId, toolkitSchema, type IntegrationAction, type IntegrationBinding, type IntegrationProviderAdapter, type IntegrationResult, type IntegrationScope, type Toolkit } from "./contracts";

export const COMPOSIO_SDK_VERSION = "0.22.0";
type SDK = {
  authConfigs: Pick<Composio["authConfigs"], "get">;
  tools: Pick<Composio["tools"], "getRawComposioToolBySlug" | "execute">;
  toolkits: Pick<Composio["toolkits"], "getMany">;
  connectedAccounts: Pick<Composio["connectedAccounts"], "list" | "link" | "delete">;
};
export type ComposioSDK = SDK;

/** Server-reviewed qualification material, never derived from provider descriptions or model output. */
export type QualifiedReadTool = {
  toolkit: Toolkit; slug: string; version: string; schemaHash: string; description: string;
  requiredScopes: string[];
  parseArguments(value: unknown): Record<string, unknown>;
  projectResult(value: Record<string, unknown>): unknown;
};

export function createComposioSDK(apiKey: string) {
  if (!apiKey.trim()) throw new IntegrationError("PROVIDER_NOT_CONFIGURED");
  const sdk = new Composio({ apiKey, userApiKey: null, orgApiKey: null, baseURL: "https://backend.composio.dev",
    allowTracking: false, disableVersionCheck: true, logLevel: "silent",
    dangerouslyAllowAutoUploadDownloadFiles: false, fileUploadDirs: false,
  });
  // Public client transport setting: applies to lifecycle calls as well as reads.
  // tools.execute additionally disables retries itself in SDK 0.22.0.
  sdk.getClient().maxRetries = 0;
  return sdk;
}

/** The live runtime is intentionally not wired to this checkpoint's adapter. */
export function requireLiveComposioAdmission(): never {
  throw new IntegrationError("CUSTODY_AND_CROSS_DATABASE_ADMISSION_UNQUALIFIED");
}

export function toolSchemaHash(tool: Pick<Tool, "slug" | "toolkit" | "version" | "inputParameters" | "outputParameters">) {
  return canonicalHash({ slug: tool.slug, toolkit: tool.toolkit?.slug ?? null, version: tool.version ?? null,
    input: tool.inputParameters ?? null, output: tool.outputParameters ?? null });
}

function normalizeError(error: unknown, dispatched: boolean): IntegrationError {
  if (error instanceof IntegrationError) return error;
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const record = current as { status?: number; name?: string; cause?: unknown; headers?: Headers };
    if (record.status === 429) {
      const seconds = Number(record.headers?.get?.("retry-after"));
      return new IntegrationError("RATE_LIMITED", dispatched ? "UNKNOWN" : "NOT_DISPATCHED", Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 60_000) : 1000);
    }
    if (record.status === 401 || record.status === 403) return new IntegrationError("PROVIDER_AUTH_REQUIRED", dispatched ? "UNKNOWN" : "NOT_DISPATCHED");
    if (record.name && /abort|timeout|cancel/i.test(record.name)) return new IntegrationError("TIMEOUT", dispatched ? "UNKNOWN" : "NOT_DISPATCHED");
    current = record.cause;
  }
  return new IntegrationError("PROVIDER_UNAVAILABLE", dispatched ? "UNKNOWN" : "NOT_DISPATCHED");
}

export class ComposioProviderAdapter implements IntegrationProviderAdapter {
  readonly provider = "composio";
  readonly version = "1.0";
  private readonly tools: ReadonlyMap<string, QualifiedReadTool>;
  constructor(private readonly sdk: SDK, qualifications: readonly QualifiedReadTool[], private readonly callbackOrigin: string, private readonly timeoutMs = 10_000) {
    const origin = new URL(callbackOrigin);
    if (origin.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(origin.hostname)) throw new IntegrationError("INVALID_CALLBACK_ORIGIN");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new IntegrationError("INVALID_TIMEOUT");
    this.tools = new Map(qualifications.map(tool => {
      toolkitSchema.parse(tool.toolkit);
      if (!/^[A-Z][A-Z0-9_]+$/.test(tool.slug) || !/^\d{8}_\d+$/.test(tool.version) || !/^sha256:[a-f0-9]{64}$/.test(tool.schemaHash)) throw new IntegrationError("INVALID_QUALIFICATION");
      return [tool.slug, Object.freeze({ ...tool, requiredScopes: [...tool.requiredScopes] })];
    }));
    if (this.tools.size !== qualifications.length) throw new IntegrationError("DUPLICATE_QUALIFICATION");
  }

  private async call<T>(operation: (signal: AbortSignal) => Promise<T>, dispatched = false): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation(controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new IntegrationError("TIMEOUT", dispatched ? "UNKNOWN" : "NOT_DISPATCHED")); }, this.timeoutMs);
      })]);
    } catch (error) { throw normalizeError(error, dispatched); }
    finally { if (timer) clearTimeout(timer); }
  }

  async discoverIntegrations() {
    const rows = await this.call(signal => this.sdk.toolkits.getMany([...toolkitSchema.options], { limit: 4 }, { signal }));
    return rows.filter(row => toolkitSchema.safeParse(row.slug).success).slice(0, 4)
      .map(row => ({ slug: toolkitSchema.parse(row.slug), name: row.name, authSchemes: row.authSchemes ?? [] }));
  }

  private qualified(slug: string) {
    const tool = this.tools.get(slug);
    if (!tool) throw new IntegrationError("TOOL_NOT_QUALIFIED");
    return tool;
  }

  async getAction(slug: string): Promise<IntegrationAction> {
    const qualified = this.qualified(slug);
    const tool = await this.call(signal => this.sdk.tools.getRawComposioToolBySlug(slug, { version: qualified.version }, { signal }));
    if (tool.slug !== slug || tool.toolkit?.slug !== qualified.toolkit || tool.version !== qualified.version || tool.isDeprecated || toolSchemaHash(tool) !== qualified.schemaHash) throw new IntegrationError("TOOL_SCHEMA_DRIFT");
    return { toolkit: qualified.toolkit, slug, version: qualified.version, schemaHash: qualified.schemaHash,
      effect: "READ", description: qualified.description, inputSchema: tool.inputParameters ?? {} };
  }

  async listActions(toolkit: Toolkit, query: string, limit = 5) {
    toolkitSchema.parse(toolkit);
    const bound = z.number().int().min(1).max(10).parse(limit);
    const terms = z.string().max(200).parse(query).toLowerCase().split(/\s+/).filter(Boolean);
    const candidates = [...this.tools.values()].filter(tool => tool.toolkit === toolkit && (!terms.length || terms.some(term => `${tool.slug} ${tool.description}`.toLowerCase().includes(term)))).slice(0, bound);
    return Promise.all(candidates.map(tool => this.getAction(tool.slug)));
  }

  async connectionStatus(scope: IntegrationScope, input: IntegrationBinding) {
    const binding = assertBindingIdentity(scope, input);
    // get(id) omits the owning user. Always resolve within the exact user AND auth config.
    const result = await this.call(signal => this.sdk.connectedAccounts.list({ userIds: [binding.providerUserId],
      authConfigIds: [binding.authConfigId], toolkitSlugs: [binding.toolkit], accountType: "PRIVATE", limit: 100 }, { signal }));
    const account = result.items.find(row => row.id === binding.connectedAccountId && row.authConfig.id === binding.authConfigId && row.toolkit.slug === binding.toolkit);
    if (!account || account.experimental?.accountType === "SHARED") throw new IntegrationError("CONNECTION_UNAVAILABLE");
    // Never return state, data, params, statusReason, or provider credential material.
    return { connectedAccountId: account.id, status: account.status, disabled: account.isDisabled || account.authConfig.isDisabled };
  }

  async initiateConnection(scope: IntegrationScope, toolkit: Toolkit, authConfigId: string, callbackUrl: string) {
    toolkitSchema.parse(toolkit);
    const url = new URL(callbackUrl);
    if (url.origin !== new URL(this.callbackOrigin).origin || url.username || url.password) throw new IntegrationError("INVALID_CALLBACK_ORIGIN");
    const config = await this.call(signal => this.sdk.authConfigs.get(authConfigId, { signal }));
    if (config.id !== authConfigId || config.toolkit.slug !== toolkit || config.status !== "ENABLED") throw new IntegrationError("AUTH_CONFIG_MISMATCH");
    // Caller must persist one-time Relay state and the owner's consent before invoking this port.
    const request = await this.call(signal => this.sdk.connectedAccounts.link(providerUserId(scope), authConfigId, { callbackUrl: url.toString(), allowMultiple: false }, { signal }), true);
    if (!request.redirectUrl || new URL(request.redirectUrl).protocol !== "https:") throw new IntegrationError("INVALID_AUTH_REDIRECT", "UNKNOWN");
    return { requestId: request.id, redirectUrl: request.redirectUrl };
  }

  async executeRead(scope: IntegrationScope, input: IntegrationBinding, slug: string, args: Record<string, unknown>): Promise<IntegrationResult> {
    const started = performance.now();
    const binding = assertBinding(scope, input);
    const qualified = this.qualified(slug);
    if (qualified.toolkit !== binding.toolkit || qualified.requiredScopes.some(value => !binding.scopes.includes(value))) throw new IntegrationError("CONNECTION_SCOPE_MISMATCH");
    const parameters = qualified.parseArguments(args);
    // The only accepted payload is the exact qualified request, with no silently stripped fields.
    if (canonicalHash(parameters) !== canonicalHash(args)) throw new IntegrationError("INVALID_ARGUMENTS");
    await this.getAction(slug);
    const status = await this.connectionStatus(scope, binding);
    if (status.status !== "ACTIVE" || status.disabled) throw new IntegrationError("CONNECTION_UNAVAILABLE");
    const evidence = { provider: "composio" as const, adapterVersion: this.version, scopeDigest: canonicalHash(scope), connectionId: binding.connectionId, authorityVersion: binding.authorityVersion, tool: slug, version: qualified.version,
      schemaHash: qualified.schemaHash, argumentDigest: canonicalHash(parameters), durationMs: 0 };
    try {
      const result = await this.call(signal => this.sdk.tools.execute(slug, { userId: binding.providerUserId,
        connectedAccountId: binding.connectedAccountId, version: qualified.version, arguments: parameters, allowTracing: false }, { signal,
        // SDK retrieves the pinned schema again; check the final request identity too.
        beforeExecute: ({ toolSlug, toolkitSlug, params }) => {
          if (toolSlug !== slug || toolkitSlug !== qualified.toolkit || params.userId !== binding.providerUserId || params.version !== qualified.version || params.connectedAccountId !== binding.connectedAccountId || params.customAuthParams || params.customConnectionData || params.dangerouslySkipVersionCheck || params.allowTracing !== false || canonicalHash(params.arguments) !== evidence.argumentDigest) throw new IntegrationError("DISPATCH_BINDING_MISMATCH");
          return params;
        },
      }), true);
      if (!result.successful) return { state: "UNKNOWN", trust: "UNTRUSTED_EXTERNAL_DATA", evidence: { ...evidence, errorCode: "PROVIDER_REPORTED_FAILURE", durationMs: performance.now() - started } };
      const data = redactForEvidence(qualified.projectResult(result.data));
      if (Buffer.byteLength(JSON.stringify(data)) > 64 * 1024) throw new IntegrationError("RESULT_TOO_LARGE", "UNKNOWN");
      return { state: "SUCCEEDED", trust: "UNTRUSTED_EXTERNAL_DATA", data, evidence: { ...evidence, resultDigest: canonicalHash(data), durationMs: performance.now() - started } };
    } catch (error) {
      const failure = normalizeError(error, true);
      return { state: "UNKNOWN", trust: "UNTRUSTED_EXTERNAL_DATA", evidence: { ...evidence, errorCode: failure.code, durationMs: performance.now() - started } };
    }
  }

  async revoke(scope: IntegrationScope, binding: IntegrationBinding) {
    // Relay must fence its canonical connection before requesting remote deletion.
    await this.connectionStatus(scope, binding);
    try {
      const result = await this.call(signal => this.sdk.connectedAccounts.delete(binding.connectedAccountId, { signal }), true);
      return { providerRevocation: result.success && !result.revoke_job_id ? "CONFIRMED" as const : "PENDING" as const };
    }
    catch { return { providerRevocation: "PENDING" as const }; }
  }
}
