import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { evidenceArtifacts } from "@/lib/db/schema";
import { id, now } from "@/lib/ids";
import { canonicalJson } from "@/lib/v2/contracts";
import { decryptArtifact, encryptArtifact, type KeyWrapper } from "./crypto";
import type { EvidenceObjectClient } from "./object-store";
import { redactForEvidence } from "./redaction";

type Classification = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
type Source = "RELAY_OBSERVED" | "PROVIDER_SIGNED" | "RUNNER_REPORTED";

export async function storeEvidenceArtifact(input: { accountId: string; taskId?: string; actionIntentId?: string; classification: Classification; source: Source; mediaType: string; body: Buffer; retentionUntil?: string }, dependencies: { objects: EvidenceObjectClient; keys: KeyWrapper }) {
  const artifactId = id("evd");
  const objectReference = `accounts/${input.accountId}/evidence/${artifactId}`;
  const encrypted = encryptArtifact(input.body);
  const wrappedKey = await dependencies.keys.wrap(input.accountId, encrypted.key);
  await dependencies.objects.put(objectReference, encrypted.ciphertext);
  try {
    await db().insert(evidenceArtifacts).values({ id: artifactId, accountId: input.accountId, taskId: input.taskId, actionIntentId: input.actionIntentId, classification: input.classification, source: input.source, mediaType: input.mediaType, objectReference, contentHash: `sha256:${createHash("sha256").update(input.body).digest("hex")}`, byteLength: input.body.byteLength, wrappedKey, encryptionMetadata: { algorithm: "AES-256-GCM", iv: encrypted.iv, tag: encrypted.tag, keyWrapper: dependencies.keys.keyId }, createdAt: now(), retentionUntil: input.retentionUntil });
  } catch (error) {
    await dependencies.objects.delete(objectReference).catch(() => undefined);
    throw error;
  }
  return { artifactId, objectReference };
}

export async function storeEvidenceJson(input: Omit<Parameters<typeof storeEvidenceArtifact>[0], "mediaType" | "body"> & { value: unknown }, dependencies: { objects: EvidenceObjectClient; keys: KeyWrapper }) {
  const body = Buffer.from(canonicalJson(redactForEvidence(input.value)));
  return await storeEvidenceArtifact({ ...input, mediaType: "application/json", body }, dependencies);
}

export async function readEvidenceArtifact(accountId: string, artifactId: string, dependencies: { objects: EvidenceObjectClient; keys: KeyWrapper }) {
  const [artifact] = await db().select().from(evidenceArtifacts).where(and(eq(evidenceArtifacts.accountId, accountId), eq(evidenceArtifacts.id, artifactId), isNull(evidenceArtifacts.deletedAt))).limit(1);
  if (!artifact) return undefined;
  const metadata = artifact.encryptionMetadata as { algorithm: string; iv: string; tag: string; keyWrapper: string };
  if (metadata.algorithm !== "AES-256-GCM" || metadata.keyWrapper !== dependencies.keys.keyId) throw new Error("Unsupported evidence encryption metadata.");
  const key = await dependencies.keys.unwrap(accountId, artifact.wrappedKey);
  const ciphertext = await dependencies.objects.get(artifact.objectReference);
  const body = decryptArtifact({ key, ciphertext, iv: metadata.iv, tag: metadata.tag });
  const contentHash = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  if (contentHash !== artifact.contentHash) throw new Error("Evidence content integrity check failed.");
  return { artifact, body };
}

export async function deleteEvidenceArtifact(accountId: string, artifactId: string, dependencies: { objects: EvidenceObjectClient }, requestedAt = now()) {
  const [artifact] = await db().select().from(evidenceArtifacts).where(and(eq(evidenceArtifacts.accountId, accountId), eq(evidenceArtifacts.id, artifactId), isNull(evidenceArtifacts.deletedAt))).limit(1);
  if (!artifact) return false;
  if (artifact.retentionUntil && artifact.retentionUntil > requestedAt) throw new Error("Evidence retention period has not elapsed.");
  await dependencies.objects.delete(artifact.objectReference);
  await db().update(evidenceArtifacts).set({ deletedAt: requestedAt }).where(and(eq(evidenceArtifacts.accountId, accountId), eq(evidenceArtifacts.id, artifactId), isNull(evidenceArtifacts.deletedAt)));
  return true;
}
