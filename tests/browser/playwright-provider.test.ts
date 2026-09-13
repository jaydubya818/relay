import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const playwright = vi.hoisted(() => {
  const contextClose = vi.fn(async () => undefined);
  const browserClose = vi.fn(async () => undefined);
  const page = {
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
  };
  const context = {
    newPage: vi.fn(async () => page),
    close: contextClose,
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: browserClose,
  };
  return { browser, browserClose, contextClose, launch: vi.fn(async () => browser) };
});

vi.mock("playwright", () => ({ chromium: { launch: playwright.launch } }));

import { PlaywrightBrowserProvider } from "@/lib/providers/playwright-browser";
import type { BrowserResourcePolicy } from "@/lib/providers/browser";

describe("PlaywrightBrowserProvider lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes an expired context and browser in the owning process", async () => {
    const provider = new PlaywrightBrowserProvider();
    const policy: BrowserResourcePolicy = { ttlSeconds: 0.05, operationTimeoutMs: 2_000, maxExtractChars: 10_000, network: "OPEN" };
    const session = await provider.create(policy);

    await vi.advanceTimersByTimeAsync(51);

    expect(playwright.contextClose).toHaveBeenCalledOnce();
    expect(playwright.browserClose).toHaveBeenCalledOnce();
    await expect(provider.extract(session, undefined, policy)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    await expect(provider.close(session)).resolves.toBeUndefined();
  });
});
