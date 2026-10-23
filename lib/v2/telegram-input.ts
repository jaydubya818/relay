import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { RelayError } from "@/lib/errors";

export const TELEGRAM_MAX_BODY_BYTES = 32 * 1024;
export const TELEGRAM_MAX_TEXT_CHARS = 4096;

const identifier = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const updateSchema = z.object({
  update_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  message: z.object({
    message_id: identifier,
    date: z.number().int().nonnegative(),
    from: z.object({ id: identifier, is_bot: z.literal(false) }),
    chat: z.object({ id: identifier, type: z.literal("private") }),
    text: z.string().min(1).max(TELEGRAM_MAX_TEXT_CHARS),
  }).passthrough(),
}).strict();

export function verifyTelegramSecret(expected: string, supplied: string) {
  // This beta provisions high-entropy secrets, never an empty/default token.
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(expected) || supplied.length > 256) {
    throw new RelayError("INVALID_CREDENTIAL", "Telegram webhook authentication failed.", undefined, 401);
  }
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new RelayError("INVALID_CREDENTIAL", "Telegram webhook authentication failed.", undefined, 401);
  }
}

/** Parse only after webhook verification. No account/Agent authority comes from JSON. */
export function parsePrivateTelegramUpdate(rawBody: Uint8Array) {
  if (rawBody.byteLength > TELEGRAM_MAX_BODY_BYTES) throw new RelayError("INVALID_INPUT", "Telegram update is too large.", undefined, 413);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody)); }
  catch { throw new RelayError("INVALID_INPUT", "Telegram update is malformed.", undefined, 400); }
  const parsed = updateSchema.safeParse(value);
  if (!parsed.success) throw new RelayError("INVALID_INPUT", "Only private direct text messages are supported.", undefined, 400);
  const { message, update_id: updateId } = parsed.data;
  const unsupported = ["forward_origin", "forward_from", "forward_from_chat", "forward_date", "sender_chat", "via_bot", "business_connection_id", "message_thread_id", "reply_to_message", "external_reply", "quote", "document", "photo", "video", "audio", "voice", "caption", "guest_query_id", "guest_bot_caller_user", "guest_bot_caller_chat"];
  if (message.chat.id !== message.from.id || unsupported.some((key) => key in message)) {
    throw new RelayError("INVALID_INPUT", "Only private direct text messages are supported.", undefined, 400);
  }
  return { updateId: String(updateId), messageId: String(message.message_id), userId: String(message.from.id), chatId: String(message.chat.id), sentAtSeconds: message.date, text: message.text };
}

export async function readBoundedTelegramBody(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > TELEGRAM_MAX_BODY_BYTES)) {
    throw new RelayError("INVALID_INPUT", "Telegram update is too large.", undefined, 413);
  }
  if (!request.body) throw new RelayError("INVALID_INPUT", "Telegram update is missing.", undefined, 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + 2000;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const { value, done } = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new RelayError("INVALID_INPUT", "Telegram request timed out.", undefined, 408)); void reader.cancel(); }, Math.max(1, deadline - Date.now())); })]).finally(() => clearTimeout(timer));
      if (done) break;
      total += value.byteLength;
      if (total > TELEGRAM_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RelayError("INVALID_INPUT", "Telegram update is too large.", undefined, 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } finally { reader.releaseLock(); }
}
