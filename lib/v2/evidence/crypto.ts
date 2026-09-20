import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes, sign, verify } from "node:crypto";

import type { SigningPurpose } from "./signing-provider";

export interface AuditSigner {
  forPurpose?(purpose: SigningPurpose): AuditSigner;
  readonly keyId: string;
  verificationKeys?(): Array<{ keyId: string; algorithm: "Ed25519"; publicKeyPem: string }>;
  sign(recordHash: string): Promise<string>;
  verify(recordHash: string, signature: string): Promise<boolean>;
  publicKeyPem(): Promise<string>;
}

export function verifyAuditSignature(publicKeyPem: string, recordHash: string, signature: string) {
  return verify(null, Buffer.from(recordHash), publicKeyPem, Buffer.from(signature, "base64url"));
}

export function createLocalEd25519Signer(keyId = "local-ed25519-1"): AuditSigner {
  if (process.env.NODE_ENV === "production") throw new Error("Local evidence signing is unavailable in production; configure a KMS/HSM signer.");
  const pair = generateKeyPairSync("ed25519");
  return {
    keyId,
    async sign(recordHash) { return sign(null, Buffer.from(recordHash), pair.privateKey).toString("base64url"); },
    async verify(recordHash, signature) { return verify(null, Buffer.from(recordHash), pair.publicKey, Buffer.from(signature, "base64url")); },
    async publicKeyPem() { return pair.publicKey.export({ type: "spki", format: "pem" }).toString(); },
  };
}

export interface KeyWrapper {
  readonly keyId: string;
  wrap(accountId: string, plaintextKey: Buffer): Promise<string>;
  unwrap(accountId: string, wrappedKey: string): Promise<Buffer>;
}

export function createLocalRsaKeyWrapper(keyId = "local-rsa-1"): KeyWrapper {
  if (process.env.NODE_ENV === "production") throw new Error("Local evidence key wrapping is unavailable in production; configure KMS.");
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    keyId,
    async wrap(accountId, plaintextKey) {
      const binding = createHash("sha256").update(accountId).digest();
      return publicEncrypt({ key: pair.publicKey, oaepHash: "sha256", oaepLabel: binding }, plaintextKey).toString("base64url");
    },
    async unwrap(accountId, wrappedKey) {
      const binding = createHash("sha256").update(accountId).digest();
      return privateDecrypt({ key: pair.privateKey, oaepHash: "sha256", oaepLabel: binding }, Buffer.from(wrappedKey, "base64url"));
    },
  };
}

export function encryptArtifact(plaintext: Buffer) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { key, ciphertext, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}

export function decryptArtifact(input: { key: Buffer; ciphertext: Buffer; iv: string; tag: string }) {
  const decipher = createDecipheriv("aes-256-gcm", input.key, Buffer.from(input.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(input.tag, "base64url"));
  return Buffer.concat([decipher.update(input.ciphertext), decipher.final()]);
}
