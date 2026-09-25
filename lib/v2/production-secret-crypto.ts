import { createHash, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, sign } from "node:crypto";
import { SigningKeyring, type RemoteSigningProvider, type SigningKey } from "./evidence/signing-provider";
import type { KeyWrapper } from "./evidence/crypto";

type SecretSigningKey = Omit<SigningKey, "publicKeyPem"> & { publicKeyPem?: string; privateKeyPem?: string };
type SecretWrappingKey = { keyId: string; version: string; privateKeyPem: string };

/** An explicit, production-only alternative when an external KMS is not available.
 * Private material must be stored in Vercel Sensitive Environment Variables.
 * No key is generated at startup, and missing or mismatched material fails closed.
 */
export function productionSecretCrypto(environment: Record<string, string | undefined>) {
  try {
    if (environment.NODE_ENV !== "production" || environment.VERCEL !== "1" ||
        environment.VERCEL_TARGET_ENV !== "production" || environment.RELAY_DEPLOYMENT_MODE !== "production" ||
        environment.RELAY_CRYPTO_BACKEND !== "vercel-secret" || environment.RELAY_QUALIFICATION_MODE === "true") throw new Error();
    const configured = JSON.parse(environment.RELAY_PRODUCTION_SECRET_SIGNING_KEYS_JSON ?? "") as SecretSigningKey[];
    const wrapping = JSON.parse(environment.RELAY_PRODUCTION_SECRET_WRAPPING_KEY_JSON ?? "") as SecretWrappingKey;
    if (!Array.isArray(configured) || configured.length < 3 || configured.length > 12 ||
        !wrapping || !/^[A-Za-z0-9_.-]{1,128}$/.test(wrapping.keyId) ||
        !/^[A-Za-z0-9_.-]{1,128}$/.test(wrapping.version)) throw new Error();

    const privateKeys = new Map<string, ReturnType<typeof createPrivateKey>>();
    const keys: SigningKey[] = configured.map((key) => {
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(key.keyId) || !/^[A-Za-z0-9_.-]{1,128}$/.test(key.keyVersion)) throw new Error();
      let publicKeyPem = key.publicKeyPem;
      if (key.state === "ACTIVE") {
        if (!key.privateKeyPem) throw new Error();
        const privateKey = createPrivateKey(key.privateKeyPem);
        if (privateKey.asymmetricKeyType !== "ed25519") throw new Error();
        const derived = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
        if (publicKeyPem && createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }).toString("hex") !==
            createPublicKey(derived).export({ type: "spki", format: "der" }).toString("hex")) throw new Error();
        publicKeyPem = derived;
        privateKeys.set(key.keyVersion, privateKey);
      } else if (key.privateKeyPem || !publicKeyPem) throw new Error();
      return { keyId: key.keyId, keyVersion: key.keyVersion, purpose: key.purpose, algorithm: key.algorithm,
        publicKeyPem: publicKeyPem!, state: key.state, activatedAt: key.activatedAt,
        ...(key.retiredAt ? { retiredAt: key.retiredAt } : {}), ...(key.revokedAt ? { revokedAt: key.revokedAt } : {}) };
    });
    const provider: RemoteSigningProvider = {
      async sign(key, material) {
        const privateKey = privateKeys.get(key.keyVersion);
        if (!privateKey || key.state !== "ACTIVE") throw new Error("Signing key unavailable.");
        return sign(null, Buffer.from(material), privateKey);
      },
    };
    const keyring = new SigningKeyring(keys, provider);
    for (const purpose of ["evidence", "federation-delivery", "passport"] as const) keyring.signer(purpose);

    const wrappingPrivate = createPrivateKey(wrapping.privateKeyPem);
    if (wrappingPrivate.asymmetricKeyType !== "rsa" || (wrappingPrivate.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) throw new Error();
    const wrappingPublic = createPublicKey(wrappingPrivate);
    const keyWrapper: KeyWrapper = {
      keyId: wrapping.keyId,
      async wrap(ownerId, key) {
        if (!ownerId || key.length !== 32) throw new Error("Wrapping unavailable.");
        const label = createHash("sha256").update(JSON.stringify([wrapping.version, ownerId])).digest();
        const ciphertext = publicEncrypt({ key: wrappingPublic, oaepHash: "sha256", oaepLabel: label }, key);
        return Buffer.from(JSON.stringify({ version: wrapping.version, ciphertext: ciphertext.toString("base64url") })).toString("base64url");
      },
      async unwrap(ownerId, wrappedKey) {
        try {
          if (!ownerId || wrappedKey.length > 8192) throw new Error();
          const value = JSON.parse(Buffer.from(wrappedKey, "base64url").toString()) as { version?: string; ciphertext?: string };
          if (value.version !== wrapping.version || typeof value.ciphertext !== "string") throw new Error();
          const label = createHash("sha256").update(JSON.stringify([wrapping.version, ownerId])).digest();
          const key = privateDecrypt({ key: wrappingPrivate, oaepHash: "sha256", oaepLabel: label }, Buffer.from(value.ciphertext, "base64url"));
          if (key.length !== 32) throw new Error();
          return key;
        } catch { throw new Error("Wrapping key unavailable."); }
      },
    };
    return { keyring, keyWrapper };
  } catch {
    throw new Error("Relay production secret configuration is unavailable or invalid.");
  }
}
