import { describe, expect, it } from "vitest";
import { canonicalHash } from "@/lib/v2/contracts";
import { consumerResource, parseConsumerReadRequest } from "@/lib/integrations/consumer";
import { qualification } from "./fixtures";

function request() {
  const input = { schemaVersion: "relay.integration-read.v1" as const,
    scope: { accountId: "acct_synthetic1", ownerPrincipalId: "prn_synthetic1", installationId: "installation_synthetic", agentId: "agt_research01" },
    connectionId: "cnx_synthetic1", toolkit: "github" as const, tool: qualification.slug,
    toolVersion: qualification.version, toolSchemaHash: qualification.schemaHash,
    authorityVersion: 1, ownerPolicyRevision: 1, relayPolicyRevision: "policy-synthetic-1",
    harnessId: "research-fixture", effect: "READ" as const, targetResource: "assigned-issues",
    expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const idempotencyKey = "request-synthetic-1";
  const material = { capability: { name: "github.issue.read", version: "1.0" },
    resource: consumerResource(input, idempotencyKey), parameters: { per_page: 10 } };
  return { ...input, action: { schemaVersion: "relay.action-intent.v2" as const, id: "act_synthetic1",
    accountId: input.scope.accountId, agentId: input.scope.agentId, runtimeClientId: "rtc_synthetic1",
    taskId: "tsk_synthetic1", idempotencyKey, createdAt: new Date().toISOString(),
    ...material, canonicalHash: canonicalHash(material) } };
}

describe("Consumer contract binding, not admission authority", () => {
  it("uses canonical Relay ActionIntent hashing", () => { const value = request(); expect(parseConsumerReadRequest(value)).toEqual(value); });
  it.each(["connectionId", "tool", "toolVersion", "toolSchemaHash", "authorityVersion", "ownerPolicyRevision", "relayPolicyRevision", "harnessId", "targetResource", "expiresAt"] as const)("invalidates changed %s", key => {
    const value = request();
    expect(() => parseConsumerReadRequest({ ...value, [key]: typeof value[key] === "number" ? 2 : `${value[key]}changed` })).toThrow();
  });
  it("invalidates changed owner/agent, arguments and idempotency identity", () => {
    const value = request();
    for (const changed of [
      { ...value, scope: { ...value.scope, ownerPrincipalId: "foreign" } },
      { ...value, scope: { ...value.scope, agentId: "agt_foreign01" } },
      { ...value, action: { ...value.action, parameters: { per_page: 1 } } },
      { ...value, action: { ...value.action, idempotencyKey: "changed-key" } },
    ]) expect(() => parseConsumerReadRequest(changed)).toThrow();
  });
  it("cannot encode external write authority", () => { expect(() => parseConsumerReadRequest({ ...request(), effect: "EXTERNAL_WRITE" })).toThrow(); });
});
