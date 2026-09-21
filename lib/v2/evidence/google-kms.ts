import { consumeApplicationSigningAdmission } from './qualification-admission';
import type { RemoteSigningProvider, SigningKey } from "./signing-provider";

export function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Only an explicit short-lived workload token source; never ADC/private-key fallback. */
export class GoogleKmsEd25519Provider implements RemoteSigningProvider {
  constructor(private readonly versions: ReadonlySet<string>, private readonly workloadToken: () => Promise<string>, private readonly request: typeof fetch = fetch) {}
  async sign(key: Readonly<SigningKey>, material: Uint8Array): Promise<Uint8Array> {
    try {
      consumeApplicationSigningAdmission(key,material);
      if (key.algorithm !== "Ed25519" || key.state !== "ACTIVE" || !this.versions.has(key.keyVersion) || !/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+\/cryptoKeyVersions\/[1-9][0-9]*$/.test(key.keyVersion)) throw new Error();
      const token = await this.workloadToken();
      if (!token || /\s/.test(token)) throw new Error();
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const url = `https://cloudkms.googleapis.com/v1/${key.keyVersion}`;
      // Every sign rechecks configured version metadata. KMS itself must also
      // reject disable/revoke races. No retry or alternative version is selected.
      const metadata = await this.request(url, { headers, redirect: "error", signal: AbortSignal.timeout(5000) });
      if (!metadata.ok) throw new Error();
      const version = await metadata.json() as Record<string, unknown>;
      if (version.name !== key.keyVersion || version.state !== "ENABLED" || version.algorithm !== "EC_SIGN_ED25519" || version.protectionLevel !== "SOFTWARE") throw new Error();
      const response = await this.request(`${url}:asymmetricSign`, {
        method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(5000),
        body: JSON.stringify({ data: Buffer.from(material).toString("base64"), dataCrc32c: String(crc32c(material)) }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json() as Record<string, unknown>;
      if (result.name !== key.keyVersion || result.verifiedDataCrc32c !== true || result.protectionLevel !== "SOFTWARE" || typeof result.signature !== "string") throw new Error();
      const signature = Buffer.from(result.signature, "base64");
      if (signature.length !== 64 || String(crc32c(signature)) !== String(result.signatureCrc32c)) throw new Error();
      return signature;
    } catch {
      // Provider failures must not surface bearer credentials or signing material.
      throw new Error("Google KMS signing is unavailable.");
    }
  }
}
