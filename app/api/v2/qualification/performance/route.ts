import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { currentUser } from "@/lib/auth";
import { db, databasePoolStats, databaseUrl } from "@/lib/db";
import { getV2Dashboard } from "@/lib/v2/dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const processStartedAt = Date.now();
let invocationCount = 0;

function duration(startedAt: number) {
  return Number((performance.now() - startedAt).toFixed(3));
}

function databaseTopology() {
  const hostname = new URL(databaseUrl()).hostname;
  const region = hostname.match(/(?:us|eu|ap|sa|ca|me|af)-(?:central|north|south|east|west)-\d/)?.[0] ?? "unknown";
  return {
    region,
    strategy: hostname.includes("-pooler.") ? "pooled" : "direct",
  };
}

export async function GET() {
  if (process.env.RELAY_DEPLOYMENT_MODE !== "private-preview") {
    return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  }

  const requestStartedAt = performance.now();
  const invocation = ++invocationCount;

  const authStartedAt = performance.now();
  const user = await currentUser();
  const authMs = duration(authStartedAt);
  if (!user || user.role !== "OWNER") {
    return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }

  const queryStartedAt = performance.now();
  await db().execute(sql`select 1`);
  const simpleQueryMs = duration(queryStartedAt);

  const dashboardStartedAt = performance.now();
  const dashboard = await getV2Dashboard(user.accountId);
  const dashboardReadModelMs = duration(dashboardStartedAt);
  const applicationMs = duration(requestStartedAt);

  const serverTiming = [
    `auth;dur=${authMs}`,
    `database;dur=${simpleQueryMs}`,
    `read-model;dur=${dashboardReadModelMs}`,
    `app;dur=${applicationMs}`,
  ].join(", ");

  return Response.json({
    timing: { authMs, simpleQueryMs, dashboardReadModelMs, applicationMs },
    sample: {
      invocation,
      processAgeMs: Date.now() - processStartedAt,
      likelyColdProcess: invocation === 1,
    },
    topology: {
      runtime,
      vercelRegion: process.env.VERCEL_REGION ?? "unknown",
      database: databaseTopology(),
      pool: databasePoolStats(),
    },
    rows: {
      tasks: dashboard.tasks.length,
      approvals: dashboard.approvals.length,
      agents: dashboard.agents.length,
      activity: dashboard.activity.length,
    },
  }, {
    headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": serverTiming,
    },
  });
}
