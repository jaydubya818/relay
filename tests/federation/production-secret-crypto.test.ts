import { generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { productionSecretCrypto } from "@/lib/v2/production-secret-crypto";
import { productionCryptoBindings } from "@/lib/v2/production-crypto";
import { seal, unseal } from "@/lib/v2/federation/transport";

const purposes = ["evidence", "federation-delivery", "passport"] as const;
const pairs = purposes.map(() => generateKeyPairSync("ed25519"));
const wrapping = generateKeyPairSync("rsa", { modulusLength: 3072 });
const privatePem = (key: typeof pairs[number]["privateKey"]) => key.export({ type: "pkcs8", format: "pem" }).toString();
const keys = purposes.map((purpose, index) => ({
  keyId: `prod-${purpose}-1`, keyVersion: `prod-${purpose}-1`, purpose, algorithm: "Ed25519",
  state: "ACTIVE", activatedAt: "2026-01-01T00:00:00.000Z",
  privateKeyPem: privatePem(pairs[index].privateKey),
}));
const environment = {
  NODE_ENV: "production", VERCEL: "1", VERCEL_TARGET_ENV: "production",
  RELAY_DEPLOYMENT_MODE: "production", RELAY_CRYPTO_BACKEND: "vercel-secret",
  RELAY_ISSUER_URL: "https://relay.example",
  RELAY_PRODUCTION_SECRET_SIGNING_KEYS_JSON: JSON.stringify(keys),
  RELAY_PRODUCTION_SECRET_WRAPPING_KEY_JSON: JSON.stringify({ keyId: "owner-envelope-1", version: "wrap-1", privateKeyPem: privatePem(wrapping.privateKey) }),
};

describe("production Vercel secret signing", () => {
  it("preserves purpose-specific signing and owner-bound wrapping across cold starts", async () => {
    const first = productionCryptoBindings(environment, productionSecretCrypto(environment));
    const restarted = productionCryptoBindings(environment, productionSecretCrypto(environment));
    for (const purpose of purposes) {
      const signer = first.signer.forPurpose!(purpose);
      const verifier = restarted.signer.forPurpose!(purpose);
      const material = randomBytes(16).toString("hex");
      expect(await verifier.verify(material, await signer.sign(material))).toBe(true);
      expect(signer.keyVersion).toBe(`prod-${purpose}-1`);
    }
    const sealed = await seal("owner-a", { synthetic: true }, first.federation!.keyWrapper);
    expect(await unseal("owner-a", sealed, restarted.federation!.keyWrapper)).toEqual({ synthetic: true });
    await expect(unseal("owner-b", sealed, restarted.federation!.keyWrapper)).rejects.toThrow();
  });

  it.each([
    { VERCEL_TARGET_ENV: "preview" }, { RELAY_DEPLOYMENT_MODE: "private-preview" },
    { RELAY_CRYPTO_BACKEND: "kms" }, { RELAY_QUALIFICATION_MODE: "true" },
    { RELAY_PRODUCTION_SECRET_SIGNING_KEYS_JSON: undefined },
    { RELAY_PRODUCTION_SECRET_WRAPPING_KEY_JSON: undefined },
  ])("fails closed outside explicit production or without secrets: %j", override => {
    expect(() => productionSecretCrypto({ ...environment, ...override })).toThrow("configuration is unavailable or invalid");
  });

  it("rejects missing purposes, mismatched public keys, and weak wrapping keys without echoing secrets", () => {
    expect(() => productionSecretCrypto({ ...environment,
      RELAY_PRODUCTION_SECRET_SIGNING_KEYS_JSON: JSON.stringify(keys.slice(0, 2)) })).toThrow("configuration is unavailable or invalid");
    const wrong = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(() => productionSecretCrypto({ ...environment,
      RELAY_PRODUCTION_SECRET_SIGNING_KEYS_JSON: JSON.stringify([{ ...keys[0], publicKeyPem: wrong }, ...keys.slice(1)]) })).toThrow("configuration is unavailable or invalid");
    const weak = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => productionSecretCrypto({ ...environment,
      RELAY_PRODUCTION_SECRET_WRAPPING_KEY_JSON: JSON.stringify({ keyId: "owner-envelope-1", version: "wrap-1", privateKeyPem: privatePem(weak.privateKey) }) })).toThrow("configuration is unavailable or invalid");
    const secret = "PRIVATE_SECRET_MUST_NOT_APPEAR";
    expect(() => productionSecretCrypto({ ...environment,
      RELAY_PRODUCTION_SECRET_SIGNING_KEYS_JSON: secret })).toThrow("Relay production secret configuration is unavailable or invalid.");
  });
});
