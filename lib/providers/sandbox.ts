export type SandboxNetworkPolicy = "NONE" | "RESTRICTED" | "OPEN";

export type SandboxResourcePolicy = {
  ttlSeconds: number;
  timeoutMs: number;
  cpuLimit: number;
  memoryMb: number;
  maxOutputBytes: number;
  network: SandboxNetworkPolicy;
};

export type SandboxProviderRef = { resourceId: string };
export type SandboxCommandResult = { exitCode: number; stdout: string; stderr: string; timedOut: boolean; truncated: boolean; durationMs: number };
export type SandboxFile = { path: string; kind: "FILE" | "DIRECTORY" };
export type ProviderHealth = { ok: boolean; message?: string };

export interface SandboxProvider {
  readonly id: string;
  create(policy: SandboxResourcePolicy): Promise<SandboxProviderRef>;
  exec(resource: SandboxProviderRef, command: string, policy: SandboxResourcePolicy): Promise<SandboxCommandResult>;
  readFile(resource: SandboxProviderRef, path: string, maxBytes: number): Promise<Uint8Array>;
  writeFile(resource: SandboxProviderRef, path: string, content: Uint8Array): Promise<void>;
  listFiles(resource: SandboxProviderRef, path: string): Promise<SandboxFile[]>;
  deleteFile?(resource: SandboxProviderRef, path: string): Promise<void>;
  destroy(resource: SandboxProviderRef): Promise<void>;
  health(): Promise<ProviderHealth>;
}
