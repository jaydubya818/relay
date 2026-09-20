import { createPublicKey, verify } from "node:crypto";
import type { AuditSigner } from "./crypto";

export type SigningPurpose = "evidence" | "federation-delivery" | "passport" | "lease" | "session";
export type SigningKey = {
  keyId: string; keyVersion: string; purpose: SigningPurpose; algorithm: "Ed25519";
  publicKeyPem: string; state: "ACTIVE" | "RETIRED" | "DISABLED" | "REVOKED";
  activatedAt: string; retiredAt?: string; revokedAt?: string;
};
export interface RemoteSigningProvider {
  // Must authenticate a workload, address this exact version, and fail on disabled keys.
  sign(key: Readonly<SigningKey>, material: Uint8Array): Promise<Uint8Array>;
}
const purposes: SigningPurpose[] = ["evidence", "federation-delivery", "passport", "lease", "session"];
function unavailable(): never { throw new Error("Purpose-specific signing key is unavailable."); }

/** Immutable public key registry. Private signing material never enters this class. */
export class SigningKeyring {
  private readonly keys: SigningKey[];
  constructor(keys: SigningKey[], private readonly provider: RemoteSigningProvider, private readonly clock = () => Date.now()) {
    this.keys = keys.map((key) => Object.freeze({ ...key }));
    const ids = new Set<string>(); const versions = new Set<string>(); const publicKeys = new Map<string, SigningPurpose>();
    for (const key of this.keys) {
      if (!key.keyId || key.keyId.length > 128 || !key.keyVersion || ids.has(key.keyId) || versions.has(key.keyVersion) || !purposes.includes(key.purpose) || key.algorithm !== "Ed25519" || !["ACTIVE", "RETIRED", "DISABLED", "REVOKED"].includes(key.state) || !Number.isFinite(Date.parse(key.activatedAt)) || (key.retiredAt !== undefined && (!Number.isFinite(Date.parse(key.retiredAt)) || Date.parse(key.retiredAt) < Date.parse(key.activatedAt)))) unavailable();
      if ((key.state === "REVOKED" && !key.revokedAt) || (key.revokedAt !== undefined && (key.state !== "REVOKED" || !Number.isFinite(Date.parse(key.revokedAt)) || Date.parse(key.revokedAt) < Date.parse(key.activatedAt)))) unavailable();
      const publicKey = createPublicKey(key.publicKeyPem);
      if (publicKey.asymmetricKeyType !== "ed25519") unavailable();
      const fingerprint = publicKey.export({ type: "spki", format: "der" }).toString("hex");
      if (publicKeys.has(fingerprint) && publicKeys.get(fingerprint) !== key.purpose) unavailable();
      publicKeys.set(fingerprint, key.purpose); ids.add(key.keyId); versions.add(key.keyVersion);
    }
    for (const purpose of purposes) if (this.keys.filter((key) => key.purpose === purpose && key.state === "ACTIVE").length > 1) unavailable();
  }
  verificationKey(keyId: string, purpose: SigningPurpose, signedAt?: string): SigningKey | undefined {
    const key = this.keys.find((value) => value.keyId === keyId && value.purpose === purpose);
    if (!key || key.state === "REVOKED") return;
    if (signedAt !== undefined) {
      const timestamp = Date.parse(signedAt);
      if (!Number.isFinite(timestamp) || timestamp < Date.parse(key.activatedAt) || (key.retiredAt !== undefined && timestamp >= Date.parse(key.retiredAt))) return;
    }
    return { ...key };
  }
  verificationKeys(purpose: SigningPurpose) { return this.keys.filter((key) => key.purpose === purpose && key.state !== "REVOKED").map((key) => ({ ...key })); }
  signer(purpose: SigningPurpose): AuditSigner {
    const key = this.keys.find((value) => value.purpose === purpose && value.state === "ACTIVE");
    if (!key) unavailable();
    const assertActive = () => {
      if (this.clock() < Date.parse(key.activatedAt) || (key.retiredAt !== undefined && this.clock() >= Date.parse(key.retiredAt))) unavailable();
    };
    assertActive();
    const thisProvider = this.provider;
    return {
      keyId: key.keyId,
      verificationKeys: () => this.verificationKeys(purpose).map(({ keyId, algorithm, publicKeyPem }) => ({ keyId, algorithm, publicKeyPem })),
      forPurpose: (requested) => this.signer(requested),
      async sign(material) {
        assertActive();
        let signature: Uint8Array;
        try { signature = await thisProvider.sign(key, Buffer.from(material, "utf8")); } catch { return unavailable(); }
        if (signature.byteLength !== 64 || !verify(null, Buffer.from(material, "utf8"), key.publicKeyPem, signature)) unavailable();
        return Buffer.from(signature).toString("base64url");
      },
      async verify(material, signature) { return verify(null, Buffer.from(material), key.publicKeyPem, Buffer.from(signature, "base64url")); },
      async publicKeyPem() { return key.publicKeyPem; },
    };
  }
}

/** Explicit purpose routing; legacy unscoped signers are non-production only. */
export function purposeSigner(signer: AuditSigner, purpose: SigningPurpose): AuditSigner {
  if (signer.forPurpose) return signer.forPurpose(purpose);
  if (process.env.NODE_ENV === "production") unavailable();
  return signer;
}
