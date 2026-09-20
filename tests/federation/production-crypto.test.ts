import { generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initializeProductionFederation, productionCryptoBindings } from "@/lib/v2/production-crypto";
import { requireV2PlatformBindings } from "@/lib/v2/platform-bindings";
import { seal, unseal, signDelivery, verifyDelivery } from "@/lib/v2/federation/transport";

const signing = generateKeyPairSync("ed25519");
const wrapping = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = (key: typeof signing.privateKey) => key.export({ type: "pkcs8", format: "pem" }).toString();
const environment = {
  NODE_ENV: "test", RELAY_DEPLOYMENT_MODE: "local", RELAY_V2_ACTIONS_ENABLED: "true", RELAY_FEDERATION_ENABLED: "true",
  RELAY_CRYPTO_BACKEND: "managed-secret", RELAY_SIGNING_KEY_ID: "test-sign-v1", RELAY_WRAPPING_KEY_ID: "test-wrap-v1",
  RELAY_ISSUER_URL: "https://relay.example", RELAY_SIGNING_PRIVATE_KEY: pem(signing.privateKey), RELAY_WRAPPING_PRIVATE_KEY: pem(wrapping.privateKey),
};
const configured = () => { const b = productionCryptoBindings(environment); return { signer: b.signer, ...b.federation! }; };

describe("cryptographic startup and explicit non-production persistent adapter", () => {
  it("rejects exportable managed secrets in either production mode", () => {
    expect(() => productionCryptoBindings({ ...environment, NODE_ENV: "production" })).toThrow();
    expect(() => productionCryptoBindings({ ...environment, RELAY_DEPLOYMENT_MODE: "production" })).toThrow();
  });
  it("rejects KMS startup without an explicitly composed provider", () => {
    expect(() => productionCryptoBindings({ ...environment, RELAY_CRYPTO_BACKEND: "kms" })).toThrow();
  });
  it.each([undefined, "", "false", "TRUE"])("does not initialize disabled federation (%s)", (flag) => {
    expect(() => initializeProductionFederation({ RELAY_FEDERATION_ENABLED: flag })).not.toThrow();
  });
  it("keeps private preview actions disabled even with federation opt-in", () => {
    expect(() => initializeProductionFederation({ ...environment, RELAY_DEPLOYMENT_MODE: "private-preview" })).toThrow("disabled");
  });
  it.each(["RELAY_CRYPTO_BACKEND", "RELAY_SIGNING_KEY_ID", "RELAY_WRAPPING_KEY_ID", "RELAY_SIGNING_PRIVATE_KEY", "RELAY_WRAPPING_PRIVATE_KEY", "RELAY_ISSUER_URL"])("fails closed without %s", (name) => {
    expect(() => productionCryptoBindings({ ...environment, [name]: undefined })).toThrow("configuration is unavailable or invalid");
  });
  it("sanitizes malformed key errors", () => {
    const secret = "SECRET_MUST_NOT_APPEAR";
    try { productionCryptoBindings({ ...environment, RELAY_SIGNING_PRIVATE_KEY: secret }); }
    catch (error) { expect(String(error)).not.toContain(secret); return; }
    throw new Error("Expected rejection");
  });
  it("rejects the wrong signing algorithm", () => {
    expect(() => productionCryptoBindings({ ...environment, RELAY_SIGNING_PRIVATE_KEY: pem(wrapping.privateKey) })).toThrow();
  });
  it("rejects weak wrapping keys", () => {
    const weak = generateKeyPairSync("rsa", { modulusLength: 1024 });
    expect(() => productionCryptoBindings({ ...environment, RELAY_WRAPPING_PRIVATE_KEY: pem(weak.privateKey) })).toThrow();
  });
  it.each(["http://relay.example", "https://user@relay.example", "https://relay.example/path", "https://relay.example?secret=x"])("rejects unsafe issuer %s", (origin) => {
    expect(() => productionCryptoBindings({ ...environment, RELAY_ISSUER_URL: origin })).toThrow();
  });
  it("preserves signing identity and ciphertext across cold starts", async () => {
    const first = configured(); const restarted = configured();
    const signature = await first.signer.sign("request");
    expect(await restarted.signer.verify("request", signature)).toBe(true);
    expect(await restarted.signer.verify("tampered", signature)).toBe(false);
    expect(await restarted.signer.publicKeyPem()).toBe(await first.signer.publicKeyPem());
    const ciphertext = await seal("owner-a", { synthetic: true }, first.keyWrapper);
    expect(await unseal("owner-a", ciphertext, restarted.keyWrapper)).toEqual({ synthetic: true });
    await expect(unseal("owner-b", ciphertext, restarted.keyWrapper)).rejects.toThrow();
  });
  it("never substitutes an unknown key ID and rejects an unavailable wrapping version", async () => {
    const bindings = productionCryptoBindings(environment);
    expect(await bindings.keyResolver.publicKeyForKeyId("unknown")).toBeUndefined();
    expect(await bindings.keyResolver.publicKeyForKeyId(environment.RELAY_SIGNING_KEY_ID)).toContain("PUBLIC KEY");
    const ciphertext = await seal("owner", {}, bindings.federation!.keyWrapper);
    await expect(unseal("owner", { ...ciphertext, keyId: "old" }, bindings.federation!.keyWrapper)).rejects.toThrow("version is unavailable");
  });
  it("installs the configured bindings at startup", async () => {
    initializeProductionFederation(environment);
    expect(requireV2PlatformBindings().signer.keyId).toBe(environment.RELAY_SIGNING_KEY_ID);
  });
  it("uses unchanged signed delivery and replay validation", async () => {
    const b = configured(); const id = randomBytes(8).toString("hex"); const target = "relay://owner-b/agent-b";
    const envelope = { id, protocol: "relay.federation", version: "1.0", caller: { ownerId: "owner-a", agentId: "agent-a" }, target: { ownerId: "owner-b", agentId: "agent-b", address: target }, capability: "message.send", resource: "messages", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), idempotencyKey: id, payload: { body: "synthetic" }, publication: null, authorizationContext: { grantId: "grant", policyDecisionId: "decision", localAuthorizationRequired: true } };
    const token = await signDelivery(envelope, target, id, envelope.expiresAt, b);
    const claims = new Set<string>();
    const input = { issuer: b.issuer, audience: target, trustedPublicKey: async (keyId: string) => keyId === b.signer.keyId ? b.signer.publicKeyPem() : undefined, claimRequest: async (requestId: string) => { if (claims.has(requestId)) return false; claims.add(requestId); return true; } };
    expect((await verifyDelivery(token, input)).id).toBe(id);
    await expect(verifyDelivery(token, input)).rejects.toThrow("already claimed");
    await expect(verifyDelivery(token, { ...input, audience: "relay://other/agent" })).rejects.toThrow();
  });
});
