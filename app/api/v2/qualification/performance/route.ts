import { performance } from "node:perf_hooks";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { currentUser, parseSession, sessionCookieName } from "@/lib/auth";
import { db, databasePoolStats, databaseUrl } from "@/lib/db";
import { getV2Dashboard } from "@/lib/v2/dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const processStartedAt = Date.now();
let invocationCount = 0;

function duration(startedAt: number) {
  return Number((performance.now() - startedAt).toFixed(3));
}

function percentile(samples: number[], fraction: number) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]!;
}

function distribution(samples: number[]) {
  return {
    samples: samples.length,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
  };
}

function databaseTopology() {
  const hostname = new URL(databaseUrl()).hostname;
  const region = hostname.match(/(?:us|eu|ap|sa|ca|me|af)-(?:central|north|south|east|west)-\d/)?.[0] ?? "unknown";
  return {
    region,
    strategy: hostname.includes("-pooler.") ? "pooled" : "direct",
  };
}

export async function GET(request: Request) {
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

  const requestedSamples = Number(new URL(request.url).searchParams.get("samples") ?? 1);
  const sampleCount = Number.isInteger(requestedSamples) && requestedSamples >= 1 && requestedSamples <= 20 ? requestedSamples : 1;

  const queryStartedAt = performance.now();
  await db().execute(sql`select 1`);
  const simpleQueryMs = duration(queryStartedAt);

  const dashboardStartedAt = performance.now();
  const dashboard = await getV2Dashboard(user.accountId);
  const dashboardReadModelMs = duration(dashboardStartedAt);
  const applicationMs = duration(requestStartedAt);

  let distributions: Record<string, ReturnType<typeof distribution>> | undefined;
  if (sampleCount > 1) {
    const store = await cookies();
    const sessionToken = store.get(sessionCookieName())?.value;
    const authSamples: number[] = [];
    const querySamples: number[] = [];
    const dashboardSamples: number[] = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
      let startedAt = performance.now();
      await parseSession(sessionToken);
      authSamples.push(duration(startedAt));

      startedAt = performance.now();
      await db().execute(sql`select 1`);
      querySamples.push(duration(startedAt));

      startedAt = performance.now();
      await getV2Dashboard(user.accountId);
      dashboardSamples.push(duration(startedAt));
    }
    distributions = {
      auth: distribution(authSamples),
      simpleQuery: distribution(querySamples),
      dashboardReadModel: distribution(dashboardSamples),
    };
  }

  const serverTiming = [
    `auth;dur=${authMs}`,
    `database;dur=${simpleQueryMs}`,
    `read-model;dur=${dashboardReadModelMs}`,
    `app;dur=${applicationMs}`,
  ].join(", ");

  const evidence = {
    timing: { authMs, simpleQueryMs, dashboardReadModelMs, applicationMs },
    distributions,
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
  };
  console.info(JSON.stringify({ event: "v2_preview_performance_qualification", ...evidence }));

  return Response.json(evidence, {
    headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": serverTiming,
    },
  });
}
