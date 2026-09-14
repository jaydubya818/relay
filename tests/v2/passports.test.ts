import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { accountMemberships, principals } from "@/lib/db/schema";
import { id, now } from "@/lib/ids";
import { createLocalEd25519Signer } from "@/lib/v2/evidence";
import { activateV2Agent, countAgentGrants, createV2Agent, downgradeAgentTrust, exportAgentPassport, importAgentPassport, issueAgentPassport, verifyAgentPassport } from "@/lib/v2/passports";
import { authenticateRuntimeClient, registerRuntimeClient, revokeRuntimeClient, verifyRuntimeClient } from "@/lib/v2/runtime-clients";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

const policy = (trustTier: "UNVERIFIED" | "REGISTERED" | "VERIFIED" | "HIGH_ASSURANCE" = "VERIFIED") => ({
  trustTier,
  capabilityEligibility: [{ name: "memory.read", version: "1.0" }],
  policyReferences: ["policy:baseline"], budgetReferences: ["budget:default"],
  allowedEnvironments: { providerIds: ["relay-managed"], minimumAssurance: "managed-equivalent" as const, regions: ["us-west-2"] },
  dataAccess: [{ classification: "internal" as const, resourceTypes: ["memory"] }],
  expiresAt: "2099-01-01T00:00:00.000Z",
});

const issuerRegistry = (publicKeyPem: string) => ({ publicKeyForIssuer: vi.fn(async (issuer: string) => issuer === "https://relay.local" ? publicKeyPem : undefined) });

async function addOwner(accountId: string) {
  const principalId = id("prn");
  await db().insert(principals).values({ id: principalId, type: "SERVICE", displayName: "Import owner", createdAt: now(), updatedAt: now() });
  await db().insert(accountMemberships).values({ accountId, principalId, role: "OWNER", createdAt: now(), updatedAt: now() });
  return principalId;
}

