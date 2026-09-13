export type BrowserResourcePolicy = { ttlSeconds: number; operationTimeoutMs: number; maxExtractChars: number; network: "PUBLIC_ONLY" | "OPEN" };
export type BrowserProviderRef = { resourceId: string };
export type BrowserProviderHealth = { ok: boolean; message?: string };

export interface BrowserProvider {
  readonly id: string;
  create(policy: BrowserResourcePolicy): Promise<BrowserProviderRef>;
  navigate(resource: BrowserProviderRef, url: string, policy: BrowserResourcePolicy): Promise<{ url: string; title: string }>;
  click(resource: BrowserProviderRef, selector: string, policy: BrowserResourcePolicy): Promise<void>;
  type(resource: BrowserProviderRef, selector: string, text: string, policy: BrowserResourcePolicy): Promise<void>;
  extract(resource: BrowserProviderRef, selector: string | undefined, policy: BrowserResourcePolicy): Promise<{ url: string; text: string; truncated: boolean }>;
  screenshot(resource: BrowserProviderRef, policy: BrowserResourcePolicy): Promise<Uint8Array>;
  close(resource: BrowserProviderRef): Promise<void>;
  health(): Promise<BrowserProviderHealth>;
}
