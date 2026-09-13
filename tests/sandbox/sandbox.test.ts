import { readFileSync } from "node:fs";
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgent } from "@/lib/agents";
import { db } from "@/lib/db";
import { activities, sandboxes } from "@/lib/db/schema";
import { handleMcp } from "@/lib/mcp";
import { setSandboxProviderForTests } from "@/lib/providers";
import type { SandboxCommandResult, SandboxFile, SandboxProvider, SandboxProviderRef, SandboxResourcePolicy } from "@/lib/providers/sandbox";
import { shareSandbox } from "@/lib/sandboxes";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

class FakeSandboxProvider implements SandboxProvider {
  readonly id = "test-sandbox";
  readonly resources = new Map<string, Map<string, Uint8Array>>();
  readonly destroyed: string[] = [];
  private sequence = 0;

  async create() {
    const resourceId = `provider-${++this.sequence}`;
    this.resources.set(resourceId, new Map());
    return { resourceId };
  }

  async exec(_: SandboxProviderRef, command: string, policy: SandboxResourcePolicy): Promise<SandboxCommandResult> {
    if (command === "timeout") return { exitCode: 124, stdout: "", stderr: "", timedOut: true, truncated: false, durationMs: policy.timeoutMs };
    if (command === "fail") return { exitCode: 7, stdout: "", stderr: "failed", timedOut: false, truncated: false, durationMs: 1 };
    return { exitCode: 0, stdout: `ran:${command}`, stderr: "", timedOut: false, truncated: false, durationMs: 1 };
  }

  async readFile(resource: SandboxProviderRef, path: string) {
    return this.resources.get(resource.resourceId)?.get(path) ?? new Uint8Array();
  }

  async writeFile(resource: SandboxProviderRef, path: string, content: Uint8Array) {
    this.resources.get(resource.resourceId)!.set(path, content);
  }

  async listFiles(resource: SandboxProviderRef): Promise<SandboxFile[]> {
    return [...this.resources.get(resource.resourceId)!.keys()].map((path) => ({ path, kind: "FILE" }));
  }

  async destroy(resource: SandboxProviderRef) {
    this.destroyed.push(resource.resourceId);
    this.resources.delete(resource.resourceId);
  }

  async health() { return { ok: true }; }
}

function call(secret: string, name: string, args: Record<string, unknown> = {}) {
  return handleMcp(secret, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
}

function value(result: unknown) {
  return JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
}

describe("governed sandboxes", () => {
  let accountId: string;
  let provider: FakeSandboxProvider;

  beforeEach(async () => {
    accountId = (await freshDatabase()).accountId;
    provider = new FakeSandboxProvider();
    setSandboxProviderForTests(provider);
  });

  afterEach(async () => {
    setSandboxProviderForTests(undefined);
    await cleanupDatabase();
  });

  it("depends on the provider contract without leaking Docker into the domain service", () => {
    const service = readFileSync("lib/sandboxes.ts", "utf8");
    expect(service).toContain('from "@/lib/providers/sandbox"');
    expect(service.toLowerCase()).not.toContain("docker");
  });

  it("is private by default, supports explicit sharing, and denies cross-account access", async () => {
    const owner = await createAgent(accountId, { name: "Owner", capabilities: ["sandbox.create", "sandbox.exec", "sandbox.file.read", "sandbox.file.write", "sandbox.file.list", "sandbox.destroy"] });
    const peer = await createAgent(accountId, { name: "Peer", capabilities: ["sandbox.exec"] });
    const otherAccount = await secondAccount();
    const outsider = await createAgent(otherAccount, { name: "Outsider", capabilities: ["sandbox.exec"] });
    const created = value(await call(owner.credential, "relay_sandbox_create"));
    expect(created).not.toHaveProperty("providerResourceId");
    await expect(call(peer.credential, "relay_sandbox_exec", { sandboxId: created.id, command: "whoami" })).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await shareSandbox(accountId, created.id, peer.agentId);
    expect(value(await call(peer.credential, "relay_sandbox_exec", { sandboxId: created.id, command: "whoami" })).stdout).toBe("ran:whoami");
    await expect(call(outsider.credential, "relay_sandbox_exec", { sandboxId: created.id, command: "whoami" })).rejects.toMatchObject({ status: 404 });
  });

  it("reads, writes, lists, destroys, and records command failures and timeouts", async () => {
    const owner = await createAgent(accountId, { name: "Owner", capabilities: ["sandbox.create", "sandbox.exec", "sandbox.file.read", "sandbox.file.write", "sandbox.file.list", "sandbox.destroy"] });
    const created = value(await call(owner.credential, "relay_sandbox_create"));
    await call(owner.credential, "relay_sandbox_file_write", { sandboxId: created.id, path: "notes/relay.txt", content: "provider-neutral" });
    expect(value(await call(owner.credential, "relay_sandbox_file_read", { sandboxId: created.id, path: "notes/relay.txt" })).content).toBe("provider-neutral");
    expect(value(await call(owner.credential, "relay_sandbox_file_list", { sandboxId: created.id })).map((file: SandboxFile) => file.path)).toContain("notes/relay.txt");
    expect(value(await call(owner.credential, "relay_sandbox_exec", { sandboxId: created.id, command: "fail" })).exitCode).toBe(7);
    expect(value(await call(owner.credential, "relay_sandbox_exec", { sandboxId: created.id, command: "timeout" })).timedOut).toBe(true);
    expect(value(await call(owner.credential, "relay_sandbox_destroy", { sandboxId: created.id })).status).toBe("DESTROYED");
    const statuses = await db().select({ status: activities.status }).from(activities).where(and(eq(activities.accountId, accountId), eq(activities.capability, "sandbox.exec"))).orderBy(asc(activities.createdAt), asc(activities.id));
    expect(statuses.map((item) => item.status)).toEqual(["FAILED", "BLOCKED"]);
  });

  it("expires and cleans up a provider resource before allowing reuse", async () => {
    const owner = await createAgent(accountId, { name: "Owner", capabilities: ["sandbox.create", "sandbox.exec"] });
    const created = value(await call(owner.credential, "relay_sandbox_create"));
    await db().update(sandboxes).set({ expiresAt: new Date(Date.now() - 1000).toISOString() }).where(and(eq(sandboxes.id, created.id), eq(sandboxes.accountId, accountId)));
    await expect(call(owner.credential, "relay_sandbox_exec", { sandboxId: created.id, command: "echo stale" })).rejects.toMatchObject({ status: 410 });
    expect(provider.destroyed).toHaveLength(1);
  });
});
