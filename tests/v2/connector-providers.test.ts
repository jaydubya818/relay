import { describe, expect, it, vi } from "vitest";
import { GoogleDriveConnectorAdapter, LinearConnectorAdapter } from "@/lib/v2/providers/connectors";

describe("WO-17 Google Drive and Linear provider contracts", () => {
  it("pre-generates a Drive file ID and canonicalizes the provider receipt", async () => {
    const client = { inspect: vi.fn(async () => ({ scopes: ["openid", "email", "https://www.googleapis.com/auth/drive.file"], accessibleResourceIds: ["folder-1"], writableResourceIds: ["folder-1"] })), generateFileId: vi.fn(async () => "generated-1"), call: vi.fn(async () => ({ state: "SUCCEEDED" as const, resource: { id: "generated-1", name: "report.txt", mimeType: "text/plain", parents: ["folder-1"] }, receipt: { requestId: "google-1" } })), reconcileCreate: vi.fn(async () => ({ found: true, resource: { id: "generated-1", name: "report.txt", mimeType: "text/plain", parents: ["folder-1"] }, receipt: { requestId: "google-2" } })) }; const adapter = new GoogleDriveConnectorAdapter(client);
    const prepared = await adapter.prepare({ accountId: "acct_1", credentialHandle: "vlt_google1234", capability: "connectors.drive.file.create" }); expect(prepared).toEqual({ providerResourceId: "generated-1" });
    await expect(adapter.execute({ accountId: "acct_1", credentialHandle: "vlt_google1234", capability: "connectors.drive.file.create", providerResourceId: prepared.providerResourceId, parameters: { containerId: "folder-1" } })).resolves.toMatchObject({ state: "SUCCEEDED", providerResourceId: "generated-1", receipt: { resource: { provider: "GOOGLE_DRIVE", externalId: "generated-1", containerIds: ["folder-1"] } } });
  });

  it("carries a stable Linear reference and reconciles it inside the selected team", async () => {
    const client = { inspect: vi.fn(async () => ({ scopes: ["read", "write"], accessibleResourceIds: ["team-1"], writableResourceIds: ["team-1"] })), call: vi.fn(async () => ({ state: "EFFECT_UNKNOWN" as const, receipt: { errorClass: "TIMEOUT" } })), reconcileReference: vi.fn(async () => ({ found: true, resource: { id: "issue-1", identifier: "REL-1", title: "Investigate", team: { id: "team-1" } }, receipt: { requestId: "linear-2" } })) }; const adapter = new LinearConnectorAdapter(client);
    await expect(adapter.execute({ accountId: "acct_1", credentialHandle: "vlt_linear1234", capability: "connectors.linear.issue.create", idempotencyKey: "linear-ref-1", parameters: { teamId: "team-1", title: "Investigate" } })).resolves.toMatchObject({ state: "EFFECT_UNKNOWN" });
    await expect(adapter.reconcile({ accountId: "acct_1", credentialHandle: "vlt_linear1234", idempotencyKey: "linear-ref-1", parameters: { teamId: "team-1" } })).resolves.toMatchObject({ state: "SUCCEEDED", providerResourceId: "issue-1", receipt: { relayReference: "linear-ref-1" } }); expect(client.reconcileReference).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team-1", relayReference: "linear-ref-1" }));
  });
});
