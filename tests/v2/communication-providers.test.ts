import { describe, expect, it, vi } from "vitest";
import { CommunicationProviderError } from "@/lib/v2/communications";
import { SlackTelegramCommunicationSender, type CommunicationHttpClient, type CommunicationHttpResponse } from "@/lib/v2/providers/communications";

function response(status: number, body: unknown, headers: Record<string, string> = {}): CommunicationHttpResponse { return { status, headers, json: async () => body }; }

describe("WO-16 communication provider adapters", () => {
  it("uses Slack client_msg_id and returns the provider message identifier", async () => {
    const http = { request: vi.fn(async (input: Parameters<CommunicationHttpClient["request"]>[0]) => { void input; return response(200, { ok: true, ts: "171.42" }); }) }; const sender = new SlackTelegramCommunicationSender(http);
    await expect(sender.send({ provider: "SLACK", credential: "secret-token", conversationId: "C1", threadId: "170.1", text: "hello", idempotencyKey: "message-key-1" })).resolves.toMatchObject({ providerMessageId: "171.42", state: "SENT" });
    expect(JSON.parse(http.request.mock.calls[0]![0].body)).toMatchObject({ channel: "C1", thread_ts: "170.1", client_msg_id: "message-key-1" }); expect(http.request.mock.calls[0]![0].body).not.toContain("secret-token");
  });

  it("honors Slack and Telegram retry hints as explicit pre-effect rate limits", async () => {
    const slack = new SlackTelegramCommunicationSender({ request: async () => response(429, { ok: false, error: "ratelimited" }, { "retry-after": "3" }) });
    await expect(slack.send({ provider: "SLACK", credential: "x", conversationId: "C1", text: "hello", idempotencyKey: "key-12345" })).rejects.toMatchObject({ kind: "RATE_LIMIT", retryAfterMs: 3_000 });
    const telegram = new SlackTelegramCommunicationSender({ request: async () => response(429, { ok: false, parameters: { retry_after: 5 } }) });
    await expect(telegram.send({ provider: "TELEGRAM", credential: "x", conversationId: "1", text: "hello", idempotencyKey: "key-12345" })).rejects.toMatchObject({ kind: "RATE_LIMIT", retryAfterMs: 5_000 });
  });

  it("classifies transport and 5xx outcomes as ambiguous rather than retry-safe", async () => {
    const timeout = new SlackTelegramCommunicationSender({ request: async () => { throw new Error("network"); } });
    await expect(timeout.send({ provider: "TELEGRAM", credential: "x", conversationId: "1", text: "hello", idempotencyKey: "key-12345" })).rejects.toEqual(expect.objectContaining<Partial<CommunicationProviderError>>({ kind: "TIMEOUT" }));
    const server = new SlackTelegramCommunicationSender({ request: async () => response(503, { ok: false, error: "down" }) });
    await expect(server.send({ provider: "SLACK", credential: "x", conversationId: "C1", text: "hello", idempotencyKey: "key-12345" })).rejects.toMatchObject({ kind: "SERVER" });
  });

  it("classifies Telegram non-JSON 5xx without parsing or exposing its body", async () => {
    const json = vi.fn(async () => { throw new Error("canary-secret-in-proxy-body"); });
    const sender = new SlackTelegramCommunicationSender({ request: async () => ({ status: 502, headers: {}, json }) });
    await expect(sender.send({ provider: "TELEGRAM", credential: "x", conversationId: "1", text: "hello", idempotencyKey: "key" })).rejects.toMatchObject({ kind: "SERVER" });
    expect(json).not.toHaveBeenCalled();
  });

  it("does not expose Telegram rejection descriptions in thrown errors", async () => {
    const sender = new SlackTelegramCommunicationSender({ request: async () => response(400, { ok: false, description: "canary-private-payload" }) });
    await expect(sender.send({ provider: "TELEGRAM", credential: "x", conversationId: "1", text: "hello", idempotencyKey: "key" })).rejects.toMatchObject({ kind: "REJECTED", message: "Telegram rejected the message." });
  });

  it("contains malformed Telegram success bodies as ambiguous outcomes", async () => {
    const sender = new SlackTelegramCommunicationSender({ request: async () => ({ status: 200, headers: {}, json: async () => { throw new Error("canary-private-response"); } }) });
    await expect(sender.send({ provider: "TELEGRAM", credential: "x", conversationId: "1", text: "hello", idempotencyKey: "key" })).rejects.toMatchObject({ kind: "SERVER", message: "Telegram response outcome is unknown." });
  });
});
