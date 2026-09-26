import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, "ready" | "unavailable"> = { database: "unavailable", migrations: "unavailable", events: "unavailable", federation: "unavailable" };
  let federationErrorCode: string | undefined;
  try {
    await db().execute(sql`select 1`);
    checks.database = "ready";
    const migrations = await db().execute(sql`select count(*)::int as count from drizzle.__drizzle_migrations`);
    checks.migrations = Number(migrations.rows[0]?.count ?? 0) > 0 ? "ready" : "unavailable";
    await db().execute(sql`select 1 from events limit 0`);
    checks.events = "ready";
    try {
      await db().execute(sql`select account_id, subject, trust, created_at, updated_at from federation_relationships where account_id = 'readiness' and subject in ('owner', 'agent')`);
      checks.federation = "ready";
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      federationErrorCode = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : undefined;
    }
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "readiness_failed", errorClass: error instanceof Error ? error.name : "UnknownError" }));
  }
  const ok = Object.values(checks).every((status) => status === "ready");
  return Response.json({ ok, service: "relay", checks, ...(federationErrorCode ? { federationErrorCode } : {}), timestamp: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
