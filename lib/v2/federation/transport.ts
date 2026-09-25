import { purposeSigner } from "@/lib/v2/evidence/signing-provider";
import { createPublicKey } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "@/lib/v2/contracts";
import { decryptArtifact, encryptArtifact, verifyAuditSignature, type AuditSigner, type KeyWrapper } from "@/lib/v2/evidence/crypto";
import { RelayError } from "@/lib/errors";
import { submissionSchema } from "./contracts";
import { decodeCanonicalSegment, federationSigningEnvelope, federationV2Header, federationV2HeaderSchema } from "./signing-envelope";

export const MAX_FEDERATION_TOKEN_CHARS = 256 * 1024;
// Ed25519 produces exactly 64 bytes, i.e. 86 unpadded base64url characters.
export const MAX_FEDERATION_SIGNING_BYTES = MAX_FEDERATION_TOKEN_CHARS - 1 - 86;

const envelopeSchema = z.object({
  id: z.string().min(1).max(255), protocol: z.literal("relay.federation"), version: z.literal("1.0"),
  caller: z.object({ ownerId: z.string(), agentId: z.string() }).strict(),
  target: z.object({ ownerId: z.string(), agentId: z.string(), address: z.string() }).strict(),
  capability: z.enum(["knowledge.query", "message.send", "work.request", "artifact.share"]), resource: z.string(),
  createdAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }), idempotencyKey: z.string(),
  conversationId: z.string().optional(), payload: z.unknown(), publication: z.unknown(),
  authorizationContext: z.object({ grantId: z.string(), policyDecisionId: z.string(), localAuthorizationRequired: z.literal(true) }).strict(),
}).strict();

export interface FederationBindings {
  signer: AuditSigner;
  keyWrapper: KeyWrapper;
  issuer: string;
}
const ciphertextSchema = z.object({ ciphertext: z.string(), iv: z.string(), tag: z.string(), wrappedKey: z.string(), keyId: z.string() }).strict();
export async function seal(ownerId: string, value: unknown, wrapper: KeyWrapper) {
  const plaintext = Buffer.from(canonicalJson(value));
  if (plaintext.length > 128 * 1024) throw new RelayError("INVALID_INPUT", "Federation delivery exceeds 128 KiB.", undefined, 413);
  const encrypted = encryptArtifact(plaintext);
  return { ciphertext: encrypted.ciphertext.toString("base64url"), iv: encrypted.iv, tag: encrypted.tag, wrappedKey: await wrapper.wrap(ownerId, encrypted.key), keyId: wrapper.keyId };
}
export async function unseal(ownerId: string, value: unknown, wrapper: KeyWrapper): Promise<unknown> {
  const encrypted = ciphertextSchema.parse(value);
  if (encrypted.keyId !== wrapper.keyId) throw new RelayError("CONNECTION_REQUIRED", "Delivery key version is unavailable.", undefined, 503);
  return JSON.parse(decryptArtifact({ ...encrypted, ciphertext: Buffer.from(encrypted.ciphertext, "base64url"), key: await wrapper.unwrap(ownerId, encrypted.wrappedKey) }).toString());
}

