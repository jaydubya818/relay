import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return Response.json({ ok: true, service: "relay", database: "ready", datastore: "postgresql", timestamp: new Date().toISOString() });
  } catch {
    return Response.json({ ok: false, service: "relay", database: "unavailable" }, { status: 503 });
  }
}
