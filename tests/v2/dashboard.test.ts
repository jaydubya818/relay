import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalEd25519Signer } from "@/lib/v2/evidence";
import { getV2Dashboard, operatorContext } from "@/lib/v2/dashboard";
import { createV2Agent } from "@/lib/v2/passports";
import { registerRuntimeClient } from "@/lib/v2/runtime-clients";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

describe("WO-21 operator dashboard boundary", () => {
  afterEach(cleanupDatabase);

  it("projects only the authenticated account and omits durable credentials", async () => {
    const identity = await freshDatabase(); const signer = createLocalEd25519Signer("dashboard-key");
    const agent = await createV2Agent({ accountId: identity.accountId, ownerPrincipalId: identity.principalId, name: "Visible Agent" }, signer);
    const runtime = await registerRuntimeClient({ accountId: identity.accountId, actorPrincipalId: identity.principalId, displayName: "Visible Runtime", selfDeclaredProduct: "custom" }, signer);
    const own = await getV2Dashboard(identity.accountId);
    expect(own.agents).toEqual([expect.objectContaining({ id: agent.agentId, name: "Visible Agent" })]);
    expect(own.runtimes).toEqual([expect.objectContaining({ id: runtime.runtimeClientId, displayName: "Visible Runtime" })]);
    expect(JSON.stringify(own)).not.toMatch(/secretHash|credentialHandle|publicKeyPem|webhookSecretHandle/);
    const otherAccountId = await secondAccount();
    const other = await getV2Dashboard(otherAccountId);
    expect(other.agents).toEqual([]); expect(other.runtimes).toEqual([]); expect(other.activity).toEqual([]);
    await expect(operatorContext(otherAccountId, identity.userId)).rejects.toMatchObject({ status: 403 });
  });

  it("keeps critical controls explicit and publishes complete empty, unknown, and responsive states", async () => {
    const controls = await readFile("components/v2/operator-actions.tsx", "utf8");
    const styles = await readFile("app/globals.css", "utf8");
    const command = await readFile("app/v2/page.tsx", "utf8");
    expect(controls).toContain("confirmation"); expect(controls).toContain("Confirm"); expect(controls).toContain("Cancel");
    expect(styles).toContain("prefers-reduced-motion"); expect(styles).toContain("focus-visible"); expect(styles).toContain("@media (max-width: 660px)");
    expect(command).toContain("need human reconciliation"); expect(command).toContain("No active work");
  });
});
