// Dedicated qualification bot webhook control. Emergency stop: `delete`.
//   tsx scripts/qualification/telegram-webhook.ts info   <token-ref>
//   tsx scripts/qualification/telegram-webhook.ts set    <token-ref> <https-tunnel-origin> <webhook-secret-ref>
//   tsx scripts/qualification/telegram-webhook.ts delete <token-ref>
// <ref> = keychain:<service>/<account>. Tokens are read into memory only and are
// never printed, logged or placed in argv/URLs of other processes. getMe must
// return a bot pinned in LOCAL_QUALIFICATION_BOT_USERNAMES before any change.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LOCAL_QUALIFICATION_BOT_USERNAMES } from "@/lib/v2/channels/local-qualification";

const WEBHOOK_PATH = "/api/channels/telegram/webhook";
type Fetch = typeof fetch;

export function parseSecretReference(reference: string | undefined) {
  const match = /^keychain:([A-Za-z0-9._-]{3,100})\/([A-Za-z0-9._-]{3,100})$/.exec(reference ?? "");
  if (!match) throw new Error("Secret reference must be keychain:<service>/<account>.");
  return { service: match[1], account: match[2] };
}
export async function readKeychainSecret(reference: string, run = promisify(execFile)) {
  const { service, account } = parseSecretReference(reference);
  const { stdout } = await run("/usr/bin/security", ["find-generic-password", "-s", service, "-a", account, "-w"], { encoding: "utf8" });
  const value = String(stdout).trim();
  if (!value) throw new Error("Secret reference resolved to an empty value.");
  return value;
}
export function webhookUrl(origin: string | undefined) {
  const u = new URL(origin ?? "");
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) throw new Error("Tunnel origin must be a bare https origin.");
  if (["127.0.0.1", "localhost"].includes(u.hostname)) throw new Error("Telegram cannot reach a loopback origin.");
  return `${u.origin}${WEBHOOK_PATH}`;
}
async function api(token: string, method: string, body: Record<string, unknown> | undefined, fetcher: Fetch) {
  let response: Response;
  // Never surface the underlying error: it could include the request URL, which carries the token.
  try { response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), redirect: "error", signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error(`Telegram ${method} unreachable.`); }
  const json = await response.json().catch(() => ({})) as { ok?: boolean; result?: unknown; description?: string };
  // Telegram error descriptions never contain the token; still, report only the status and flag.
  if (!response.ok || json.ok !== true) throw new Error(`Telegram ${method} failed (HTTP ${response.status}).`);
  return json.result;
}
export async function verifiedBot(token: string, fetcher: Fetch, pins: readonly string[] = LOCAL_QUALIFICATION_BOT_USERNAMES) {
  const me = await api(token, "getMe", undefined, fetcher) as { username?: string; is_bot?: boolean };
  const username = (me.username ?? "").toLowerCase();
  if (!me.is_bot || !username || !pins.map((p) => p.toLowerCase()).includes(username)) throw new Error("Token does not belong to the pinned dedicated qualification bot.");
  return username;
}
export async function webhookCommand(argv: string[], deps: { fetcher: Fetch; secret: (ref: string) => Promise<string>; pins?: readonly string[] }) {
  const [mode, tokenRef, origin, secretRef] = argv;
  const token = await deps.secret(tokenRef);
  const bot = await verifiedBot(token, deps.fetcher, deps.pins);
  if (mode === "delete") { await api(token, "deleteWebhook", { drop_pending_updates: true }, deps.fetcher); }
  else if (mode === "set") {
    const secret = await deps.secret(secretRef);
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) throw new Error("Webhook secret has an invalid format.");
    await api(token, "setWebhook", { url: webhookUrl(origin), secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true, max_connections: 1 }, deps.fetcher);
  } else if (mode !== "info") throw new Error("Usage: info|set|delete");
  const info = await api(token, "getWebhookInfo", undefined, deps.fetcher) as { url?: string; pending_update_count?: number; last_error_date?: number; allowed_updates?: string[] };
  return { event: `webhook_${mode}`, bot, url: info.url || null, pendingUpdates: info.pending_update_count ?? 0, lastErrorAt: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null, allowedUpdates: info.allowed_updates ?? null };
}

if (process.argv[1]?.endsWith("telegram-webhook.ts")) {
  webhookCommand(process.argv.slice(2), { fetcher: fetch, secret: (ref) => readKeychainSecret(ref) })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(JSON.stringify({ event: "webhook_command_failed", message: error instanceof Error ? error.message : "failed" })); process.exitCode = 1; });
}
