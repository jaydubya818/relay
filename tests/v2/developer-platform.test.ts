import { generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { capabilityLeases, controlOutbox, taskCommands } from "@/lib/db/schema";
import { canonicalHash, type ActionIntent } from "@/lib/v2/contracts";
import {
  authenticateDeveloperClient,
  handleV2Mcp,
  MCP_LEGACY_VERSIONS,
  MCP_MODERN_VERSION,
  protectedResourceMetadata,
  submitDurableRuntimeAction,
} from "@/lib/v2/developer-platform";
import { createLocalEd25519Signer } from "@/lib/v2/evidence";
import { createWorkloadBootstrap, exchangeWorkloadBootstrap, issueCapabilityLease } from "@/lib/v2/leases";
import { ingestVerifiedEvent, publishEventRoute } from "@/lib/v2/orchestration";
import { activateV2Agent, createV2Agent, issueAgentPassport } from "@/lib/v2/passports";
import { evaluatePolicy, publishRelaySafetyPolicy, registerCapabilityDefinition } from "@/lib/v2/policy";
import { registerRuntimeClient } from "@/lib/v2/runtime-clients";
import { RelayV2Client } from "../../sdks/typescript/src";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

async function setup(runtimeProduct = "Codex") {
  const identity = await freshDatabase();
  const signer = createLocalEd25519Signer("developer-platform-key");
  const resolver = { publicKeyForKeyId: async (keyId: string) => keyId === signer.keyId ? await signer.publicKeyPem() : undefined };
  const runtime = await registerRuntimeClient({ accountId: identity.accountId, actorPrincipalId: identity.principalId, displayName: `${runtimeProduct} client`, selfDeclaredProduct: runtimeProduct }, signer);
  const capabilityName = "developer.resource.read";
  await registerCapabilityDefinition({ name: capabilityName, version: "1.0", domain: "resource", description: "Developer platform fixture", effectClass: "read", riskClass: "low", resourceType: "document", inputSchema: {}, outputSchema: {}, meteringDimensions: [] }, signer);
  await publishRelaySafetyPolicy({ name: "developer-platform-safety", rules: [{ id: "allow-developer-read", effect: "ALLOW", match: { capability: { name: capabilityName, version: "1.0" } }, reasonCode: "ALLOWED_BY_POLICY" }] }, signer);
  const agent = await createV2Agent({ accountId: identity.accountId, ownerPrincipalId: identity.principalId, name: "Developer Agent" }, signer);
  await issueAgentPassport({ accountId: identity.accountId, agentId: agent.agentId, ownerPrincipalId: identity.principalId, policy: { trustTier: "HIGH_ASSURANCE", capabilityEligibility: [{ name: capabilityName, version: "1.0" }], policyReferences: ["developer-platform-safety"], budgetReferences: [], allowedEnvironments: { providerIds: ["relay-managed"], minimumAssurance: "managed-equivalent" }, dataAccess: [], expiresAt: "2099-01-01T00:00:00.000Z" } }, signer);
  await activateV2Agent({ accountId: identity.accountId, agentId: agent.agentId, actorPrincipalId: identity.principalId }, signer);
  await publishEventRoute({ accountId: identity.accountId, actorPrincipalId: identity.principalId, name: "developer-actions", source: "https://runtime.example/events", eventType: "runtime.task", agentId: agent.agentId }, signer);
  const event = await ingestVerifiedEvent({ envelope: { specversion: "1.0", id: "developer-task", source: "https://runtime.example/events", type: "runtime.task", time: new Date().toISOString(), accountid: identity.accountId, classification: "internal", correlationid: "developer-task", dedupekey: "developer-task", schemaversion: "relay.event.v2", signaturestatus: "unverified", data: {} }, rawBody: new Uint8Array(), headers: {} }, { verify: async () => ({ valid: true }) }, signer);
  const taskId = event.taskIds[0]!;
  const material = { capability: { name: capabilityName, version: "1.0" }, resource: { type: "document", ids: ["doc-1"], attributes: { accountId: identity.accountId } }, parameters: { operation: "read" } };
  const action: ActionIntent = { schemaVersion: "relay.action-intent.v2", id: `act_${crypto.randomUUID().replaceAll("-", "")}`, accountId: identity.accountId, agentId: agent.agentId, runtimeClientId: runtime.runtimeClientId, taskId, ...material, idempotencyKey: crypto.randomUUID(), createdAt: new Date().toISOString(), canonicalHash: canonicalHash(material) };
  await evaluatePolicy({ accountId: identity.accountId, action, resourceResolver: { resolveOwnership: async () => ({ name: "resource.account_id", value: identity.accountId, authoritative: true, observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceRevision: "doc:1" }) } }, signer);
  const pair = generateKeyPairSync("ed25519");
  const bootstrap = await createWorkloadBootstrap({ accountId: identity.accountId, agentId: agent.agentId, runtimeClientId: runtime.runtimeClientId, taskId, providerId: "relay-managed", assurance: "managed-equivalent", audience: "relay-api", publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString() }, signer);
  const workload = await exchangeWorkloadBootstrap({ accountId: identity.accountId, secret: bootstrap.secret, proofSignature: sign(null, Buffer.from(bootstrap.challenge), pair.privateKey).toString("base64url") }, signer);
  const lease = await issueCapabilityLease({ accountId: identity.accountId, action, workloadId: workload.workloadId, workloadIdentityToken: workload.token, audience: "relay-api", maxCalls: 5 }, signer, resolver);
  return { ...identity, signer, resolver, runtime, agent, action, taskId, workload, lease };
}

function submission(fixture: Awaited<ReturnType<typeof setup>>, key: string) {
  return { accountId: fixture.accountId, runtimeCredential: fixture.runtime.secret, expectedResource: "https://relay.example/api/v2", action: fixture.action, leaseToken: fixture.lease.token, expectedAudience: "relay-api", workloadId: fixture.workload.workloadId, idempotencyKey: key };
}

describe("Relay V2 REST, MCP, and runtime interoperability", () => {
  afterEach(cleanupDatabase);

  it("serializes concurrent idempotent submission and durably wakes exactly once", async () => {
    const fixture = await setup();
    const results = await Promise.all(Array.from({ length: 4 }, () => submitDurableRuntimeAction(submission(fixture, "same-runtime-request"), fixture.signer, fixture.resolver)));
    expect(new Set(results.map((result) => result.commandId))).toHaveLength(1);
    expect(results.filter((result) => !result.idempotentReplay)).toHaveLength(1);
    const commands = await db().select().from(taskCommands).where(and(eq(taskCommands.accountId, fixture.accountId), eq(taskCommands.kind, "EXECUTE_ACTION")));
    const outbox = await db().select().from(controlOutbox).where(and(eq(controlOutbox.accountId, fixture.accountId), eq(controlOutbox.type, "task.command.ready")));
    const [lease] = await db().select().from(capabilityLeases).where(and(eq(capabilityLeases.accountId, fixture.accountId), eq(capabilityLeases.id, fixture.lease.leaseId)));
    expect(commands).toHaveLength(1);
    expect(outbox.filter((entry) => entry.aggregateId === commands[0]!.id)).toHaveLength(1);
    expect(lease?.callCount).toBe(1);
  });

  it("fails closed for wrong tenant, OAuth resource/audience, and changed idempotent action", async () => {
    const fixture = await setup();
    await expect(submitDurableRuntimeAction({ ...submission(fixture, "wrong-tenant"), accountId: await secondAccount() }, fixture.signer, fixture.resolver)).rejects.toMatchObject({ status: 401 });
    await expect(submitDurableRuntimeAction({ ...submission(fixture, "wrong-audience"), expectedAudience: "other-api" }, fixture.signer, fixture.resolver)).rejects.toMatchObject({ status: 403 });
    await submitDurableRuntimeAction(submission(fixture, "canonical-reuse"), fixture.signer, fixture.resolver);
    const changedMaterial = { capability: fixture.action.capability, resource: { ...fixture.action.resource, ids: ["doc-2"] }, parameters: fixture.action.parameters };
    const changed = { ...fixture.action, ...changedMaterial, id: `act_${crypto.randomUUID().replaceAll("-", "")}`, canonicalHash: canonicalHash(changedMaterial) };
    await expect(submitDurableRuntimeAction({ ...submission(fixture, "canonical-reuse"), action: changed }, fixture.signer, fixture.resolver)).rejects.toMatchObject({ status: 409 });
    const verifier = { verify: vi.fn(async () => ({ accountId: fixture.accountId, runtimeClientId: fixture.runtime.runtimeClientId, audience: "https://relay.example/api/v2", expiresAt: new Date(Date.now() + 60_000).toISOString() })) };
    await expect(authenticateDeveloperClient({ accountId: fixture.accountId, credential: "oauth-token", expectedResource: "https://relay.example/api/v2", oauthVerifier: verifier })).resolves.toMatchObject({ authentication: "oauth" });
    await expect(authenticateDeveloperClient({ accountId: fixture.accountId, credential: "oauth-token", expectedResource: "https://relay.example/api/v2/mcp", oauthVerifier: verifier })).rejects.toMatchObject({ status: 401 });
  });

  it("supports stateless discovery, legacy negotiation, authenticated listing, and structured MCP results", async () => {
    const fixture = await setup();
    const context = { accountId: fixture.accountId, runtimeCredential: fixture.runtime.secret, expectedResource: "https://relay.example/api/v2/mcp", leaseToken: fixture.lease.token, expectedAudience: "relay-api", workloadId: fixture.workload.workloadId, protocolVersion: MCP_MODERN_VERSION };
    await expect(handleV2Mcp({ jsonrpc: "2.0", id: 1, method: "server/discover" }, { ...context, accountId: "", runtimeCredential: "" }, fixture.signer, fixture.resolver)).resolves.toMatchObject({ stateless: true, protocolVersions: expect.arrayContaining([MCP_MODERN_VERSION]) });
    for (const protocolVersion of MCP_LEGACY_VERSIONS) await expect(handleV2Mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion } }, { ...context, protocolVersion }, fixture.signer, fixture.resolver)).resolves.toMatchObject({ protocolVersion });
    await expect(handleV2Mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, context, fixture.signer, fixture.resolver)).resolves.toMatchObject({ tools: [{ name: "relay_action_submit" }], cacheScope: "private" });
    const called = await handleV2Mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "relay_action_submit", arguments: { action: fixture.action, idempotencyKey: "generic-mcp-call" } } }, context, fixture.signer, fixture.resolver);
    expect(called).toMatchObject({ isError: false, structuredContent: { state: "QUEUED", durable: true } });
    await expect(handleV2Mcp({ jsonrpc: "2.0", id: 4, method: "tools/list" }, { ...context, runtimeCredential: "wrong" }, fixture.signer, fixture.resolver)).rejects.toMatchObject({ status: 401 });
  });

  it("exercises the TypeScript reference client as a Codex integration profile", async () => {
    const fixture = await setup("Codex");
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body));
      const result = await submitDurableRuntimeAction({ accountId: headers.get("x-relay-account-id")!, runtimeCredential: headers.get("authorization")!.slice(7), expectedResource: "https://relay.example/api/v2", action: body.action, leaseToken: headers.get("x-relay-lease")!, expectedAudience: headers.get("x-relay-audience")!, workloadId: headers.get("x-relay-workload-id")!, idempotencyKey: headers.get("idempotency-key")! }, fixture.signer, fixture.resolver);
      return Response.json(result, { status: 202 });
    });
    const client = new RelayV2Client({ baseUrl: "https://relay.example", accountId: fixture.accountId, credential: fixture.runtime.secret, leaseToken: fixture.lease.token, workloadId: fixture.workload.workloadId, runtimeProduct: "codex", fetch });
    await expect(client.submitAction(fixture.action, "codex-reference-client")).resolves.toMatchObject({ state: "QUEUED", durable: true });
  });

  it("publishes parseable schemas, OpenAPI paths, Python client, and protected-resource metadata", async () => {
    for (const path of ["docs/v2/schemas/runtime-action-result.schema.json", "docs/v2/schemas/relay-event-v2.schema.json"]) {
      const source = await readFile(path, "utf8");
      expect(() => JSON.parse(source)).not.toThrow();
    }
    const openapi = await readFile("docs/v2/openapi.yaml", "utf8");
    expect(openapi).toContain("/api/v2/runtime/actions:");
    expect(openapi).toContain("/api/v2/mcp:");
    expect(await readFile("sdks/python/relay_v2/client.py", "utf8")).toContain("class RelayV2Client");
    expect(protectedResourceMetadata("https://relay.example/api/v2/mcp", ["https://identity.relay.example"])).toMatchObject({ resource: "https://relay.example/api/v2/mcp", authorization_servers: ["https://identity.relay.example/"] });
  });
});
