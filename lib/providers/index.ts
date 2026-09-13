import { DockerSandboxProvider } from "@/lib/providers/docker-sandbox";
import type { SandboxProvider } from "@/lib/providers/sandbox";
import { PlaywrightBrowserProvider } from "@/lib/providers/playwright-browser";
import type { BrowserProvider } from "@/lib/providers/browser";

let activeSandboxProvider: SandboxProvider | undefined;
let activeBrowserProvider: BrowserProvider | undefined;

export function sandboxProvider(): SandboxProvider {
  activeSandboxProvider ??= new DockerSandboxProvider();
  return activeSandboxProvider;
}

export function setSandboxProviderForTests(provider?: SandboxProvider) {
  activeSandboxProvider = provider;
}

export function browserProvider(): BrowserProvider {
  activeBrowserProvider ??= new PlaywrightBrowserProvider();
  return activeBrowserProvider;
}

export function setBrowserProviderForTests(provider?: BrowserProvider) {
  activeBrowserProvider = provider;
}
