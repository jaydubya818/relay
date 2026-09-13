import { describe, expect, it } from "vitest";
import { PlaywrightBrowserProvider } from "@/lib/providers/playwright-browser";
import type { BrowserResourcePolicy } from "@/lib/providers/browser";

const live = process.env.RELAY_LIVE_PLAYWRIGHT === "1" ? it : it.skip;

describe("PlaywrightBrowserProvider live", () => {
  live("isolates contexts and supports the provider contract", async () => {
    const provider = new PlaywrightBrowserProvider();
    const policy: BrowserResourcePolicy = { ttlSeconds: 60, operationTimeoutMs: 10_000, maxExtractChars: 10_000, network: "OPEN" };
    expect(await provider.health()).toEqual({ ok: true });
    const first = await provider.create(policy);
    const second = await provider.create(policy);
    try {
      const document = encodeURIComponent('<title>Relay</title><input id="value"><button onclick="document.querySelector(\'main\').textContent=document.querySelector(\'#value\').value">Save</button><main>empty</main>');
      await provider.navigate(first, `data:text/html,${document}`, policy);
      await provider.navigate(second, `data:text/html,${document}`, policy);
      await provider.type(first, "#value", "first context", policy);
      await provider.click(first, "button", policy);
      expect((await provider.extract(first, "main", policy)).text).toBe("first context");
      expect((await provider.extract(second, "main", policy)).text).toBe("empty");
      expect((await provider.screenshot(first)).byteLength).toBeGreaterThan(100);
    } finally {
      await provider.close(first);
      await provider.close(second);
    }
  }, 120_000);

  live("blocks private network destinations under the default policy", async () => {
    const provider = new PlaywrightBrowserProvider();
    const policy: BrowserResourcePolicy = { ttlSeconds: 60, operationTimeoutMs: 2_000, maxExtractChars: 10_000, network: "PUBLIC_ONLY" };
    const session = await provider.create(policy);
    try {
      await expect(provider.navigate(session, "http://127.0.0.1:3000", policy)).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    } finally {
      await provider.close(session);
    }
  }, 120_000);
});
