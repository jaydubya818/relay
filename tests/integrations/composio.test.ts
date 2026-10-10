import { describe, expect, it } from "vitest";
import { ComposioProviderAdapter, requireLiveComposioAdmission } from "@/lib/integrations/composio";
import { assertBinding, providerUserId } from "@/lib/integrations/contracts";
import { account, binding, fixture, qualification, scope, tool } from "./fixtures";

describe("Composio provider boundary (synthetic qualification)", () => {
  it("executes an exact, versioned read with a specific connected account and projected result", async () => {
    const { adapter, sdk } = fixture();
    const result = await adapter.executeRead(scope, binding, tool.slug, { per_page: 10 });
    expect(result).toMatchObject({ state: "SUCCEEDED", trust: "UNTRUSTED_EXTERNAL_DATA", data: { issues: [{ number: 7, title: "Fix connection retry" }] } });
    expect(sdk.tools.execute).toHaveBeenCalledWith(tool.slug, expect.objectContaining({ connectedAccountId: binding.connectedAccountId, userId: binding.providerUserId, version: qualification.version, allowTracing: false }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(JSON.stringify(result)).not.toContain("do-not-return");
    expect(result.evidence.resultDigest).toMatch(/^sha256:/);
  });
  it.each(["accountId", "ownerPrincipalId", "installationId", "agentId"] as const)("rejects foreign %s before any provider operation", async key => {
    const { adapter, sdk } = fixture();
    await expect(adapter.executeRead({ ...scope, [key]: "foreign" }, binding, tool.slug, { per_page: 10 })).rejects.toMatchObject({ code: "SCOPE_MISMATCH" });
    expect(sdk.tools.execute).not.toHaveBeenCalled(); expect(sdk.connectedAccounts.list).not.toHaveBeenCalled();
  });
  it("cannot substitute a provider user or connected account", async () => {
    const { adapter, sdk } = fixture();
    expect(() => assertBinding(scope, { ...binding, providerUserId: "foreign" })).toThrow();
    await expect(adapter.executeRead(scope, { ...binding, connectedAccountId: "foreign" }, tool.slug, { per_page: 10 })).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
    expect(sdk.tools.execute).not.toHaveBeenCalled();
    expect(sdk.connectedAccounts.list).toHaveBeenCalledWith(expect.objectContaining({ userIds: [providerUserId(scope)], authConfigIds: [binding.authConfigId], accountType: "PRIVATE" }), expect.anything());
  });
  it.each(["REVOKED", "DISABLED", "EXPIRED", "ERROR", "REQUIRES_SETUP"] as const)("rejects %s connections", async status => {
    const { adapter, sdk } = fixture();
    await expect(adapter.executeRead(scope, { ...binding, status }, tool.slug, { per_page: 10 })).rejects.toThrow();
    expect(sdk.tools.execute).not.toHaveBeenCalled();
  });
  it("rejects expired metadata, missing scopes, and provider-disabled accounts", async () => {
    const { adapter, sdk } = fixture();
    await expect(adapter.executeRead(scope, { ...binding, expiresAt: "2000-01-01T00:00:00Z" }, tool.slug, { per_page: 10 })).rejects.toThrow();
    await expect(adapter.executeRead(scope, { ...binding, scopes: [] }, tool.slug, { per_page: 10 })).rejects.toThrow();
    sdk.connectedAccounts.list.mockResolvedValue({ items: [{ ...account, isDisabled: true }], totalPages: 1, nextCursor: null });
    await expect(adapter.executeRead(scope, binding, tool.slug, { per_page: 10 })).rejects.toThrow();
    expect(sdk.tools.execute).not.toHaveBeenCalled();
  });
  it("rejects unqualified tools and writes regardless of their catalog presence", async () => {
    const { adapter, sdk } = fixture();
    await expect(adapter.executeRead(scope, binding, "GITHUB_CREATE_AN_ISSUE", {})).rejects.toMatchObject({ code: "TOOL_NOT_QUALIFIED" });
    expect(sdk.tools.getRawComposioToolBySlug).not.toHaveBeenCalled();
  });
  it("bounds discovery and uses reviewed descriptions", async () => {
    const { adapter } = fixture();
    const actions = await adapter.listActions("github", "assigned", 1);
    expect(actions).toHaveLength(1); expect(actions[0].description).toBe(qualification.description);
    await expect(adapter.listActions("github", "", 100)).rejects.toThrow();
    expect(await adapter.listActions("slack", "", 5)).toEqual([]);
  });
  it("fails on schema, version or toolkit drift", async () => {
    for (const changed of [{ ...tool, version: "latest" }, { ...tool, toolkit: { slug: "slack", name: "Slack" } }, { ...tool, inputParameters: { type: "object" as const, properties: {} } }]) {
      const { adapter, sdk } = fixture(); sdk.tools.getRawComposioToolBySlug.mockResolvedValue(changed);
      await expect(adapter.executeRead(scope, binding, tool.slug, { per_page: 10 })).rejects.toMatchObject({ code: "TOOL_SCHEMA_DRIFT" });
      expect(sdk.tools.execute).not.toHaveBeenCalled();
    }
  });
  it("rejects unreviewed arguments", async () => {
    const { adapter, sdk } = fixture();
    await expect(adapter.executeRead(scope, binding, tool.slug, { per_page: 10, token: "secret" })).rejects.toThrow();
    expect(sdk.tools.execute).not.toHaveBeenCalled();
  });
  it("projects connection metadata without credential or diagnostic fields", async () => {
    const { adapter } = fixture();
    expect(await adapter.connectionStatus(scope, binding)).toEqual({ connectedAccountId: binding.connectedAccountId, status: "ACTIVE", disabled: false });
  });
  it("does not retry ambiguous executions or expose provider errors", async () => {
    const { adapter, sdk } = fixture(); sdk.tools.execute.mockRejectedValue(new Error("Bearer private-provider-credential"));
    const result = await adapter.executeRead(scope, binding, tool.slug, { per_page: 10 });
    expect(result.state).toBe("UNKNOWN"); expect(sdk.tools.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("private-provider");
  });
  it("bounds stalled provider calls and preserves UNKNOWN", async () => {
    const { adapter, sdk } = fixture(5); sdk.tools.execute.mockImplementation(() => new Promise(() => {}));
    expect(await adapter.executeRead(scope, binding, tool.slug, { per_page: 10 })).toMatchObject({ state: "UNKNOWN", evidence: { errorCode: "TIMEOUT" } });
    expect(sdk.tools.execute).toHaveBeenCalledTimes(1);
  });
  it("normalizes rate limits without automatic retry", async () => {
    const { adapter, sdk } = fixture(); sdk.connectedAccounts.list.mockRejectedValue({ cause: { status: 429, headers: new Headers({ "retry-after": "5" }) } });
    await expect(adapter.connectionStatus(scope, binding)).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterMs: 5000 });
    expect(sdk.connectedAccounts.list).toHaveBeenCalledTimes(1);
  });
  it("checks auth config and callback origin before creating a connection", async () => {
    const { adapter, sdk } = fixture();
    await expect(adapter.initiateConnection(scope, "github", binding.authConfigId, "https://attacker.example/callback")).rejects.toThrow();
    await expect(adapter.initiateConnection(scope, "slack", binding.authConfigId, "http://127.0.0.1:3261/callback")).rejects.toMatchObject({ code: "AUTH_CONFIG_MISMATCH" });
    expect(sdk.connectedAccounts.link).not.toHaveBeenCalled();
    expect(await adapter.initiateConnection(scope, "github", binding.authConfigId, "http://127.0.0.1:3261/callback?state=synthetic")).toMatchObject({ requestId: "request_synthetic" });
  });
  it("preserves pending remote revocation", async () => {
    const { adapter, sdk } = fixture(); sdk.connectedAccounts.delete.mockRejectedValue(new Error("unknown"));
    expect(await adapter.revoke(scope, binding)).toEqual({ providerRevocation: "PENDING" });
    expect(sdk.connectedAccounts.delete).toHaveBeenCalledTimes(1);
  });
  it("can remove the provider connection after Relay has already fenced it", async () => {
    const { adapter, sdk } = fixture();
    expect(await adapter.revoke(scope, { ...binding, status: "REVOKED", revokedAt: new Date().toISOString() })).toEqual({ providerRevocation: "CONFIRMED" });
    expect(sdk.connectedAccounts.delete).toHaveBeenCalledTimes(1);
    expect(sdk.tools.execute).not.toHaveBeenCalled();
  });
  it("does not interpret a provider failure response as proof of no effect", async () => {
    const { adapter, sdk } = fixture();
    sdk.tools.execute.mockResolvedValue({ data: { issues: [], access_token: "private" }, successful: false, error: null });
    expect(await adapter.executeRead(scope, binding, tool.slug, { per_page: 10 })).toMatchObject({ state: "UNKNOWN", evidence: { errorCode: "PROVIDER_REPORTED_FAILURE" } });
    expect(sdk.tools.execute).toHaveBeenCalledTimes(1);
  });
  it("leaves live custody and remote admission closed", () => {
    expect(requireLiveComposioAdmission).toThrow("CUSTODY_AND_CROSS_DATABASE_ADMISSION_UNQUALIFIED");
    expect(() => new ComposioProviderAdapter(fixture().sdk, [{ ...qualification, version: "latest" }], "https://relay.example")).toThrow();
  });
});
