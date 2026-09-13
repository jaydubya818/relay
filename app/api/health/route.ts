import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    db().prepare("SELECT 1").get();
    return Response.json({ ok: true, service: "relay", database: "ready", timestamp: new Date().toISOString() });
  } catch {
    return Response.json({ ok: false, service: "relay", database: "unavailable" }, { status: 503 });
  }
}
