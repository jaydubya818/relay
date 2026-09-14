import { RelayError } from "@/lib/errors";
import { ProviderDispatchError } from "@/lib/v2/execution-providers";

export type ProviderApiErrorKind = "HTTP" | "TIMEOUT" | "NETWORK";

export class ProviderApiError extends Error {
  constructor(message: string, public readonly kind: ProviderApiErrorKind, public readonly status?: number, public readonly retryAfterMs?: number) {
    super(message);
    this.name = "ProviderApiError";
  }
}

export interface ProviderCredentialSource {
  apiKey(providerKey: string): Promise<string>;
}

export interface ProviderKillSwitch {
  enabled(providerKey: string): Promise<boolean>;
}

export interface ThirdPartySessionAuthorizer {
  assertActive(input: { accountId: string; taskId: string; leaseId: string; providerSessionId: string; capability: string }): Promise<void>;
}

export type Backoff = { sleep(ms: number): Promise<void> };

export const defaultBackoff: Backoff = { sleep: async (ms) => await new Promise((resolve) => setTimeout(resolve, ms)) };

export async function assertProviderEnabled(killSwitch: ProviderKillSwitch, providerKey: string) {
  if (!await killSwitch.enabled(providerKey)) throw new ProviderDispatchError("Execution provider is disabled by an operator.", "PRE_EFFECT", "ProviderDisabled");
}

export function classifyCreateError(error: unknown): never {
  if (error instanceof ProviderApiError && error.kind === "HTTP" && error.status === 429) {
    throw new ProviderDispatchError("Provider rejected session creation because its rate limit was exceeded.", "PRE_EFFECT", "ProviderRateLimited");
  }
  if (error instanceof ProviderApiError && error.kind === "HTTP" && error.status !== undefined && error.status >= 400 && error.status < 500) {
    throw new ProviderDispatchError("Provider rejected session creation.", "PRE_EFFECT", "ProviderRequestRejected");
  }
  throw new ProviderDispatchError("Provider session creation may have committed; reconciliation is required.", "POSSIBLY_COMMITTED", error instanceof ProviderApiError ? `Provider${error.kind}` : "ProviderUnknownError");
}

export async function retryReadonly<T>(operation: () => Promise<T>, backoff: Backoff, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(); } catch (error) {
      lastError = error;
      const retryable = error instanceof ProviderApiError && (error.kind !== "HTTP" || error.status === 429 || (error.status !== undefined && error.status >= 500));
      if (!retryable || attempt === attempts - 1) throw error;
      const requested = error.retryAfterMs ?? 100 * 2 ** attempt;
      await backoff.sleep(Math.min(Math.max(requested, 0), 5_000));
    }
  }
  throw lastError;
}

export function assertOpaqueHandles(handles: string[]) {
  if (handles.some((handle) => !/^vlt_[A-Za-z0-9_-]{8,}$/.test(handle))) throw new RelayError("INVALID_INPUT", "Only opaque vault handles may cross the provider boundary.");
  if (handles.length) throw new RelayError("CAPABILITY_DENIED", "This provider has no qualified secret-broker injection path; credential handles are not dispatched.", undefined, 403);
}

export function unavailable(feature: string): never {
  throw new RelayError("PROVIDER_ERROR", `${feature} is not supported by this execution provider.`, undefined, 501);
}
