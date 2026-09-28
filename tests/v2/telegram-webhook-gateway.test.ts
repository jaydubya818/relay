import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { spawn } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error plain ESM qualification script without type declarations
import { createWebhookGateway, isDirectRun, WEBHOOK_PATH } from "../../scripts/qualification/telegram-webhook-gateway.mjs";

let upstream: Server, gateway: Server, base = "";
const received: Array<{ method?: string; url?: string; headers: IncomingHttpHeaders; body: string }> = [];
let responseBody = '{"accepted":true}';
const port = (s: Server) => (s.address() as AddressInfo).port;
beforeAll(async () => {
  upstream = createServer((req, res) => { let body = ""; req.on("data", c => body += c); req.on("end", () => { received.push({ method: req.method, url: req.url, headers: req.headers, body }); res.writeHead(200, { "content-type": "application/json", "set-cookie": "leak=1" }); res.end(responseBody); }); });
  await new Promise<void>(r => upstream.listen(0, "127.0.0.1", r));
  gateway = createWebhookGateway({ upstreamPort: port(upstream) });
  await new Promise<void>(r => gateway.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${port(gateway)}`;
});
afterAll(async () => { await new Promise(r => gateway.close(r)); await new Promise(r => upstream.close(r)); });
const hook = { "content-type": "application/json", "x-telegram-bot-api-secret-token": "fixture-secret" };

describe("Telegram qualification webhook gateway", () => {
  it("preserves the inline typing response through the public gateway", async () => {
    const typing = { accepted: true, method: "sendChatAction", chat_id: "123", action: "typing" };
    responseBody = JSON.stringify(typing);
    try {
      const response = await fetch(`${base}${WEBHOOK_PATH}`, { method: "POST", headers: hook, body: '{"update_id":2}' });
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(await response.json()).toEqual(typing);
    } finally { responseBody = '{"accepted":true}'; }
  });
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

describe("gateway entry point", () => {
  it("recognises direct runs from paths containing spaces and escaped characters", () => {
    const entry = "/Users/q/Library/Application Support/Relay #1/telegram-webhook-gateway.mjs";
    expect(isDirectRun(pathToFileURL(entry).href, entry)).toBe(true);
    expect(isDirectRun(pathToFileURL(entry).href, "/Users/q/other.mjs")).toBe(false);
    expect(isDirectRun(pathToFileURL(entry).href, undefined)).toBe(false);
    // Entry reached through a symlink must match the module's real path.
    const tmp = tmpdir();
    expect(isDirectRun(pathToFileURL(realpathSync(tmp)).href, tmp)).toBe(true);
  });
  it("starts and stops cleanly when launched from a directory with spaces", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "relay gateway space "));
    const script = path.join(dir, "telegram-webhook-gateway.mjs");
    await copyFile(path.resolve("scripts/qualification/telegram-webhook-gateway.mjs"), script);
    try {
      const child = spawn(process.execPath, [script], { env: { ...process.env, GATEWAY_PORT: "0", RELAY_PORT: "9" }, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      const listening = await new Promise<boolean>((done) => {
        const timer = setTimeout(() => done(false), 10000);
        child.stdout.on("data", () => { if (output.includes("gateway_listening")) { clearTimeout(timer); done(true); } });
        child.once("exit", () => { clearTimeout(timer); done(false); });
      });
      expect(listening).toBe(true);
      const exited = new Promise<number | null>((done) => child.once("exit", (code: number | null) => done(code)));
      child.kill("SIGTERM");
      expect(await exited).toBe(0);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 20000);
});
