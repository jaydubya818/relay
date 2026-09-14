import { performance } from "node:perf_hooks";
import { recordActivity } from "@/lib/activity";
import { authorize } from "@/lib/authorization";
import { githubProvider } from "@/lib/connectors/github";
import { googleProvider } from "@/lib/connectors/google";
import { githubSecret, googleSecret } from "@/lib/connections";
import { RelayError } from "@/lib/errors";
import { addMemory, getMemory, listMemories } from "@/lib/memory";
import { searchCapabilities } from "@/lib/capabilities";
import { acknowledgeInboxItem, getInboxItem, listInbox } from "@/lib/inbox";
import { createSandbox, destroySandbox, execSandbox, listSandboxFiles, readSandboxFile, writeSandboxFile } from "@/lib/sandboxes";
import { clickBrowser, closeBrowserSession, createBrowserSession, extractBrowser, navigateBrowser, screenshotBrowser, typeBrowser } from "@/lib/browsers";
import type { ActivityStatus, AgentPrincipal, CapabilityName, MemoryScope, MemoryType } from "@/lib/types";

export async function executeCapability(input: {
  principal: AgentPrincipal;
  capability: CapabilityName;
  action: string;
  sessionId: string;
  provider?: string;
  arguments: Record<string, unknown>;
}) {
  const started = performance.now();
  let status: ActivityStatus = "SUCCESS";
  try {
    await authorize(input.principal, input.capability);
    let result: unknown;
    switch (input.action) {
      case "memory.add":
        result = await addMemory(input.principal, {
          content: String(input.arguments.content ?? ""),
          type: String(input.arguments.type ?? "OTHER") as MemoryType,
          scope: String(input.arguments.scope ?? "SHARED") as MemoryScope,
        });
        break;
      case "memory.search":
      case "memory.list":
        result = await listMemories(input.principal, {
          query: input.action === "memory.search" ? String(input.arguments.query ?? "") : undefined,
          type: input.arguments.type as MemoryType | undefined,
          scope: input.arguments.scope as MemoryScope | undefined,
          limit: Number(input.arguments.limit ?? 50),
        });
        break;
      case "memory.get":
        result = await getMemory(input.principal, String(input.arguments.id ?? ""));
        break;
      case "github.repo.list":
      case "github.repo.get":
        result = await githubProvider.execute(
          await githubSecret(input.principal.accountId),
          input.action === "github.repo.list" ? "repo.list" : "repo.get",
          input.arguments,
        );
        break;
      case "email.search":
      case "email.read":
      case "calendar.event.list":
      case "calendar.event.read":
      case "calendar.availability.read":
        result = await googleProvider.execute(await googleSecret(input.principal.accountId, input.action), input.action, input.arguments);
        break;
      case "sandbox.create":
        result = await createSandbox(input.principal, input.sessionId, input.arguments);
        break;
      case "sandbox.exec":
        result = await execSandbox(input.principal, String(input.arguments.sandboxId ?? ""), String(input.arguments.command ?? ""));
        if ((result as { timedOut?: boolean }).timedOut) status = "BLOCKED";
        else if ((result as { exitCode?: number }).exitCode !== 0) status = "FAILED";
        break;
      case "sandbox.file.read":
        result = await readSandboxFile(input.principal, String(input.arguments.sandboxId ?? ""), String(input.arguments.path ?? ""));
        break;
      case "sandbox.file.write":
        result = await writeSandboxFile(input.principal, String(input.arguments.sandboxId ?? ""), String(input.arguments.path ?? ""), String(input.arguments.content ?? ""));
        break;
      case "sandbox.file.list":
        result = await listSandboxFiles(input.principal, String(input.arguments.sandboxId ?? ""), String(input.arguments.path ?? ""));
        break;
      case "sandbox.destroy":
        result = await destroySandbox(input.principal, String(input.arguments.sandboxId ?? ""));
        break;
      case "browser.create":
        result = await createBrowserSession(input.principal, input.arguments);
        break;
      case "browser.navigate":
        result = await navigateBrowser(input.principal, String(input.arguments.browserSessionId ?? ""), String(input.arguments.url ?? ""));
        break;
      case "browser.click":
        result = await clickBrowser(input.principal, String(input.arguments.browserSessionId ?? ""), String(input.arguments.selector ?? ""));
        break;
      case "browser.type":
        result = await typeBrowser(input.principal, String(input.arguments.browserSessionId ?? ""), String(input.arguments.selector ?? ""), String(input.arguments.text ?? ""));
        break;
      case "browser.extract":
        result = await extractBrowser(input.principal, String(input.arguments.browserSessionId ?? ""), input.arguments.selector ? String(input.arguments.selector) : undefined);
        break;
      case "browser.screenshot":
        result = await screenshotBrowser(input.principal, String(input.arguments.browserSessionId ?? ""));
        break;
      case "browser.close":
        result = await closeBrowserSession(input.principal, String(input.arguments.browserSessionId ?? ""));
        break;
      case "agent.inbox.list":
        result = await listInbox(input.principal, input.arguments.status as "UNREAD" | "CLAIMED" | "PROCESSED" | "FAILED" | undefined, Number(input.arguments.limit ?? 50));
        break;
      case "agent.inbox.get":
        result = await getInboxItem(input.principal, String(input.arguments.inboxItemId ?? ""));
        break;
      case "agent.inbox.ack":
        result = await acknowledgeInboxItem(input.principal, String(input.arguments.inboxItemId ?? ""), (input.arguments.outcome as "PROCESSED" | "FAILED") ?? "PROCESSED");
        break;
      case "capabilities.search":
        result = await searchCapabilities(String(input.arguments.query ?? ""), input.arguments.domain ? String(input.arguments.domain) : undefined, Number(input.arguments.limit ?? 25));
        break;
      default:
        throw new RelayError("INVALID_INPUT", "Unknown capability action.", input.capability);
    }
    return result;
  } catch (error) {
    status = error instanceof RelayError && error.code === "CAPABILITY_DENIED" ? "DENIED" : "FAILED";
    throw error;
  } finally {
    await recordActivity({
      accountId: input.principal.accountId,
      agentId: input.principal.agentId,
      sessionId: input.sessionId,
      capability: input.capability,
      provider: input.provider,
      action: input.action,
      status,
      durationMs: performance.now() - started,
      resourceType: input.arguments.sandboxId ? "sandbox" : input.arguments.browserSessionId ? "browser_session" : input.arguments.inboxItemId ? "agent_inbox_item" : undefined,
      resourceId: String(input.arguments.sandboxId ?? input.arguments.browserSessionId ?? input.arguments.inboxItemId ?? "") || undefined,
    });
    console.info(JSON.stringify({
      level: "info",
      event: "capability_call",
      requestId: input.sessionId,
      agentId: input.principal.agentId,
      capability: input.capability,
      status,
      durationMs: Math.round(performance.now() - started),
    }));
  }
}
