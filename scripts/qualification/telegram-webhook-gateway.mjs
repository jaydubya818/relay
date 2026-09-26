// Loopback-only ingress gateway for local Telegram qualification.
// A public tunnel must point here, never at Relay itself: this exposes exactly
// POST /api/channels/telegram/webhook (JSON, secret header present, <=32 KiB) and
// returns 404 for everything else, so login, management, readiness, MCP and API
// routes stay unreachable from the internet. Relay still verifies the secret
// in constant time; this gateway only narrows exposure and never logs bodies.
import { createServer, request as httpRequest } from "node:http";

export const WEBHOOK_PATH = "/api/channels/telegram/webhook";
const MAX_BODY = 32 * 1024;

export function createWebhookGateway({ upstreamPort, upstreamHost = "127.0.0.1", log = () => {} }) {
  if (upstreamHost !== "127.0.0.1") throw new Error("Upstream must be loopback.");
  return createServer((req, res) => {
    const deny = (status = 404) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end('{"accepted":false}'); };
    let pathname;
    try { pathname = new URL(req.url ?? "", "http://gateway.invalid").pathname; } catch { return deny(); }
    const allowed = req.method === "POST" && pathname === WEBHOOK_PATH && (req.url ?? "") === WEBHOOK_PATH
      && (req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")
      && typeof req.headers["x-telegram-bot-api-secret-token"] === "string";
    if (!allowed) { log({ event: "gateway_denied", method: req.method }); req.resume(); return deny(); }
    const declared = Number(req.headers["content-length"] ?? "0");
    if (declared > MAX_BODY) { req.resume(); return deny(413); }
    const chunks = []; let size = 0; let aborted = false;
    req.on("data", (chunk) => { size += chunk.length; if (size > MAX_BODY && !aborted) { aborted = true; deny(413); req.destroy(); } else if (!aborted) chunks.push(chunk); });
    req.on("end", () => {
      if (aborted) return;
      const body = Buffer.concat(chunks);
      // Forward only the headers Relay needs; drop cookies, auth and forwarding headers.
      const upstream = httpRequest({ host: upstreamHost, port: upstreamPort, path: WEBHOOK_PATH, method: "POST", headers: {
        "content-type": "application/json", "content-length": String(body.length),
        "x-telegram-bot-api-secret-token": req.headers["x-telegram-bot-api-secret-token"], host: `127.0.0.1:${upstreamPort}` } }, (response) => {
        res.writeHead(response.statusCode ?? 502, { "content-type": "application/json", "cache-control": "no-store" });
        response.pipe(res);
      });
      upstream.setTimeout(15000, () => upstream.destroy());
      upstream.on("error", () => { if (!res.headersSent) deny(502); else res.end(); });
      upstream.end(body);
      log({ event: "gateway_forwarded", bytes: body.length });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const listenPort = Number(process.env.GATEWAY_PORT ?? "3231"), upstreamPort = Number(process.env.RELAY_PORT ?? "3230");
  const server = createWebhookGateway({ upstreamPort, log: (entry) => console.log(JSON.stringify({ at: new Date().toISOString(), ...entry })) });
  server.listen(listenPort, "127.0.0.1", () => console.log(JSON.stringify({ event: "gateway_listening", host: "127.0.0.1", port: listenPort, upstreamPort })));
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
}
