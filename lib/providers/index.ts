import { DockerSandboxProvider } from "@/lib/providers/docker-sandbox";
import type { SandboxProvider } from "@/lib/providers/sandbox";

let activeSandboxProvider: SandboxProvider | undefined;

export function sandboxProvider(): SandboxProvider {
  activeSandboxProvider ??= new DockerSandboxProvider();
  return activeSandboxProvider;
}

export function setSandboxProviderForTests(provider?: SandboxProvider) {
  activeSandboxProvider = provider;
}
