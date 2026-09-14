import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { RelayError } from "@/lib/errors";
import type { BrowserProvider, BrowserProviderRef, BrowserResourcePolicy } from "@/lib/providers/browser";

type Session = { context: BrowserContext; page: Page };

function privateIp(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

export async function assertPublicRequest(value: string) {
  const url = new URL(value);
  if (["data:", "blob:", "about:"].includes(url.protocol)) return;
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new RelayError("INVALID_INPUT", "Browser navigation supports HTTP and HTTPS only.", "browser.navigate");
  if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || privateIp(url.hostname)) throw new RelayError("CAPABILITY_DENIED", "Browser network policy blocked a private address.", "browser.navigate", 403);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => privateIp(entry.address))) throw new RelayError("CAPABILITY_DENIED", "Browser network policy blocked a private address.", "browser.navigate", 403);
}

export class PlaywrightBrowserProvider implements BrowserProvider {
  readonly id = "playwright";
  private browser?: Browser;
  private readonly sessions = new Map<string, Session>();

  private async runtime() {
    this.browser ??= await chromium.launch({ headless: true });
    return this.browser;
  }

  private session(resource: BrowserProviderRef) {
    const session = this.sessions.get(resource.resourceId);
    if (!session) throw new RelayError("PROVIDER_ERROR", "Browser provider session is unavailable.", undefined, 502);
    return session;
  }

  async create(policy: BrowserResourcePolicy) {
    const context = await (await this.runtime()).newContext({ acceptDownloads: false, serviceWorkers: "block" });
    if (policy.network === "PUBLIC_ONLY") {
      await context.route("**/*", async (route) => {
        try { await assertPublicRequest(route.request().url()); await route.continue(); }
        catch { await route.abort("blockedbyclient"); }
      });
    }
    const page = await context.newPage();
    page.setDefaultTimeout(policy.operationTimeoutMs);
    page.setDefaultNavigationTimeout(policy.operationTimeoutMs);
    const resourceId = randomUUID();
    this.sessions.set(resourceId, { context, page });
    return { resourceId };
  }

  async navigate(resource: BrowserProviderRef, url: string, policy: BrowserResourcePolicy) {
    if (policy.network === "PUBLIC_ONLY") await assertPublicRequest(url);
    const { page } = this.session(resource);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: policy.operationTimeoutMs });
    return { url: page.url(), title: await page.title() };
  }

  async click(resource: BrowserProviderRef, selector: string, policy: BrowserResourcePolicy) {
    await this.session(resource).page.locator(selector).click({ timeout: policy.operationTimeoutMs });
  }

  async type(resource: BrowserProviderRef, selector: string, text: string, policy: BrowserResourcePolicy) {
    await this.session(resource).page.locator(selector).fill(text, { timeout: policy.operationTimeoutMs });
  }

  async key(resource: BrowserProviderRef, key: string, policy: BrowserResourcePolicy) {
    await this.session(resource).page.keyboard.press(key, { delay: Math.min(policy.operationTimeoutMs, 100) });
  }

  async scroll(resource: BrowserProviderRef, deltaX: number, deltaY: number) {
    await this.session(resource).page.mouse.wheel(deltaX, deltaY);
  }

  async extract(resource: BrowserProviderRef, selector: string | undefined, policy: BrowserResourcePolicy) {
    const { page } = this.session(resource);
    const text = await page.locator(selector || "body").innerText({ timeout: policy.operationTimeoutMs });
    return { url: page.url(), text: text.slice(0, policy.maxExtractChars), truncated: text.length > policy.maxExtractChars };
  }

  async screenshot(resource: BrowserProviderRef) {
    return Uint8Array.from(await this.session(resource).page.screenshot({ type: "png", fullPage: true }));
  }

  async close(resource: BrowserProviderRef) {
    const session = this.sessions.get(resource.resourceId);
    if (!session) return;
    this.sessions.delete(resource.resourceId);
    await session.context.close();
    if (this.sessions.size === 0 && this.browser) {
      await this.browser.close();
      this.browser = undefined;
    }
  }

  async health() {
    try {
      if (!this.browser) {
        const probe = await chromium.launch({ headless: true });
        await probe.close();
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Playwright is unavailable." };
    }
  }
}
