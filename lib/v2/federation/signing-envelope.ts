import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "@/lib/v2/contracts";

export const FEDERATION_SIGNING_VERSION = 2;
export const MAX_SIGNING_ENVELOPE_BYTES = 8192;
const identity = z.object({ id: z.string().min(1).max(255), version: z.string().min(1).max(512) }).strict();
export const signingEnvelopeSchema = z.object({
  protocol: z.literal("relay.federation"),
  version: z.literal(FEDERATION_SIGNING_VERSION),
  purpose: z.literal("federation-delivery"),
  payloadDigestAlgorithm: z.literal("SHA-256"),
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  signingAlgorithm: z.literal("Ed25519"),
  keyIdentity: identity,
}).strict();

/** Pure Ed25519 signs this domain-separated envelope, not an Ed25519ph digest.
 * Hash the exact canonical compact representation; never parsed/re-serialized data.
 */
export function federationSigningEnvelope(material: string, keyIdentity: z.infer<typeof identity>) {
  const envelope = signingEnvelopeSchema.parse({
    protocol: "relay.federation", version: FEDERATION_SIGNING_VERSION,
    purpose: "federation-delivery", payloadDigestAlgorithm: "SHA-256",
    payloadDigest: createHash("sha256").update(material, "utf8").digest("hex"),
    signingAlgorithm: "Ed25519", keyIdentity,
  });
  const canonical = canonicalJson(envelope);
  if (Buffer.byteLength(canonical) > MAX_SIGNING_ENVELOPE_BYTES) throw new Error("Signing envelope exceeds its bound.");
  return canonical;
}

export const federationV2HeaderSchema = z.object({
  alg: z.literal("Ed25519"), typ: z.literal("relay-federation-v2"),
  kid: z.string().min(1).max(255), keyVersion: z.string().min(1).max(512),
}).strict();

export function federationV2Header(keyId: string, keyVersion: string) {
  return federationV2HeaderSchema.parse({ alg: "Ed25519", typ: "relay-federation-v2", kid: keyId, keyVersion });
}

/** Reject alternate encodings, whitespace, duplicate properties and lossy UTF-8.
 * Canonicalization here validates bytes; hashing still uses the received segments.
 */
export function decodeCanonicalSegment(segment: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error("Noncanonical token encoding.");
  const bytes = Buffer.from(segment, "base64url");
  if (bytes.toString("base64url") !== segment) throw new Error("Noncanonical token encoding.");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!Buffer.from(canonicalJson(value)).equals(bytes)) throw new Error("Noncanonical token JSON.");
  return value;
}