describe("Relay V2 Agent Passport and runtime attribution", () => {
  afterEach(cleanupDatabase);

  it("creates a draft Agent, signs a versioned Passport, and requires it for activation", async () => {
    const { accountId, principalId } = await freshDatabase();
    const signer = createLocalEd25519Signer("passport-key-1");
    const created = await createV2Agent({ accountId, ownerPrincipalId: principalId, name: "Research Agent" }, signer);
    await expect(activateV2Agent({ accountId, agentId: created.agentId, actorPrincipalId: principalId }, signer)).rejects.toMatchObject({ status: 403 });
    const issued = await issueAgentPassport({ accountId, agentId: created.agentId, ownerPrincipalId: principalId, policy: policy() }, signer);
    expect(verifyAgentPassport(issued, await signer.publicKeyPem())).toBe(true);
    await expect(activateV2Agent({ accountId, agentId: created.agentId, actorPrincipalId: principalId }, signer)).resolves.toBeUndefined();
    await expect(exportAgentPassport(accountId, created.agentId)).resolves.toEqual(issued);
  });

  it("quarantines a valid imported Passport without creating grants", async () => {
    const { accountId, principalId } = await freshDatabase();
    const signer = createLocalEd25519Signer("source-key");
    const source = await createV2Agent({ accountId, ownerPrincipalId: principalId, name: "Source" }, signer);
    const bundle = await issueAgentPassport({ accountId, agentId: source.agentId, ownerPrincipalId: principalId, policy: policy() }, signer);
    const destinationAccountId = await secondAccount();
    const destinationOwnerId = await addOwner(destinationAccountId);
    const imported = await importAgentPassport({ accountId: destinationAccountId, importerPrincipalId: destinationOwnerId, name: "Imported", bundle }, issuerRegistry(await signer.publicKeyPem()), signer);
    expect(imported).toMatchObject({ status: "DRAFT", authorityGranted: false });
    await expect(countAgentGrants(destinationAccountId, imported.agentId)).resolves.toBe(0);
    await expect(exportAgentPassport(destinationAccountId, imported.agentId)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects forged imports and cross-account Passport access", async () => {
    const { accountId, principalId } = await freshDatabase();
    const signer = createLocalEd25519Signer();
    const created = await createV2Agent({ accountId, ownerPrincipalId: principalId, name: "Agent" }, signer);
    const bundle = await issueAgentPassport({ accountId, agentId: created.agentId, ownerPrincipalId: principalId, policy: policy() }, signer);
    const otherAccountId = await secondAccount();
    const otherOwnerId = await addOwner(otherAccountId);
    const forged = structuredClone(bundle); forged.passport.trustTier = "HIGH_ASSURANCE";
    await expect(importAgentPassport({ accountId: otherAccountId, importerPrincipalId: otherOwnerId, name: "Forged", bundle: forged }, issuerRegistry(await signer.publicKeyPem()), signer)).rejects.toMatchObject({ status: 401 });
    await expect(exportAgentPassport(otherAccountId, created.agentId)).rejects.toMatchObject({ status: 404 });
  });

  it("increments the revocation epoch and invokes incompatible-work revocation on trust downgrade", async () => {
    const { accountId, principalId } = await freshDatabase();
    const signer = createLocalEd25519Signer();
    const created = await createV2Agent({ accountId, ownerPrincipalId: principalId, name: "Agent" }, signer);
    await issueAgentPassport({ accountId, agentId: created.agentId, ownerPrincipalId: principalId, policy: policy("HIGH_ASSURANCE") }, signer);
    await activateV2Agent({ accountId, agentId: created.agentId, actorPrincipalId: principalId }, signer);
    const revokeIncompatibleWork = vi.fn(async () => undefined);
    await expect(downgradeAgentTrust({ accountId, agentId: created.agentId, actorPrincipalId: principalId, trustTier: "REGISTERED" }, signer, { revokeIncompatibleWork })).resolves.toEqual({ revocationEpoch: 1 });
    expect(revokeIncompatibleWork).toHaveBeenCalledWith({ accountId, agentId: created.agentId, maximumTrustTier: "REGISTERED", revocationEpoch: 1 });
    await expect(exportAgentPassport(accountId, created.agentId)).rejects.toMatchObject({ status: 404 });
  });

  it("keeps product labels self-declared until trusted verification and isolates credentials", async () => {
    const { accountId, principalId } = await freshDatabase();
    const otherAccountId = await secondAccount();
    const signer = createLocalEd25519Signer();
    const registered = await registerRuntimeClient({ accountId, actorPrincipalId: principalId, displayName: "Desktop client", selfDeclaredProduct: "Claude" }, signer);
    await expect(authenticateRuntimeClient(accountId, registered.secret)).resolves.toMatchObject({ selfDeclaredProduct: "Claude", verifiedProduct: null, verificationStatus: "SELF_DECLARED" });
    await expect(authenticateRuntimeClient(otherAccountId, registered.secret)).rejects.toMatchObject({ status: 401 });
    const verifier = { verify: vi.fn(async (proof: string) => ({ product: proof === "trusted-proof" ? "Codex" : "unknown", evidence: { method: "signed-build" } })) };
    await expect(verifyRuntimeClient({ accountId: otherAccountId, actorPrincipalId: principalId, runtimeClientId: registered.runtimeClientId, proof: "trusted-proof" }, verifier, signer)).rejects.toMatchObject({ status: 403 });
    expect(verifier.verify).not.toHaveBeenCalled();
    await expect(verifyRuntimeClient({ accountId, actorPrincipalId: principalId, runtimeClientId: registered.runtimeClientId, proof: "trusted-proof" }, verifier, signer)).resolves.toMatchObject({ verifiedProduct: "Codex", verificationStatus: "VERIFIED" });
    await revokeRuntimeClient({ accountId, actorPrincipalId: principalId, runtimeClientId: registered.runtimeClientId }, signer);
    await expect(authenticateRuntimeClient(accountId, registered.secret)).rejects.toMatchObject({ status: 401 });
  });
});
