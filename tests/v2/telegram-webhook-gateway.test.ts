import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM qualification script without type declarations
import { createWebhookGateway, WEBHOOK_PATH } from "../../scripts/qualification/telegram-webhook-gateway.mjs";

let upstream: Server, gateway: Server, base = "";
const received: Array<{ method?: string; url?: string; headers: IncomingHttpHeaders; body: string }> = [];
const port = (s: Server) => (s.address() as AddressInfo).port;
beforeAll(async () => {
  upstream = createServer((req, res) => { let body = ""; req.on("data", c => body += c); req.on("end", () => { received.push({ method: req.method, url: req.url, headers: req.headers, body }); res.writeHead(200, { "content-type": "application/json", "set-cookie": "leak=1" }); res.end('{"accepted":true}'); }); });
  await new Promise<void>(r => upstream.listen(0, "127.0.0.1", r));
  gateway = createWebhookGateway({ upstreamPort: port(upstream) });
  await new Promise<void>(r => gateway.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${port(gateway)}`;
});
afterAll(async () => { await new Promise(r => gateway.close(r)); await new Promise(r => upstream.close(r)); });
const hook = { "content-type": "application/json", "x-telegram-bot-api-secret-token": "fixture-secret" };

describe("Telegram qualification webhook gateway", () => {
  it("rejects non-loopback upstreams", () => { expect(() => createWebhookGateway({ upstreamPort: 1, upstreamHost: "10.0.0.1" })).toThrow(); });
  it.each([
    ["GET", "/", {}], ["GET", "/login", {}], ["GET", "/v2/connections", {}], ["POST", "/api/v2/operator/telegram", hook],
    ["GET", "/api/channels/telegram/ready", {}], ["GET", "/api/health", {}], ["POST", "/api/mcp", hook],
    ["GET", WEBHOOK_PATH, hook], ["PUT", WEBHOOK_PATH, hook], ["POST", `${WEBHOOK_PATH}?debug=1`, hook], ["POST", `${WEBHOOK_PATH}/../../v2/connections`, hook],
    ["POST", WEBHOOK_PATH, { "content-type": "application/json" }], ["POST", WEBHOOK_PATH, { "content-type": "text/plain", "x-telegram-bot-api-secret-token": "s" }],
  ] as const)("returns 404 without forwarding %s %s", async (method, path, headers) => {
    const before = received.length;
    const response = await fetch(`${base}${path}`, { method, headers, body: method === "GET" ? undefined : "{}" });
    expect(response.status).toBe(404); expect(received.length).toBe(before);
  });
  it("rejects bodies over 32 KiB", async () => {
    const before = received.length;
    const response = await fetch(`${base}${WEBHOOK_PATH}`, { method: "POST", headers: hook, body: JSON.stringify({ x: "a".repeat(40000) }) });
    expect(response.status).toBe(413); expect(received.length).toBe(before);
  });
  it("forwards the exact webhook with only required headers and strips response cookies", async () => {
    const response = await fetch(`${base}${WEBHOOK_PATH}`, { method: "POST", headers: { ...hook, cookie: "relay_session=owner", authorization: "Bearer x", "x-forwarded-for": "1.2.3.4" }, body: '{"update_id":1}' });
    expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toBeNull();
    const last = received.at(-1)!;
    expect(last).toMatchObject({ method: "POST", url: WEBHOOK_PATH, body: '{"update_id":1}' });
    expect(last.headers["x-telegram-bot-api-secret-token"]).toBe("fixture-secret");
    expect(last.headers.cookie).toBeUndefined(); expect(last.headers.authorization).toBeUndefined(); expect(last.headers["x-forwarded-for"]).toBeUndefined();
  });
});
