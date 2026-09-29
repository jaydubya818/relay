import { describe, expect, it } from "vitest";
import { parseSecretReference, readKeychainSecret, webhookCommand, webhookUrl } from "@/scripts/qualification/telegram-webhook";

const TOKEN = "123456:SYNTHETIC-TOKEN-never-real";
const SECRET = "synthetic_webhook_secret_0123456789abcdef";
function telegram(username = "qual_fixture_bot", fail?: string) {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const method = url.split("/").at(-1)!;
    calls.push({ method, body: JSON.parse(String(init.body)) });
    if (method === fail) throw new Error(`network failure for ${url}`);
    const result = method === "getMe" ? { is_bot: true, username } : method === "getWebhookInfo" ? { url: "https://tunnel.example/api/channels/telegram/webhook", pending_update_count: 0, allowed_updates: ["message", "callback_query"] } : true;
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
const deps = (t: ReturnType<typeof telegram>, pins = ["qual_fixture_bot"]) => ({ fetcher: t.fetcher, pins, secret: async (ref: string) => ref.endsWith("/RELAY_TELEGRAM_BOT_TOKEN") ? TOKEN : SECRET });
const TOKEN_REF = "keychain:relay-telegram-qualification/RELAY_TELEGRAM_BOT_TOKEN";
const SECRET_REF = "keychain:relay-telegram-qualification/RELAY_TELEGRAM_WEBHOOK_SECRET";

describe("qualification webhook control", () => {
  it("parses only keychain references", () => {
    expect(parseSecretReference(TOKEN_REF)).toEqual({ service: "relay-telegram-qualification", account: "RELAY_TELEGRAM_BOT_TOKEN" });
    for (const bad of ["", TOKEN, "env:TOKEN", "keychain:a/b", "keychain:svc/acct;rm", "keychain:svc"]) expect(() => parseSecretReference(bad)).toThrow();
  });
  it("reads keychain values without putting the secret in argv", async () => {
    const seen: string[][] = [];
    const value = await readKeychainSecret(TOKEN_REF, (async (_cmd: string, args: string[]) => { seen.push(args); return { stdout: `${TOKEN}\n`, stderr: "" }; }) as never);
    expect(value).toBe(TOKEN); expect(seen[0]).toEqual(["find-generic-password", "-s", "relay-telegram-qualification", "-a", "RELAY_TELEGRAM_BOT_TOKEN", "-w"]);
  });
  it.each(["http://tunnel.example", "https://127.0.0.1:3231", "https://localhost", "https://tunnel.example/path", "https://u:p@tunnel.example", "https://tunnel.example?x=1", "not a url"])("rejects webhook origin %s", (origin) => {
    expect(() => webhookUrl(origin)).toThrow();
  });
  it("sets only the exact webhook path with the secret header and narrow updates", async () => {
    const t = telegram();
    const result = await webhookCommand(["set", TOKEN_REF, "https://abc.ngrok-free.app", SECRET_REF], deps(t));
    const set = t.calls.find((c) => c.method === "setWebhook")!;
    expect(set.body).toEqual({ url: "https://abc.ngrok-free.app/api/channels/telegram/webhook", secret_token: SECRET, allowed_updates: ["message", "callback_query"], drop_pending_updates: true, max_connections: 1 });
    expect(t.calls[0].method).toBe("getMe");
    expect(JSON.stringify(result)).not.toContain(TOKEN); expect(JSON.stringify(result)).not.toContain(SECRET);
  });
  it("deletes the webhook and drops pending updates (emergency stop)", async () => {
    const t = telegram(); await webhookCommand(["delete", TOKEN_REF], deps(t));
    expect(t.calls.map((c) => c.method)).toEqual(["getMe", "deleteWebhook", "getWebhookInfo"]);
    expect(t.calls[1].body).toEqual({ drop_pending_updates: true });
  });
  it.each([["jays_personal_bot", ["qual_fixture_bot"]], ["qual_fixture_bot", []]] as const)("refuses a token for %s when pins are %j", async (username, pins) => {
    const t = telegram(username);
    await expect(webhookCommand(["set", TOKEN_REF, "https://abc.ngrok-free.app", SECRET_REF], deps(t, [...pins]))).rejects.toThrow("pinned dedicated");
    expect(t.calls.map((c) => c.method)).toEqual(["getMe"]);
  });
  it("never surfaces a network error that could contain the token", async () => {
    const t = telegram("qual_fixture_bot", "setWebhook");
    const error = await webhookCommand(["set", TOKEN_REF, "https://abc.ngrok-free.app", SECRET_REF], deps(t)).catch((e: Error) => e);
    expect(String((error as Error).message)).toBe("Telegram setWebhook unreachable."); expect(String(error)).not.toContain(TOKEN);
  });
});
