import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposioProviderAdapter, createComposioSDK } from "@/lib/integrations/composio";
import { verifyComposioEvent } from "@/lib/integrations/webhooks";
import { binding, qualification, scope, tool } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("Pinned SDK wire contracts, no live provider requests", () => {
  it("uses the installed SDK to emit exact user/account/version bindings", async () => {
    const seen: Array<{ url: URL; body?: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const rawBody = request.method === "POST" ? await request.text() : "";
      const body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : undefined;
      seen.push({ url, body });
      if (url.pathname.endsWith("/revoke")) return Response.json({ revoked_tokens: ["access_token"], connected_account: { id: binding.connectedAccountId, status: "REVOKED" } });
      if (url.pathname.includes("/tools/execute/")) return Response.json({ data: { issues: [{ number: 7, title: "Fix connection retry" }] }, successful: true, error: null });
      if (url.pathname.includes("/tools/")) return Response.json({ ...tool, input_parameters: tool.inputParameters, output_parameters: tool.outputParameters });
      if (url.pathname.endsWith("/connected_accounts")) return Response.json({ items: [{ id: binding.connectedAccountId,
        auth_config: { id: binding.authConfigId, auth_scheme: "OAUTH2", is_composio_managed: true, is_disabled: false },
        toolkit: { slug: "github" }, status: "ACTIVE", status_reason: null, is_disabled: false,
        data: { access_token: "synthetic-must-not-escape" }, created_at: "2026-10-09T00:00:00Z", updated_at: "2026-10-09T00:00:00Z" }], total_pages: 1 });
      throw new Error(`Unexpected fixture request: ${url.pathname}`);
    }));
    const sdk = createComposioSDK("synthetic-not-a-provider-key");
    expect(sdk.getClient().maxRetries).toBe(0);
    const adapter = new ComposioProviderAdapter(sdk, [qualification], "https://relay.example");
    const result = await adapter.executeRead(scope, binding, tool.slug, { per_page: 10 });
    expect(result.state).toBe("SUCCEEDED");
    expect(seen.filter(entry => entry.body)).toHaveLength(1);
    expect(seen.find(entry => entry.body)?.body).toMatchObject({ user_id: binding.providerUserId, connected_account_id: binding.connectedAccountId,
      version: qualification.version, arguments: { per_page: 10 }, allow_tracing: false });
    const lookup = seen.find(entry => entry.url.pathname.endsWith("/connected_accounts"))!.url;
    expect(lookup.searchParams.get("user_ids")).toBe(binding.providerUserId);
    expect(JSON.stringify(result)).not.toContain("synthetic-must-not-escape");
    expect(await adapter.revoke(scope, { ...binding, status: "REVOKED", revokedAt: new Date().toISOString() })).toEqual({ providerRevocation: "CONFIRMED" });
    expect(seen.filter(entry => entry.url.pathname.endsWith(`/${binding.connectedAccountId}/revoke`))).toHaveLength(1);
  });

  it("does not retry SDK requests after provider failure", async () => {
    const fetch = vi.fn(async () => Response.json({ error: { message: "synthetic-provider-secret" } }, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const adapter = new ComposioProviderAdapter(createComposioSDK("synthetic-key"), [qualification], "https://relay.example");
    await expect(adapter.getAction(tool.slug)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("verifies webhook signatures locally and rejects expired, tampered and oversized payloads", async () => {
    const fetch = vi.fn(async () => { throw new Error("No network permitted"); }); vi.stubGlobal("fetch", fetch);
    const sdk = createComposioSDK("synthetic-key");
    const body = JSON.stringify({ trigger_name: "GITHUB_ISSUE_ADDED_EVENT", connection_id: binding.connectedAccountId,
      trigger_id: "trigger_synthetic", log_id: "log_synthetic", payload: { number: 7 } });
    const id = "event_synthetic", secret = "synthetic-webhook-secret", timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v1,${createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
    const input = { body, id, secret, timestamp, signature };
    expect(await verifyComposioEvent(sdk, input)).toMatchObject({ webhookId: id, authority: "NONE" });
    await expect(verifyComposioEvent(sdk, { ...input, body: body.replace('7', '8') })).rejects.toThrow();
    await expect(verifyComposioEvent(sdk, { ...input, timestamp: "1000000000" })).rejects.toThrow();
    await expect(verifyComposioEvent(sdk, { ...input, body: "x".repeat(256 * 1024 + 1) })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
