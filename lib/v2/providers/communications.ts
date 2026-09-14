import { z } from "zod";
import { CommunicationProviderError, type CommunicationSender } from "@/lib/v2/communications";

export interface CommunicationHttpResponse {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  json(): Promise<unknown>;
}

export interface CommunicationHttpClient {
  request(input: { url: string; method: "POST"; headers: Readonly<Record<string, string>>; body: string }): Promise<CommunicationHttpResponse>;
}

const slackResponse = z.object({ ok: z.boolean(), ts: z.string().optional(), error: z.string().optional() }).passthrough();
const telegramResponse = z.object({ ok: z.boolean(), result: z.object({ message_id: z.number().int() }).optional(), description: z.string().optional(), parameters: z.object({ retry_after: z.number().int().positive().optional() }).optional() }).passthrough();

function retryAfterMs(headers: Readonly<Record<string, string | undefined>>, fallbackSeconds?: number) {
  const seconds = Number(headers["retry-after"] ?? fallbackSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
}

export class SlackTelegramCommunicationSender implements CommunicationSender {
  constructor(private readonly http: CommunicationHttpClient) {}

  async send(input: { provider: "SLACK" | "TELEGRAM"; credential: string; conversationId: string; threadId?: string; text: string; idempotencyKey: string }) {
    return input.provider === "SLACK" ? await this.sendSlack(input) : await this.sendTelegram(input);
  }

  private async sendSlack(input: { credential: string; conversationId: string; threadId?: string; text: string; idempotencyKey: string }) {
    let response: CommunicationHttpResponse;
    try {
      response = await this.http.request({ url: "https://slack.com/api/chat.postMessage", method: "POST", headers: { authorization: `Bearer ${input.credential}`, "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ channel: input.conversationId, text: input.text, ...(input.threadId ? { thread_ts: input.threadId } : {}), client_msg_id: input.idempotencyKey }) });
    } catch { throw new CommunicationProviderError("Slack send timed out.", "TIMEOUT"); }
    if (response.status === 429) throw new CommunicationProviderError("Slack rate limit exceeded.", "RATE_LIMIT", retryAfterMs(response.headers));
    if (response.status >= 500) throw new CommunicationProviderError("Slack server outcome is unknown.", "SERVER");
    const body = slackResponse.parse(await response.json());
    if (response.status >= 400 || !body.ok || !body.ts) throw new CommunicationProviderError(body.error ?? "Slack rejected the message.", "REJECTED");
    return { providerMessageId: body.ts, state: "SENT" as const, receipt: { slackTs: body.ts } };
  }

  private async sendTelegram(input: { credential: string; conversationId: string; threadId?: string; text: string }) {
    let response: CommunicationHttpResponse;
    try {
      response = await this.http.request({ url: `https://api.telegram.org/bot${encodeURIComponent(input.credential)}/sendMessage`, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: input.conversationId, text: input.text, ...(input.threadId ? { message_thread_id: input.threadId } : {}) }) });
    } catch { throw new CommunicationProviderError("Telegram send timed out.", "TIMEOUT"); }
    const body = telegramResponse.parse(await response.json());
    if (response.status === 429) throw new CommunicationProviderError("Telegram rate limit exceeded.", "RATE_LIMIT", retryAfterMs(response.headers, body.parameters?.retry_after));
    if (response.status >= 500) throw new CommunicationProviderError("Telegram server outcome is unknown.", "SERVER");
    if (response.status >= 400 || !body.ok || !body.result) throw new CommunicationProviderError(body.description ?? "Telegram rejected the message.", "REJECTED");
    return { providerMessageId: String(body.result.message_id), state: "SENT" as const, receipt: { telegramMessageId: body.result.message_id } };
  }
}
