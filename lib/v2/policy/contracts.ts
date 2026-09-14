import { z } from "zod";
import { capabilityReferenceSchema, effectClassSchema, policyOutcomeSchema, riskClassSchema } from "@/lib/v2/contracts/schemas";

export const capabilityDefinitionSchema = z.object({
  name: capabilityReferenceSchema.shape.name, version: capabilityReferenceSchema.shape.version,
  domain: z.string().min(1).max(128), description: z.string().min(1).max(2_000),
  effectClass: effectClassSchema, riskClass: riskClassSchema, resourceType: z.string().min(1).max(128),
  inputSchema: z.record(z.unknown()), outputSchema: z.record(z.unknown()),
}).strict();

const factValue = z.union([z.string(), z.number(), z.boolean()]);
export const policyRuleSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{2,127}$/),
  effect: policyOutcomeSchema,
  match: z.object({ capability: capabilityReferenceSchema.optional(), effectClass: effectClassSchema.optional(), riskClass: riskClassSchema.optional(), resourceType: z.string().min(1).max(128).optional(), facts: z.record(factValue).optional() }).strict(),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,127}$/),
  approval: z.object({ class: z.string().min(1).max(128), allowedScopes: z.array(z.enum(["once", "task", "session"])).min(1) }).strict().optional(),
  limits: z.record(z.number().nonnegative()).optional(),
  escalationTarget: z.string().min(1).max(128).optional(),
}).strict().superRefine((rule, context) => {
  if (rule.effect === "REQUIRE_APPROVAL" && !rule.approval) context.addIssue({ code: z.ZodIssueCode.custom, path: ["approval"], message: "approval is required" });
  if (rule.effect === "LIMIT" && !rule.limits) context.addIssue({ code: z.ZodIssueCode.custom, path: ["limits"], message: "limits are required" });
  if (rule.effect === "ESCALATE" && !rule.escalationTarget) context.addIssue({ code: z.ZodIssueCode.custom, path: ["escalationTarget"], message: "escalationTarget is required" });
});

export const policyBundleDocumentSchema = z.object({
  schemaVersion: z.literal("relay.policy-bundle.v1"), name: z.string().min(1).max(255),
  layer: z.enum(["RELAY_SAFETY", "REGULATORY", "ACCOUNT", "PASSPORT", "RESOURCE", "TASK", "DYNAMIC_RISK"]),
  version: z.number().int().positive(), accountId: z.string().nullable(), rules: z.array(policyRuleSchema).min(1).max(1_000),
}).strict();

export const resolvedFactSchema = z.object({ name: z.string().min(1).max(128), value: factValue, authoritative: z.boolean(), observedAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }), sourceRevision: z.string().min(1).max(255) }).strict();

export type CapabilityDefinition = z.infer<typeof capabilityDefinitionSchema>;
export type PolicyRule = z.infer<typeof policyRuleSchema>;
export type PolicyBundleDocument = z.infer<typeof policyBundleDocumentSchema>;
export type ResolvedFact = z.infer<typeof resolvedFactSchema>;
