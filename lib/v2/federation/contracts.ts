import { z } from "zod";

export const capabilitySchema = z.enum(["knowledge.query", "message.send", "message.receive", "artifact.share", "artifact.receive", "work.request"]);
export const availabilitySchema = z.enum(["ONLINE", "OFFLINE", "DEGRADED", "PAUSED", "REVOKED", "UNKNOWN"]);
export const visibilitySchema = z.enum(["PRIVATE", "SHARED", "UNLISTED", "PUBLIC"]);
export const publicationStatusSchema = z.enum(["ACTIVE", "PAUSED", "REVOKED", "EXPIRED"]);
const reference = z.string().min(1).max(255);
const timestamp = z.string().datetime({ offset: true });
const topics = z.array(z.string().min(1).max(100)).max(30);
export const registrationSchema = z.object({
  agentId: reference, platform: reference, endpoint: z.string().url().max(2048).optional(),
  capabilities: z.array(z.object({ name: capabilitySchema, version: z.literal("1.0") }).strict()).max(6),
  discovery: z.enum(["HIDDEN", "CONTACTS_ONLY", "NETWORK", "PUBLIC"]).default("HIDDEN"),
  publicName: z.string().max(100).default(""), publicDescription: z.string().max(2000).default(""), topics: topics.default([]),
  primary: z.boolean().default(false),
}).strict();
export const entrySchema = z.object({
  reference, recordType: reference, revision: reference,
  eligibility: z.enum(["OWNER_SELECTED", "EXPLICIT_POLICY_ELIGIBLE"]), topics,
}).strict();
export const viewSchema = z.object({
  id: reference.optional(), publisherAgentId: reference, name: z.string().min(1).max(200), description: z.string().max(2000),
  topics, recordTypes: z.array(reference).min(1).max(30), visibility: visibilitySchema,
  publicQueryPolicy: z.object({ authenticatedOnly: z.literal(true), callsPerMinute: z.number().int().min(1).max(60), maxRecords: z.number().int().min(1).max(50) }).strict().optional(),
  allowedAudience: z.array(z.object({ ownerId: reference, agentId: reference.optional() }).strict()).max(100),
  mode: z.enum(["SNAPSHOT", "DYNAMIC"]),
  rule: z.object({ topics, recordTypes: z.array(reference).min(1).max(30) }).strict().optional(),
  entries: z.array(entrySchema).max(500), provenancePolicy: z.literal("SOURCE_REFERENCES_REQUIRED"),
  expiresAt: timestamp, expectedVersion: z.number().int().nonnegative(),
}).strict().superRefine((view, context) => {
  if ((view.mode === "DYNAMIC") !== Boolean(view.rule)) context.addIssue({ code: "custom", message: "Dynamic views require a deterministic rule; snapshots cannot have one." });
  if (new Set(view.entries.map((entry) => entry.reference)).size !== view.entries.length) context.addIssue({ code: "custom", message: "Publication references must be unique." });
  for (const entry of view.entries) {
    if (!view.recordTypes.includes(entry.recordType)) context.addIssue({ code: "custom", message: "Record type is outside view." });
    if (view.mode === "DYNAMIC" && (entry.eligibility !== "EXPLICIT_POLICY_ELIGIBLE" || !view.rule?.recordTypes.includes(entry.recordType) || !entry.topics.some((topic) => view.rule?.topics.includes(topic)))) context.addIssue({ code: "custom", message: "Record is not explicitly eligible under the deterministic publication rule." });
  }
});
export const conditionsSchema = z.object({
  notBefore: timestamp.optional(), expiresAt: timestamp,
  rateLimit: z.object({ calls: z.number().int().min(1).max(120), windowSeconds: z.number().int().min(60).max(86400) }).strict(),
  allowedTopics: topics, approvalRequired: z.boolean(),
  maxCost: z.string().regex(/^\d{1,9}(\.\d{1,9})?$/).optional(),
  budgetId: reference.optional(),
}).strict();
export const grantSchema = z.object({
  grantorAgentId: reference.optional(), granteeOwnerId: reference, granteeAgentId: reference.optional(),
  capability: capabilitySchema, resource: reference, conditions: conditionsSchema,
}).strict().superRefine((grant, context) => {
  if ((grant.conditions.budgetId || grant.conditions.maxCost) && grant.capability !== "work.request") context.addIssue({ code: "custom", message: "Cost reservations currently apply only to bounded work requests." });
  if (grant.capability === "work.request" && (!grant.conditions.budgetId || !grant.conditions.maxCost)) context.addIssue({ code: "custom", message: "Work grants require an existing receiving-owner budget and a cost ceiling." });
});
const query = z.object({
  mode: z.enum(["RECORD_RETRIEVAL", "ANSWER_QUERY"]), query: z.string().min(1).max(4000),
  requestedTypes: z.array(reference).min(1).max(30), topics, maxRecords: z.number().int().min(1).max(50),
}).strict();
const message = z.object({ subject: z.string().max(200).optional(), body: z.string().min(1).max(16000), replyTo: reference.optional() }).strict();
export const artifactSchema = z.object({
  reference, name: z.string().min(1).max(200), type: reference, size: z.number().int().min(1).max(10485760),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/), visibility: z.enum(["SHARED", "UNLISTED", "PUBLIC"]), expiresAt: timestamp,
}).strict();
const sharedArtifact = artifactSchema.extend({
  retrieval: z.object({ url: z.string().url().max(2048), audience: reference, expiresAt: timestamp }).strict(),
}).strict();
const work = z.object({
  category: z.enum(["research", "analysis", "summarization", "artifact_generation"]), task: z.string().min(1).max(4000), expectedOutput: z.string().min(1).max(1000),
  budget: z.object({ runtimeSeconds: z.number().int().min(1).max(3600), cost: z.string().regex(/^\d{1,6}(\.\d{1,9})?$/), modelSteps: z.number().int().min(1).max(100), delegatedWorkers: z.literal(0) }).strict(),
  deadline: timestamp, context: z.array(reference).max(10),
}).strict();
const base = { target: reference, resource: reference, idempotencyKey: z.string().min(8).max(255), expiresAt: timestamp, conversationId: reference.optional() };
export const submissionSchema = z.discriminatedUnion("capability", [
  z.object({ ...base, capability: z.literal("knowledge.query"), payload: query }).strict(),
  z.object({ ...base, capability: z.literal("message.send"), payload: message }).strict(),
  z.object({ ...base, capability: z.literal("work.request"), payload: work }).strict(),
  z.object({ ...base, capability: z.literal("artifact.share"), payload: sharedArtifact }).strict(),
]);
export const recordSchema = z.object({
  reference, revision: reference, recordType: reference, content: z.string().max(16000),
  sourceReferences: z.array(reference).min(1).max(20), provenance: z.string().min(1).max(2000), updatedAt: timestamp,
  confidence: z.number().min(0).max(1).optional(),
}).strict();
export const knowledgeResponseSchema = z.object({
  kind: z.enum(["OWNER_PUBLISHED_KNOWLEDGE", "PUBLISHER_AGENT_SYNTHESIS"]), publicationVersion: z.number().int().positive(),
  records: z.array(recordSchema).max(50), answer: z.string().max(16000).optional(),
}).strict();
export type Submission = z.infer<typeof submissionSchema>;
export type PublishedView = z.infer<typeof viewSchema>;
export type Grant = z.infer<typeof grantSchema>;
export type KnowledgeResponse = z.infer<typeof knowledgeResponseSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