// Relay compact V2 assertion. Unlike legacy JWS, Ed25519 signs a small digest
// envelope. Both local and remote providers receive exactly the same bytes.
export async function signDelivery(envelope: Record<string, unknown>, audience: string, requestId: string, expiresAt: string, bindings: FederationBindings) {
  const signer = purposeSigner(bindings.signer, "federation-delivery");
  const keyVersion = signer.keyVersion ?? signer.keyId;
  const header = Buffer.from(canonicalJson(federationV2Header(signer.keyId, keyVersion))).toString("base64url");
  const payload = Buffer.from(canonicalJson({ iss: bindings.issuer, aud: audience, jti: requestId, iat: Math.floor(Date.now() / 1000), exp: Math.min(Math.floor(Date.parse(expiresAt) / 1000), Math.floor(Date.now() / 1000) + 60), envelope })).toString("base64url");
  const material = `${header}.${payload}`;
  if (Buffer.byteLength(material, "utf8") > MAX_FEDERATION_SIGNING_BYTES) {
    throw new RelayError("INVALID_INPUT", "Federation delivery exceeds the canonical 256 KiB token limit.", undefined, 413);
  }
  const signature = await signer.sign(federationSigningEnvelope(material, { id: signer.keyId, version: keyVersion }));
  if (!/^[A-Za-z0-9_-]{86}$/.test(signature)) throw new Error("Invalid Ed25519 signature encoding.");
  return `${material}.${signature}`;
}
export async function verifyDelivery(token: string, input: {
  issuer: string; audience: string;
  // Version-aware registries must resolve this exact immutable binding. Existing
  // ID-only registries are valid only when every version has a distinct key ID.
  trustedPublicKey(keyId: string, keyVersion?: string): Promise<string | undefined>;
  // MUST be atomic and durable, called only after signature and claims validation.
  claimRequest(requestId: string, expiresAt: number): Promise<boolean>;
}) {
  if (token.length > MAX_FEDERATION_TOKEN_CHARS) throw new Error("Oversized federation delivery.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWS.");
  const rawHeader = JSON.parse(Buffer.from(parts[0], "base64url").toString());
  let signingMaterial = `${parts[0]}.${parts[1]}`;
  let payload: unknown;
  let key: string | undefined;
  if (rawHeader?.typ === "relay-federation-v2") {
    const header = federationV2HeaderSchema.parse(decodeCanonicalSegment(parts[0]));
    payload = decodeCanonicalSegment(parts[1]);
    key = await input.trustedPublicKey(header.kid, header.keyVersion);
    signingMaterial = federationSigningEnvelope(signingMaterial, { id: header.kid, version: header.keyVersion });
    if (!/^[A-Za-z0-9_-]{86}$/.test(parts[2]) || Buffer.from(parts[2], "base64url").toString("base64url") !== parts[2]) throw new Error("Invalid Ed25519 signature encoding.");
    if (key && createPublicKey(key).asymmetricKeyType !== "ed25519") throw new Error("Invalid signing key algorithm.");
  } else {
    // Explicit legacy format only. A malformed V2 assertion never retries V1.
    const header = z.object({ alg: z.literal("EdDSA"), typ: z.literal("relay-federation+jwt"), kid: z.string().min(1).max(255) }).strict().parse(rawHeader);
    key = await input.trustedPublicKey(header.kid);
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  }
  if (!key || !verifyAuditSignature(key, signingMaterial, parts[2])) throw new Error("Invalid Relay signature.");
  const claims = z.object({ iss: z.string(), aud: z.string(), jti: z.string(), iat: z.number().int(), exp: z.number().int(), envelope: z.record(z.unknown()) }).strict().parse(payload);
  const current = Math.floor(Date.now() / 1000);
  if (claims.iss !== input.issuer || claims.aud !== input.audience || claims.iat > current + 5 || claims.exp <= current || claims.exp - claims.iat > 60 || claims.envelope.id !== claims.jti) throw new Error("Relay claims are invalid or expired.");
  const envelope = envelopeSchema.parse(claims.envelope);
  const requestExpiry = Math.floor(Date.parse(envelope.expiresAt) / 1000);
  if (envelope.target.address !== input.audience || requestExpiry <= current || claims.exp > requestExpiry || Date.parse(envelope.createdAt) > Date.now() + 5000 || Date.parse(envelope.expiresAt) - Date.parse(envelope.createdAt) > 86400000) throw new Error("Invalid envelope lifetime or target.");
  submissionSchema.parse({ target: envelope.target.address, resource: envelope.resource, capability: envelope.capability, idempotencyKey: envelope.idempotencyKey, expiresAt: envelope.expiresAt, payload: envelope.payload, ...(envelope.conversationId ? { conversationId: envelope.conversationId } : {}) });
  // Deduplication outlives individual 60-second delivery assertions and all retries.
  if (!(await input.claimRequest(claims.jti, requestExpiry))) throw new Error("Request already claimed; return the platform's persisted receipt without executing again.");
  return envelope;
}
