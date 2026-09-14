import { execFile, spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { posix } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { RelayError } from "@/lib/errors";
import type { SandboxCommandResult, SandboxFile, SandboxProvider, SandboxProviderRef, SandboxResourcePolicy } from "@/lib/providers/sandbox";

const execFileAsync = promisify(execFile);

function dockerBinary() {
  return process.env.RELAY_DOCKER_BIN ?? "/Applications/Docker.app/Contents/Resources/bin/docker";
}

function workspacePath(value: string) {
  const normalized = posix.normalize(`/${value}`).slice(1);
  if (!normalized || normalized === "." || normalized.startsWith("../") || value.includes("\0")) throw new RelayError("INVALID_INPUT", "Sandbox path must identify a file inside the workspace.");
  return `/workspace/${normalized}`;
}

async function docker(args: string[], options: { timeout?: number; maxBuffer?: number } = {}) {
  try {
    return await execFileAsync(dockerBinary(), args, { encoding: "utf8", timeout: options.timeout ?? 30_000, maxBuffer: options.maxBuffer ?? 1024 * 1024 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Docker operation failed.";
    throw new RelayError("PROVIDER_ERROR", `Sandbox provider failed: ${message}`, "sandbox.exec", 502);
  }
}

function writeToProcess(args: string[], content: Uint8Array) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(dockerBinary(), args, { stdio: ["pipe", "ignore", "pipe"] });
    let errorOutput = "";
    child.stderr.on("data", (chunk) => { if (errorOutput.length < 16_384) errorOutput += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new RelayError("PROVIDER_ERROR", `Sandbox file write failed${errorOutput ? `: ${errorOutput.trim()}` : "."}`, "sandbox.file.write", 502)));
    child.stdin.end(content);
  });
}

function readFromProcess(args: string[], maxBytes: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(dockerBinary(), args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let errorOutput = "";
    let exceeded = false;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) { exceeded = true; child.kill(); return; }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => { if (errorOutput.length < 16_384) errorOutput += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (exceeded) return reject(new RelayError("INVALID_INPUT", "Sandbox file exceeds the read limit.", "sandbox.file.read", 413));
      if (code !== 0) return reject(new RelayError("PROVIDER_ERROR", `Sandbox file read failed${errorOutput ? `: ${errorOutput.trim()}` : "."}`, "sandbox.file.read", 502));
      resolve(Buffer.concat(chunks));
    });
  });
}

export class DockerSandboxProvider implements SandboxProvider {
  readonly id = "docker";

  async create(policy: SandboxResourcePolicy) {
    const name = `relay-sandbox-${randomUUID()}`;
    const network = policy.network === "OPEN" ? "bridge" : "none";
    const image = process.env.RELAY_SANDBOX_IMAGE ?? "alpine:3.20";
    const { stdout } = await docker([
      "run", "-d", "--name", name,
      "--label", "relay.resource=sandbox",
      "--network", network,
      "--cpus", String(policy.cpuLimit),
      "--memory", `${policy.memoryMb}m`,
      "--pids-limit", "128",
      "--security-opt", "no-new-privileges",
      "--cap-drop", "ALL",
      "--workdir", "/workspace",
      image, "tail", "-f", "/dev/null",
    ], { timeout: 120_000 });
    return { resourceId: stdout.trim() };
  }

  async exec(resource: SandboxProviderRef, command: string, policy: SandboxResourcePolicy): Promise<SandboxCommandResult> {
    const started = performance.now();
    const timeoutSeconds = Math.max(1, Math.ceil(policy.timeoutMs / 1000));
    try {
      const { stdout, stderr } = await execFileAsync(dockerBinary(), ["exec", resource.resourceId, "timeout", `${timeoutSeconds}s`, "sh", "-lc", command], {
        encoding: "utf8", timeout: policy.timeoutMs + 2_000, maxBuffer: policy.maxOutputBytes,
      });
      return { exitCode: 0, stdout, stderr, timedOut: false, truncated: false, durationMs: Math.round(performance.now() - started) };
    } catch (error) {
      const result = error as Error & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
      const timedOut = result.killed || result.code === 124 || result.code === 137 || result.code === 143;
      const truncated = /maxBuffer/i.test(result.message);
      return {
        exitCode: typeof result.code === "number" ? result.code : timedOut ? 124 : 1,
        stdout: (result.stdout ?? "").slice(0, policy.maxOutputBytes),
        stderr: (result.stderr ?? (truncated ? "Command output exceeded the configured limit." : "")).slice(0, policy.maxOutputBytes),
        timedOut, truncated, durationMs: Math.round(performance.now() - started),
      };
    }
  }

  async readFile(resource: SandboxProviderRef, path: string, maxBytes: number) {
    return Uint8Array.from(await readFromProcess(["exec", resource.resourceId, "cat", workspacePath(path)], maxBytes));
  }

  async writeFile(resource: SandboxProviderRef, path: string, content: Uint8Array) {
    const target = workspacePath(path);
    await writeToProcess(["exec", "-i", resource.resourceId, "sh", "-c", "mkdir -p \"$(dirname \"$1\")\" && cat > \"$1\"", "relay-write", target], content);
  }

  async listFiles(resource: SandboxProviderRef, path: string): Promise<SandboxFile[]> {
    const root = path ? workspacePath(path) : "/workspace";
    const script = "for p in \"$1\"/* \"$1\"/.[!.]* \"$1\"/..?*; do [ -e \"$p\" ] || continue; if [ -d \"$p\" ]; then k=DIRECTORY; else k=FILE; fi; printf '%s\\t%s\\n' \"$k\" \"$p\"; done";
    const { stdout } = await docker(["exec", resource.resourceId, "sh", "-c", script, "relay-list", root]);
    return stdout.split("\n").filter(Boolean).map((entry) => {
      const [kind, entryPath] = entry.split("\t", 2);
      return { path: entryPath.replace(/^\/workspace\/?/, ""), kind: kind === "DIRECTORY" ? "DIRECTORY" as const : "FILE" as const };
    });
  }

  async deleteFile(resource: SandboxProviderRef, path: string) {
    await docker(["exec", resource.resourceId, "rm", "-rf", "--", workspacePath(path)]);
  }

  async destroy(resource: SandboxProviderRef) {
    await docker(["rm", "-f", resource.resourceId]);
  }

  async health() {
    try {
      await docker(["info", "--format", "{{.ServerVersion}}"], { timeout: 5_000 });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Docker is unavailable." };
    }
  }
}
