import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { testGitHub, testGoogle } from "../lib/connections";
import { closeDatabase, db } from "../lib/db";

type Status = "PASS" | "WARN" | "FAIL";
type Check = { status: Status; name: string; detail: string };
type Row = Record<string, unknown>;

const checks: Check[] = [];
const baseUrl = (process.env.NEXT_PUBLIC_RELAY_URL ?? "http://localhost:3000").replace(/\/$/, "");
const staleHours = Number(process.env.RELAY_SOAK_SESSION_STALE_HOURS ?? 24);

function record(status: Status, name: string, detail: string) {
  checks.push({ status, name, detail });
}

function count(row: Row | undefined, key = "count") {
  return Number(row?.[key] ?? 0);
}

async function httpJson(route: string) {
  const response = await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(5_000) });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  return { response, body };
}

async function checkDatabaseAndMigrations() {
  await db().execute(sql`select 1`);
  record("PASS", "database", "reachable");

  const migrationFiles = (await readdir(path.join(process.cwd(), "drizzle")))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const expectedHashes = new Set(await Promise.all(migrationFiles.map(async (file) => {
    const contents = await readFile(path.join(process.cwd(), "drizzle", file));
    return createHash("sha256").update(contents).digest("hex");
  })));
  const applied = await db().execute(sql`select hash from drizzle.__drizzle_migrations`);
  const appliedHashes = new Set(applied.rows.map((row) => String(row.hash)));
  const missing = [...expectedHashes].filter((hash) => !appliedHashes.has(hash));
  const extra = [...appliedHashes].filter((hash) => !expectedHashes.has(hash));
  if (missing.length === 0 && extra.length === 0) {
    record("PASS", "migrations", `${migrationFiles.length} current`);
  } else {
    record("FAIL", "migrations", `${missing.length} pending, ${extra.length} unexpected`);
  }
}

async function checkHttp() {
  const health = await httpJson("/api/health");
  record(health.response.ok && health.body?.ok === true ? "PASS" : "FAIL", "Relay health", `HTTP ${health.response.status}`);

  const readiness = await httpJson("/api/health/ready");
  record(readiness.response.ok && readiness.body?.ok === true ? "PASS" : "FAIL", "Relay readiness", `HTTP ${readiness.response.status}`);

  const mcp = await httpJson("/mcp");
  record(mcp.response.ok && mcp.body?.endpoint === "/mcp" ? "PASS" : "FAIL", "MCP endpoint", `HTTP ${mcp.response.status}`);

  const providers = await httpJson("/api/health/providers");
  const providerBody = providers.body?.providers as Record<string, { ok?: boolean }> | undefined;
  record(providers.response.ok && providerBody?.sandbox?.ok === true ? "PASS" : "FAIL", "sandbox provider", `HTTP ${providers.response.status}`);
  record(providers.response.ok && providerBody?.browser?.ok === true ? "PASS" : "FAIL", "browser provider", `HTTP ${providers.response.status}`);
}

async function resolveAccountId() {
  if (process.env.RELAY_SOAK_ACCOUNT_ID) return process.env.RELAY_SOAK_ACCOUNT_ID;
  if (process.env.RELAY_ADMIN_EMAIL) {
    const result = await db().execute(sql`select account_id from users where email = ${process.env.RELAY_ADMIN_EMAIL} limit 1`);
    if (result.rows[0]?.account_id) return String(result.rows[0].account_id);
  }
  const result = await db().execute(sql`select id from accounts order by created_at limit 2`);
  if (result.rows.length === 1) return String(result.rows[0].id);
  throw new Error("Set RELAY_SOAK_ACCOUNT_ID when the database has multiple accounts.");
}

async function checkConnector(provider: "GITHUB" | "GOOGLE", accountId: string) {
  try {
    const health = provider === "GITHUB" ? await testGitHub(accountId) : await testGoogle(accountId);
    record(health.ok ? "PASS" : "FAIL", `${provider.toLowerCase()} provider`, health.ok ? "healthy" : "health check failed");
  } catch {
    record("FAIL", `${provider.toLowerCase()} provider`, "not connected, refresh failed, or provider unavailable");
  }
}

async function checkOperationalState() {
  const state = await db().execute(sql`
    select
      (select count(*)::int from sandboxes where status in ('CREATING', 'RUNNING', 'STOPPED') and expires_at <= now()) as stale_sandboxes,
      (select count(*)::int from browser_sessions where status in ('CREATING', 'RUNNING', 'STOPPED') and expires_at <= now()) as stale_browsers,
      (select count(*)::int from agent_sessions where status = 'ACTIVE' and (expires_at <= now() or last_seen_at <= now() - (${staleHours} * interval '1 hour'))) as stale_sessions,
      (select count(*)::int from activities where created_at >= now() - interval '24 hours' and capability = 'agent.authenticate' and status = 'DENIED') as auth_denials,
      (select count(*)::int from activities where created_at >= now() - interval '24 hours' and provider is not null and status = 'FAILED') as provider_failures,
      (select count(*)::int from activities where created_at >= now() - interval '24 hours' and capability <> 'agent.authenticate' and status = 'DENIED') as capability_denials,
      (select count(*)::int from activities where created_at >= now() - interval '24 hours' and action = 'initialize' and status in ('DENIED', 'FAILED')) as mcp_init_failures,
      (select count(*)::int from agent_inbox where created_at >= now() - interval '24 hours' and status = 'FAILED') as failed_inbox,
      (select count(*)::int from agent_credentials where revoked_at >= now() - interval '24 hours') as recent_revocations
  `);
  const row = state.rows[0] as Row;
  const staleSandboxes = count(row, "stale_sandboxes");
  const staleBrowsers = count(row, "stale_browsers");
  const staleSessions = count(row, "stale_sessions");
  record(staleSandboxes === 0 ? "PASS" : "FAIL", "sandbox cleanup", `${staleSandboxes} expired active`);
  record(staleBrowsers === 0 ? "PASS" : "FAIL", "browser cleanup", `${staleBrowsers} expired active`);
  record(staleSessions === 0 ? "PASS" : "FAIL", "Agent sessions", `${staleSessions} obviously stale active`);
  record(staleSandboxes === 0 && staleBrowsers === 0 ? "PASS" : "FAIL", "worker cleanup state", "verify a recent maintenance_cycle log for process liveness");

  for (const [name, key] of [
    ["authentication denials (24h)", "auth_denials"],
    ["provider failures (24h)", "provider_failures"],
    ["capability denials (24h)", "capability_denials"],
    ["MCP initialization failures (24h)", "mcp_init_failures"],
    ["failed inbox events (24h)", "failed_inbox"],
    ["credential revocations (24h)", "recent_revocations"],
  ] as const) {
    const value = count(row, key);
    record(value === 0 ? "PASS" : "WARN", name, String(value));
  }
}

async function main() {
  try {
    await checkDatabaseAndMigrations();
    await checkHttp();
    const accountId = await resolveAccountId();
    await checkConnector("GITHUB", accountId);
    await checkConnector("GOOGLE", accountId);
    await checkOperationalState();
  } catch (error) {
    record("FAIL", "soak check", error instanceof Error ? error.message : "unexpected error");
  } finally {
    await closeDatabase();
  }

  console.log("Relay V1 RC soak check");
  for (const check of checks) console.log(`${check.status.padEnd(4)} ${check.name}: ${check.detail}`);
  const failures = checks.filter((check) => check.status === "FAIL").length;
  const warnings = checks.filter((check) => check.status === "WARN").length;
  console.log(`Result: ${failures === 0 ? "PASS" : "FAIL"} (${failures} failures, ${warnings} warnings)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
