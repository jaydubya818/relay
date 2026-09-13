import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "@/lib/agents";
import { databasePoolStats } from "@/lib/db";
import { ingestEvent } from "@/lib/events";
import { handleMcp } from "@/lib/mcp";
import { cleanupDatabase, freshDatabase } from "../helpers";

function percentile(values: number[], value: number) { return values[Math.min(values.length - 1, Math.ceil(values.length * value) - 1)]; }

describe("V1 modest concurrency", () => {
  afterEach(cleanupDatabase);
  it("sustains concurrent Agent, MCP, Activity, event, and inbox work without leaks", async () => {
    const { accountId } = await freshDatabase();
    const agents = await Promise.all(Array.from({ length: 8 }, (_, index) => createAgent(accountId, { name: `Load Agent ${index}`, capabilities: ["memory.read", "memory.write", "agent.inbox.list"] })));
    const latencies: number[] = []; let errors = 0;
    await Promise.all(agents.flatMap((agent, agentIndex) => Array.from({ length: 8 }, async (_, operationIndex) => {
      const started = performance.now();
      try {
        if (operationIndex % 4 === 0) await handleMcp(agent.credential, { method: "tools/list" });
        else if (operationIndex % 4 === 1) await handleMcp(agent.credential, { method: "tools/call", params: { name: "relay_memory_add", arguments: { content: `load-${agentIndex}-${operationIndex}`, scope: "SHARED" } } });
        else if (operationIndex % 4 === 2) await handleMcp(agent.credential, { method: "tools/call", params: { name: "relay_memory_list", arguments: { limit: 10 } } });
        else await handleMcp(agent.credential, { method: "tools/call", params: { name: "relay_agent_inbox_list", arguments: {} } });
      } catch { errors += 1; } finally { latencies.push(performance.now() - started); }
    })));
    await Promise.all(Array.from({ length: 20 }, (_, index) => ingestEvent({ accountId, type: "load.event", source: "load", deliveryId: `delivery-${index}`, occurredAt: new Date().toISOString(), subjectType: "load", subjectId: String(index) }, { agentIds: [agents[index % agents.length].agentId] })));
    await Promise.all(Array.from({ length: 20 }, (_, index) => ingestEvent({ accountId, type: "load.event", source: "load", deliveryId: `delivery-${index}`, occurredAt: new Date().toISOString(), subjectType: "load", subjectId: String(index) }, { agentIds: [agents[index % agents.length].agentId] })));
    latencies.sort((a, b) => a - b);
    const stats = databasePoolStats();
    const result = { operations: latencies.length, p50Ms: percentile(latencies, .5), p95Ms: percentile(latencies, .95), p99Ms: percentile(latencies, .99), errorRate: errors / latencies.length, pool: stats };
    console.info(JSON.stringify({ benchmark: "v1-concurrency", ...result }));
    expect(result.errorRate).toBe(0);
    expect(result.p95Ms).toBeLessThan(1_000);
    expect(stats.total).toBeLessThanOrEqual(stats.max);
    expect(stats.waiting).toBe(0);
  }, 30_000);
});
