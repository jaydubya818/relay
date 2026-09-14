import { z } from "zod";

export const relayId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[a-zA-Z0-9]{8,}$`));
export const isoTimestamp = z.string().datetime({ offset: true });

export const effectClassSchema = z.enum(["read", "external_write", "destructive", "communication", "financial"]);
export const riskClassSchema = z.enum(["low", "medium", "high", "critical"]);
export const policyOutcomeSchema = z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL", "LIMIT", "ESCALATE"]);

export const capabilityReferenceSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/),
  version: z.string().regex(/^\d+\.\d+$/),
}).strict();

export const resourceConstraintSchema = z.object({
  type: z.string().min(1).max(128),
  ids: z.array(z.string().min(1).max(512)).max(1_000).optional(),
  attributes: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).optional(),
}).strict();

export const actionIntentSchema = z.object({
  schemaVersion: z.literal("relay.action-intent.v2"),
  id: relayId("act"), accountId: relayId("acct"), agentId: relayId("agt"), runtimeClientId: relayId("rtc"),
  workloadId: relayId("wkl").optional(), taskId: relayId("tsk"), capability: capabilityReferenceSchema,
  resource: resourceConstraintSchema, parameters: z.record(z.unknown()), idempotencyKey: z.string().min(8).max(255),
  createdAt: isoTimestamp, canonicalHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();

export const relayEventSchema = z.object({
  specversion: z.literal("1.0"), id: z.string().min(1).max(255), source: z.string().min(1).max(2_048),
  type: z.string().min(1).max(255), time: isoTimestamp, subject: z.string().max(2_048).optional(),
  datacontenttype: z.string().max(255).optional(), data: z.unknown().optional(), accountid: relayId("acct"),
  classification: z.enum(["public", "internal", "confidential", "restricted"]), causationid: z.string().max(255).optional(),
  correlationid: z.string().min(1).max(255), traceparent: z.string().max(255).optional(),
  dedupekey: z.string().min(1).max(512), schemaversion: z.string().min(1).max(64),
  signaturestatus: z.enum(["verified", "unverified", "invalid"]),
}).strict();

export const capabilityLeaseClaimsSchema = z.object({
  iss: z.string().url(), sub: relayId("agt"), aud: z.string().min(1).max(255), jti: relayId("lse"),
  iat: z.number().int().nonnegative(), nbf: z.number().int().nonnegative(), exp: z.number().int().positive(),
  accountId: relayId("acct"), taskId: relayId("tsk"), runtimeClientId: relayId("rtc"), workloadId: relayId("wkl"),
  capability: capabilityReferenceSchema, resource: resourceConstraintSchema,
  actionHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(), maxCalls: z.number().int().positive(),
  budgetReservationId: relayId("res").optional(), policyDecisionId: relayId("dec"), policyRevision: z.string().min(1).max(255),
  approvalDecisionId: relayId("apd").optional(),
  environment: z.object({ providerIds: z.array(z.string().min(1)).min(1), minimumAssurance: z.enum(["registered", "attested", "managed-equivalent"]), regions: z.array(z.string().min(1)).optional() }).strict(),
  parentLeaseId: relayId("lse").optional(), delegationChain: z.array(relayId("tsk")).max(16).default([]),
  revocationEpoch: z.number().int().nonnegative(),
}).strict().superRefine((claims, context) => {
  if (claims.nbf < claims.iat) context.addIssue({ code: z.ZodIssueCode.custom, path: ["nbf"], message: "nbf cannot precede iat" });
  if (claims.exp <= claims.nbf) context.addIssue({ code: z.ZodIssueCode.custom, path: ["exp"], message: "exp must follow nbf" });
});

export const approvalScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once"), actionHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict(),
  z.object({ kind: z.literal("task"), taskId: relayId("tsk"), capability: capabilityReferenceSchema, resource: resourceConstraintSchema, maxUses: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("session"), sessionId: relayId("ses"), capability: capabilityReferenceSchema, resource: resourceConstraintSchema, maxUses: z.number().int().positive() }).strict(),
]);

export const agentPassportSchema = z.object({
  schemaVersion: z.literal("relay.agent-passport.v1"), issuer: z.string().url(), passportId: relayId("psp"),
  agentId: relayId("agt"), owner: z.object({ accountId: relayId("acct"), principalId: relayId("prn") }).strict(),
  version: z.number().int().positive(), trustTier: z.enum(["UNVERIFIED", "REGISTERED", "VERIFIED", "HIGH_ASSURANCE"]),
  capabilityEligibility: z.array(capabilityReferenceSchema).max(1_000), policyReferences: z.array(z.string().min(1).max(255)).max(100),
  budgetReferences: z.array(z.string().min(1).max(255)).max(100),
  allowedEnvironments: z.object({ providerIds: z.array(z.string().min(1).max(255)).max(100), minimumAssurance: z.enum(["registered", "attested", "managed-equivalent"]), regions: z.array(z.string().min(1).max(64)).max(100).optional() }).strict(),
  dataAccess: z.array(z.object({ classification: z.enum(["public", "internal", "confidential", "restricted"]), resourceTypes: z.array(z.string().min(1).max(128)).max(100) }).strict()).max(100),
  validFrom: isoTimestamp, expiresAt: isoTimestamp, revocationEpoch: z.number().int().nonnegative(),
}).strict().refine((passport) => Date.parse(passport.expiresAt) > Date.parse(passport.validFrom), { path: ["expiresAt"], message: "expiresAt must follow validFrom" });

export const signedAgentPassportSchema = z.object({ passport: agentPassportSchema, payloadHash: z.string().regex(/^sha256:[a-f0-9]{64}$/), signature: z.string().min(1), signingKeyId: z.string().min(1).max(255) }).strict();

export const schemas = {
  actionIntent: { $schema: "https://json-schema.org/draft/2020-12/schema", $id: "relay://schemas/action-intent/v2", title: "Relay V2 Action Intent", type: "object", additionalProperties: false, required: ["schemaVersion", "id", "accountId", "agentId", "runtimeClientId", "taskId", "capability", "resource", "parameters", "idempotencyKey", "createdAt", "canonicalHash"] },
  event: { $schema: "https://json-schema.org/draft/2020-12/schema", $id: "relay://schemas/event/v2", title: "Relay V2 Event Envelope", type: "object", additionalProperties: false, required: ["specversion", "id", "source", "type", "time", "accountid", "classification", "correlationid", "dedupekey", "schemaversion", "signaturestatus"] },
  capabilityLeaseClaims: { $schema: "https://json-schema.org/draft/2020-12/schema", $id: "relay://schemas/capability-lease-claims/v2", title: "Relay V2 Capability Lease Claims", type: "object", additionalProperties: false, required: ["iss", "sub", "aud", "jti", "iat", "nbf", "exp", "accountId", "taskId", "runtimeClientId", "workloadId", "capability", "resource", "maxCalls", "policyDecisionId", "policyRevision", "environment", "delegationChain", "revocationEpoch"] },
} as const;

export type ActionIntent = z.infer<typeof actionIntentSchema>;
export type RelayEvent = z.infer<typeof relayEventSchema>;
export type CapabilityLeaseClaims = z.infer<typeof capabilityLeaseClaimsSchema>;
export type ApprovalScope = z.infer<typeof approvalScopeSchema>;
export type AgentPassport = z.infer<typeof agentPassportSchema>;
export type SignedAgentPassport = z.infer<typeof signedAgentPassportSchema>;
