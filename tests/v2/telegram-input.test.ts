import { describe, expect, it } from "vitest";
import { parsePrivateTelegramUpdate, readBoundedTelegramBody, TELEGRAM_MAX_BODY_BYTES, verifyTelegramSecret } from "@/lib/v2/telegram-input";

const message = { message_id: 2, date: 1700000000, from: { id: 123, is_bot: false, username: "ignored" }, chat: { id: 123, type: "private" }, text: "Research public information" };
const body = (value: unknown) => Buffer.from(JSON.stringify(value));

describe("Telegram private-beta input boundary", () => {
  it("uses stable identifiers and drops unrelated identity claims", () => {
    expect(parsePrivateTelegramUpdate(body({ update_id: 1, message: { ...message, accountId: "acct_other", agentId: "agt_other" } }))).toEqual({ updateId: "1", messageId: "2", userId: "123", chatId: "123", sentAtSeconds: 1700000000, text: message.text });
  });

  it.each([
    { ...message, chat: { id: -1, type: "group" } },
    { ...message, chat: { id: 456, type: "private" } },
    { ...message, from: { id: 123, is_bot: true } },
    { ...message, forward_origin: { type: "user" } },
    { ...message, reply_to_message: { text: "unbounded history" } },
    { ...message, document: { file_id: "file" } },
    { ...message, text: "x".repeat(4097) },
    { ...message, from: { id: Number.MAX_SAFE_INTEGER + 1, is_bot: false } },
  ])("rejects unsupported context before normalization: %j", (unsupported) => {
    expect(() => parsePrivateTelegramUpdate(body({ update_id: 1, message: unsupported }))).toThrow();
  });

  it.each(["edited_message", "channel_post", "callback_query"])("rejects %s", (kind) => {
    expect(() => parsePrivateTelegramUpdate(body({ update_id: 1, [kind]: message }))).toThrow();
  });

  it("contains malformed JSON and oversized input", () => {
    expect(() => parsePrivateTelegramUpdate(Buffer.from("{secret-canary"))).toThrow("Telegram update is malformed.");
    expect(() => parsePrivateTelegramUpdate(Buffer.alloc(TELEGRAM_MAX_BODY_BYTES + 1))).toThrow("Telegram update is too large.");
  });

  it("requires an exact nonempty configured high-entropy webhook secret", () => {
    const secret = "a".repeat(32);
    expect(() => verifyTelegramSecret(secret, secret)).not.toThrow();
    for (const [expected, supplied] of [["", ""], [secret, ""], [secret, `${secret}x`], [secret, "b".repeat(32)]]) {
      expect(() => verifyTelegramSecret(expected, supplied)).toThrow("Telegram webhook authentication failed.");
    }
  });

  it("bounds streamed bodies even without Content-Length", async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(TELEGRAM_MAX_BODY_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } });
    const request = new Request("https://relay.test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(readBoundedTelegramBody(request)).rejects.toMatchObject({ status: 413 });
  });

  it("reads a bounded request exactly", async () => {
    const bytes = body({ update_id: 1, message });
    await expect(readBoundedTelegramBody(new Request("https://relay.test", { method: "POST", body: bytes }))).resolves.toEqual(bytes);
  });
});
