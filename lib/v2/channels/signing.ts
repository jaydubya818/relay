import { createPrivateKey, createPublicKey, randomUUID, sign, verify } from "node:crypto";
import { z } from "zod";
import { canonicalHash, canonicalJson } from "@/lib/v2/contracts";
import type { AuditSigner } from "@/lib/v2/evidence/crypto";
import { executionCommandSchema, type Environment, type ExecutionCommand } from "./contracts";

export function configuredEd25519Signer(keyId: string, pem: string): AuditSigner {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(keyId)) throw new Error("Invalid signing key identifier.");
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Ed25519 signing key required.");
  const publicKey = createPublicKey(key);
  return { keyId, sign: async (hash) => sign(null, Buffer.from(hash), key).toString("base64url"),
    verify: async (hash, signature) => verify(null, Buffer.from(hash), publicKey, Buffer.from(signature, "base64url")),
    publicKeyPem: async () => publicKey.export({ type: "spki", format: "pem" }).toString() };
}
const envelopeSchema = z.object({
  domain: z.literal("relay.owner-execution.v1"), environment: z.enum(["development", "preview", "production"]),
  audience: z.string().min(1).max(255), keyId: z.string().min(1).max(80), nonce: z.string().uuid(),
  issuedAt: z.number().int(), expiresAt: z.number().int(), scope: z.literal("owner.run"),
  payloadHash: z.string(), command: executionCommandSchema,
}).strict();
export type SignedExecution = { payload: z.infer<typeof envelopeSchema>; signature: string };
export async function signExecution(command: ExecutionCommand, signer: AuditSigner, environment: Environment, audience: string, time = Date.now()): Promise<SignedExecution> {
  const parsed = executionCommandSchema.parse(command);
  const issuedAt = Math.floor(time / 1000);
  const payload = envelopeSchema.parse({ domain: "relay.owner-execution.v1", environment, audience, keyId: signer.keyId, nonce: randomUUID(), issuedAt, expiresAt: issuedAt + 60, scope: "owner.run", payloadHash: canonicalHash(parsed), command: parsed });
  return { payload, signature: await signer.sign(canonicalHash(payload)) };
}
export function verifyExecution(value: unknown, options: { environment: Environment; audience: string; keys: Record<string, string>; now?: number }) {
  const input = z.object({ payload: envelopeSchema, signature: z.string().min(1).max(128) }).strict().parse(value);
  const { payload, signature } = input;
  const time = Math.floor((options.now ?? Date.now()) / 1000);
  const key = options.keys[payload.keyId];
  if (!key || createPublicKey(key).asymmetricKeyType !== "ed25519" || payload.environment !== options.environment || payload.audience !== options.audience
    || payload.issuedAt > time + 5 || payload.issuedAt < time - 60 || payload.expiresAt <= time || payload.expiresAt - payload.issuedAt !== 60
    || payload.payloadHash !== canonicalHash(payload.command) || !verify(null, Buffer.from(canonicalHash(payload)), key, Buffer.from(signature, "base64url"))) throw new Error("Execution authentication denied.");
  return payload;
}
export function safeWire(value: unknown) { return canonicalJson(JSON.parse(JSON.stringify(value))); }
