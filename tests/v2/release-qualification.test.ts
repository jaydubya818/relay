import { readFileSync, readdirSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { taskWorkflowDefinition, taskWorkflowInputSchema } from "@/lib/v2/task-workflow";
import { assertV2ReleaseReady, evaluateV2ReleaseGate, REQUIRED_TENANT_BOUNDARIES, SECTION_15_CRITERIA, TENANT_ISOLATION_EVIDENCE, type ReleaseEvidence } from "@/lib/v2/release-qualification";
import { cleanupDatabase, freshDatabase } from "../helpers";

const currentEvidence: ReleaseEvidence = {
  section15: Object.fromEntries(SECTION_15_CRITERIA.map((criterion) => [criterion, [1, 2, 6, 8, 9, 10, 12, 13].includes(criterion) ? "PASS" : criterion === 15 ? "PENDING_INDEPENDENT_REVIEW" : "BLOCKED_EXTERNAL_CONFIGURATION"])) as ReleaseEvidence["section15"],
  tenantIsolation: "PASS",
  credentialNonExposure: "PASS",
  independentSecurityReview: "PENDING_INDEPENDENT_REVIEW",
  penetrationTest: "PENDING_INDEPENDENT_REVIEW",
  providerChannelQualification: "BLOCKED_EXTERNAL_CONFIGURATION",
  operationalDrills: "BLOCKED_EXTERNAL_CONFIGURATION",
  accessibilityAndComprehension: "PENDING_INDEPENDENT_REVIEW",
  signedBuildProvenance: "BLOCKED_EXTERNAL_CONFIGURATION",
  productOwnerDecision: "PENDING_PRODUCT_OWNER",
};

describe("Relay V2 release qualification gate", () => {
  afterEach(cleanupDatabase);

  it("accounts for every required cross-boundary tenant isolation surface", () => {
    expect(TENANT_ISOLATION_EVIDENCE.map(({ boundary }) => boundary).sort()).toEqual([...REQUIRED_TENANT_BOUNDARIES].sort());
    expect(new Set(TENANT_ISOLATION_EVIDENCE.map(({ boundary }) => boundary)).size).toBe(REQUIRED_TENANT_BOUNDARIES.length);
    for (const item of TENANT_ISOLATION_EVIDENCE) {
      const sources = item.testFiles.map((file) => readFileSync(file, "utf8")).join("\n");
      for (const phrase of item.evidencePhrases) expect(sources, `${item.boundary} evidence phrase`).toContain(phrase);
    }
  });

  it("requires an account column on every tenant-owned database table", async () => {
    await freshDatabase();
    const result = await db().execute(sql`
      SELECT table_name,
             bool_or(column_name = 'account_id') AS has_account_id
      FROM information_schema.columns
      WHERE table_schema = 'public'
      GROUP BY table_name
      ORDER BY table_name
    `);
    const intentionallyGlobalOrInherited = new Set([
      "accounts",
      "capabilities",
      "capability_definitions",
      "connector_definitions",
      "execution_provider_definitions",
      "provider_circuit_states",
      "principals",
      "service_clients",
      "connection_credentials",
    ]);
    const missing = result.rows
      .filter((row) => !row.has_account_id && !intentionallyGlobalOrInherited.has(String(row.table_name)))
      .map((row) => row.table_name);
    expect(missing).toEqual([]);
  });

  it("keeps absent cache and search boundaries absent until tenant-safe implementations and tests land", () => {
    const files = readdirSync("lib/v2", { recursive: true }).map(String);
    expect(files.filter((file) => /(^|\/)(cache|search)(\.|\/)/i.test(file))).toEqual([]);
    const dependencies = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(dependencies.dependencies ?? {}).filter((name) => /redis|memcache|elastic|opensearch|algolia|meilisearch/i.test(name))).toEqual([]);
  });

  it("tenant-binds Temporal workflow identities and rejects malformed workflow inputs", () => {
    expect(taskWorkflowDefinition.workflowId("acct_one", "tsk_one")).toBe("relay/acct_one/task/tsk_one");
    expect(taskWorkflowDefinition.workflowId("acct_two", "tsk_one")).not.toBe(taskWorkflowDefinition.workflowId("acct_one", "tsk_one"));
    expect(() => taskWorkflowInputSchema.parse({ schemaVersion: "relay.task-workflow.v1", accountId: "acct_one", taskId: "tsk_one", agentId: "agt_one", eventId: "evt_one", fenceToken: 1, unexpected: "tenant override" })).toThrow();
  });

  it("fails closed while any independent, external, operational, or Product Owner gate is pending", () => {
    const result = evaluateV2ReleaseGate(currentEvidence);
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      "independentSecurityReview:PENDING_INDEPENDENT_REVIEW",
      "providerChannelQualification:BLOCKED_EXTERNAL_CONFIGURATION",
      "productOwnerDecision:PENDING_PRODUCT_OWNER",
    ]));
    expect(() => assertV2ReleaseReady(currentEvidence)).toThrow("release gate is not satisfied");
  });
});
