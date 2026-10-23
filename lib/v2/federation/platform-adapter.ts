import { z } from "zod";
import { entrySchema, knowledgeResponseSchema, recordSchema, type KnowledgeResponse } from "./contracts";

const queryEnvelopeSchema = z.object({
  id: z.string(), capability: z.literal("knowledge.query"),
  payload: z.object({ mode: z.enum(["RECORD_RETRIEVAL", "ANSWER_QUERY"]), query: z.string().max(4000), requestedTypes: z.array(z.string()), topics: z.array(z.string()), maxRecords: z.number().int().min(1).max(50) }).strict(),
  publication: z.object({ viewId: z.string(), version: z.number().int().positive(), visibility: z.enum(["SHARED", "UNLISTED", "PUBLIC"]), provenancePolicy: z.literal("SOURCE_REFERENCES_REQUIRED"), entries: z.array(entrySchema).max(50) }).strict(),
}).passthrough();

/** Use only AFTER verifying Relay authenticity and independently accepting locally.
 * The reader must be a publication-only projection with its own eligibility/deletion
 * checks, never a canonical knowledge search or an unrestricted agent runtime.
 */
export interface PublishedProjectionReader {
  readPublished(input: { viewId: string; version: number; reference: string; revision: string }): Promise<z.infer<typeof recordSchema> | undefined>;
}
export async function answerPublishedQuery(envelope: unknown, reader: PublishedProjectionReader, synthesize?: (input: { query: string; records: readonly z.infer<typeof recordSchema>[] }) => Promise<string>): Promise<KnowledgeResponse> {
  const request = queryEnvelopeSchema.parse(envelope);
  if (request.publication.entries.length > request.payload.maxRecords) throw new Error("Projection exceeds request limit.");
  const records: z.infer<typeof recordSchema>[] = [];
  for (const entry of request.publication.entries) {
    const value = await reader.readPublished({ viewId: request.publication.viewId, version: request.publication.version, reference: entry.reference, revision: entry.revision });
    if (!value) continue; // Local deletion or authorization can always narrow Relay's projection.
    const record = recordSchema.parse(value);
    if (record.reference !== entry.reference || record.revision !== entry.revision || record.recordType !== entry.recordType) throw new Error("Projection reader returned a different record.");
    records.push(record);
  }
  if (request.payload.mode === "RECORD_RETRIEVAL") return knowledgeResponseSchema.parse({ kind: "OWNER_PUBLISHED_KNOWLEDGE", publicationVersion: request.publication.version, records });
  if (!synthesize) throw new Error("This platform does not support answer synthesis.");
  return knowledgeResponseSchema.parse({ kind: "PUBLISHER_AGENT_SYNTHESIS", publicationVersion: request.publication.version, records, answer: await synthesize({ query: request.payload.query, records }) });
}
