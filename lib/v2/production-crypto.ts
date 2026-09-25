import { createHash, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, sign, verify } from "node:crypto";
import { configureV2PlatformBindings, type V2PlatformBindings } from "./platform-bindings";
import { requireRuntimeActionsEnabled } from "./deployment";

import { SigningKeyring } from "./evidence/signing-provider";
import type { KeyWrapper } from "./evidence/crypto";

type Environment = Record<string, string | undefined>;

/** Hosted bindings require an explicitly composed provider and key registry.
 * The legacy single-purpose secret adapter is retained only for non-production regression.
 * No key generation, environment mutation, secret logging or development fallback.
 */
export function productionCryptoBindings(environment: Environment, hosted?: { keyring: SigningKeyring; keyWrapper: KeyWrapper }): V2PlatformBindings {
  try {
    const origin = new URL(environment.RELAY_ISSUER_URL ?? "");
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error();
    if (environment.RELAY_CRYPTO_BACKEND === "kms" || environment.RELAY_CRYPTO_BACKEND === "vercel-secret") {
      if (!hosted) throw new Error();
      // Bootstrap and the complete existing federation path require all three.
      for (const purpose of ["evidence", "federation-delivery", "passport"] as const) hosted.keyring.signer(purpose);
      return { signer: hosted.keyring.signer("evidence"), keyResolver: {
        publicKeyForKeyId: async () => undefined,
        publicKeyForPurpose: async (id, purpose) => hosted.keyring.verificationKey(id, purpose)?.publicKeyPem,
      }, federation: { issuer: origin.origin, keyWrapper: hosted.keyWrapper } };
    }
    if (environment.NODE_ENV === "production" || environment.RELAY_DEPLOYMENT_MODE === "production") throw new Error();
    if (environment.RELAY_CRYPTO_BACKEND !== "managed-secret") throw new Error();
    const keyId = environment.RELAY_SIGNING_KEY_ID ?? "";
    const wrappingKeyId = environment.RELAY_WRAPPING_KEY_ID ?? "";
    if (![keyId, wrappingKeyId].every((value) => /^[A-Za-z0-9_.-]{1,128}$/.test(value))) throw new Error();
    const signingKey = createPrivateKey(environment.RELAY_SIGNING_PRIVATE_KEY ?? "");
    const wrappingKey = createPrivateKey(environment.RELAY_WRAPPING_PRIVATE_KEY ?? "");
    if (signingKey.asymmetricKeyType !== "ed25519" || wrappingKey.asymmetricKeyType !== "rsa" || (wrappingKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
    const publicKey = createPublicKey(signingKey);
    const wrappingPublicKey = createPublicKey(wrappingKey);
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const signer = {
      keyId,
      async sign(material: string) { return sign(null, Buffer.from(material), signingKey).toString("base64url"); },
      async verify(material: string, signature: string) { return verify(null, Buffer.from(material), publicKey, Buffer.from(signature, "base64url")); },
      async publicKeyPem() { return publicPem; },
    };
    return {
      signer,
      keyResolver: { publicKeyForKeyId: async (requestedId) => requestedId === keyId ? publicPem : undefined },
      federation: {
        issuer: origin.origin,
        keyWrapper: {
          keyId: wrappingKeyId,
          async wrap(ownerId, key) {
            return publicEncrypt({ key: wrappingPublicKey, oaepHash: "sha256", oaepLabel: createHash("sha256").update(ownerId).digest() }, key).toString("base64url");
          },
          async unwrap(ownerId, wrappedKey) {
            return privateDecrypt({ key: wrappingKey, oaepHash: "sha256", oaepLabel: createHash("sha256").update(ownerId).digest() }, Buffer.from(wrappedKey, "base64url"));
          },
        },
      },
    };
  } catch {
    // Node/OpenSSL parse errors must not echo key material or secret-provider output.
    throw new Error("Relay production cryptographic configuration is unavailable or invalid.");
  }
}

export function initializeProductionFederation(environment: Environment = process.env, hosted?: { keyring: SigningKeyring; keyWrapper: KeyWrapper }) {
  if (environment.RELAY_FEDERATION_ENABLED !== "true") return;
  requireRuntimeActionsEnabled(environment);
  configureV2PlatformBindings(productionCryptoBindings(environment, hosted));
}
