import { describe, expect, it } from "vitest";
import { actionIntentSchema, approvalTransitions, canTransition, canonicalHash, canonicalJson, capabilityLeaseClaimsSchema, leaseTransitions, relayEventSchema, schemas, taskTransitions } from "@/lib/v2/contracts";

const stamp = "2026-09-13T20:00:00.000Z";

describe("Relay V2 contracts", () => {
  it("canonicalizes equivalent action material identically", () => {
    const first = { resource: { ids: ["b", "a"], type: "document" }, parameters: { title: "T", count: 1 } };
    const second = { parameters: { count: 1, title: "T" }, resource: { type: "document", ids: ["b", "a"] } };
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(canonicalHash(first)).toBe(canonicalHash(second));
    expect(canonicalHash(first)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
  it("rejects values that cannot be represented safely", () => {
    expect(() => canonicalJson({ amount: Number.NaN })).toThrow("non-finite");
    expect(() => canonicalJson({ value: undefined })).toThrow("undefined");
    expect(() => canonicalJson(new Date())).toThrow("plain object");
  });
  it("validates an immutable action intent envelope", () => {
    const material = { capability: { name: "communications.message.send", version: "1.0" }, resource: { type: "thread", ids: ["thread-1"] }, parameters: { body: "Approved body" } };
    const parsed = actionIntentSchema.parse({ schemaVersion: "relay.action-intent.v2", id: "act_12345678", accountId: "acct_12345678", agentId: "agt_12345678", runtimeClientId: "rtc_12345678", taskId: "tsk_12345678", ...material, idempotencyKey: "stable-key", createdAt: stamp, canonicalHash: canonicalHash(material) });
    expect(parsed.capability.name).toBe("communications.message.send");
    expect(() => actionIntentSchema.parse({ ...parsed, accountId: "other" })).toThrow();
    expect(() => actionIntentSchema.parse({ ...parsed, unexpected: true })).toThrow();
  });
  it("requires Relay event routing context", () => {
    const event = { specversion: "1.0", id: "provider-1", source: "https://slack.com/events", type: "communication.message.received", time: stamp, accountid: "acct_12345678", classification: "internal", correlationid: "corr-1", dedupekey: "slack:provider-1", schemaversion: "relay.event.v2", signaturestatus: "verified" };
    expect(relayEventSchema.parse(event).signaturestatus).toBe("verified");
    expect(() => relayEventSchema.parse({ ...event, accountId: event.accountid })).toThrow();
  });
  it("validates lease time, workload, policy, and environment bindings", () => {
    const claims = { iss: "https://relay.example", sub: "agt_12345678", aud: "relay-runner", jti: "lse_12345678", iat: 100, nbf: 100, exp: 200, accountId: "acct_12345678", taskId: "tsk_12345678", runtimeClientId: "rtc_12345678", workloadId: "wkl_12345678", capability: { name: "computer.screen.capture", version: "1.0" }, resource: { type: "computer", ids: ["cmp_12345678"] }, maxCalls: 1, policyDecisionId: "dec_12345678", policyRevision: "policy-7", environment: { providerIds: ["browserbase"], minimumAssurance: "attested" }, delegationChain: [], revocationEpoch: 3 };
    expect(capabilityLeaseClaimsSchema.parse(claims).exp).toBe(200);
    expect(() => capabilityLeaseClaimsSchema.parse({ ...claims, exp: 99 })).toThrow("exp must follow nbf");
  });
  it("defines closed terminal states and safe resume paths", () => {
    expect(canTransition(taskTransitions, "RUNNING", "WAITING_APPROVAL")).toBe(true);
    expect(canTransition(taskTransitions, "SUCCEEDED", "RUNNING")).toBe(false);
    expect(canTransition(approvalTransitions, "APPROVED", "REVOKED")).toBe(true);
    expect(canTransition(approvalTransitions, "DENIED", "APPROVED")).toBe(false);
    expect(canTransition(leaseTransitions, "ACTIVE", "EXPIRED")).toBe(true);
    expect(canTransition(leaseTransitions, "EXPIRED", "ACTIVE")).toBe(false);
  });
  it("publishes JSON Schema 2020-12 identifiers", () => {
    expect(Object.values(schemas).every((schema) => schema.$schema.endsWith("2020-12/schema"))).toBe(true);
    expect(new Set(Object.values(schemas).map((schema) => schema.$id)).size).toBe(3);
  });
});

