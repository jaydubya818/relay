import { describe, expect, it } from "vitest";
import { RelayManagedExecutionAdapter } from "@/lib/v2/providers/relay-managed";

const live = process.env.RELAY_LIVE_PLAYWRIGHT === "1" && process.env.RELAY_LIVE_DOCKER === "1" ? it : it.skip;

describe("Relay-managed execution provider live", () => {
  live("runs and cleans up one combined browser/shell/file session", async () => {
    const provider = new RelayManagedExecutionAdapter(
      { assertActive: async () => undefined },
      { bindHandles: async () => ({ bindingId: "unused" }), revokeBinding: async () => undefined },
      { digest: "sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc", sbomReference: "docs/v2/qualification/relay-managed-sbom.cdx.json" },
    );
    const created = await provider.prepareExecution({ accountId: "acct_live1234", taskId: "tsk_live1234", actionIntentId: "act_live1234", leaseId: "lse_live1234", region: "local", isolationMode: "process", persistence: "ephemeral", classification: "internal", requiredFeatures: ["browser.visual", "shell", "files"], maximumSessionSeconds: 60, credentialHandles: [], idempotencyKey: "relay-managed-live" });
    const authority = { accountId: "acct_live1234", taskId: "tsk_live1234", leaseId: "lse_live1234", providerSessionId: created.providerSessionId };
    try {
      await provider.browserNavigate({ ...authority, url: "data:text/html,<title>Relay Managed</title>" });
      expect(await provider.shellExec({ ...authority, command: "printf relay-managed" })).toMatchObject({ exitCode: 0, stdout: "relay-managed" });
      await provider.fileWrite({ ...authority, path: "result.txt", bytes: new TextEncoder().encode("done") });
      expect(new TextDecoder().decode(await provider.fileRead({ ...authority, path: "result.txt" }))).toBe("done");
      expect((await provider.browserScreenshot(authority)).bytes.byteLength).toBeGreaterThan(100);
    } finally {
      await provider.terminate({ accountId: authority.accountId, providerSessionId: created.providerSessionId });
    }
    expect(await provider.reconcile({ accountId: authority.accountId, idempotencyKey: "relay-managed-live", providerSessionId: created.providerSessionId })).toEqual({ status: "TERMINATED" });
  }, 120_000);
});
