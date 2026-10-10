import { z } from "zod";
import { canonicalHash, canonicalJson } from "@/lib/v2/contracts";
import { redactForEvidence } from "@/lib/v2/evidence/redaction";
import { IntegrationError, type IntegrationResult } from "./contracts";

const identity = z.string().min(1).max(255);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identitySchema = z.object({
  provider: z.literal("composio"), adapterVersion: identity, scopeDigest: digest,
  connectionId: identity, authorityVersion: z.number().int().positive(),
  tool: z.string().regex(/^[A-Z][A-Z0-9_]+$/), version: z.string().regex(/^\d{8}_\d+$/),
  schemaHash: digest, argumentDigest: digest, executionBindingDigest: digest,
  actionHash: digest, policyDecisionId: identity, leaseId: identity,
  approvalDecisionId: identity.optional(),
}).strict();

type ResultIdentity = z.infer<typeof identitySchema>;
const evidenceSchema = identitySchema.extend({
  resultDigest: digest.optional(), errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),
  durationMs: z.number().finite().nonnegative(),
}).strict();
const resultSchema = z.object({
  state: z.enum(["SUCCEEDED", "UNKNOWN"]), trust: z.literal("UNTRUSTED_EXTERNAL_DATA"),
  data: z.unknown().optional(), evidence: evidenceSchema,
}).strict();

function immutable<T>(value: T): T {
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (current && typeof current === "object" && !Object.isFrozen(current)) {
      pending.push(...Object.values(current));
      Object.freeze(current);
    }
  }
  return value;
}

/** Capture the adapter's already-bound identity before dispatch. This only checks
 * transport integrity: it is NOT an admission grant, provider signature, durable
 * receipt, result projection, or permission to reconcile UNKNOWN. The canonical
 * receiver must authenticate readback and perform revocation/state checks.
 * Deliberately does not re-evaluate lease expiry when a late result is checked. */
export function captureResultIntegrity(identity: ResultIdentity) {
  const snapshot = Object.freeze(identitySchema.parse(identity));
  const expected = canonicalHash(snapshot);
  return (input: unknown): IntegrationResult => {
    try {
      const result = resultSchema.parse(input);
      const { resultDigest, errorCode, ...actual } = result.evidence;
      Reflect.deleteProperty(actual, "durationMs");
      if (canonicalHash(actual) !== expected) throw new Error("identity");
      if (result.state === "UNKNOWN") {
        if (Object.hasOwn(result, "data") || resultDigest !== undefined || !errorCode) throw new Error("unknown");
      } else {
        if (!Object.hasOwn(result, "data") || !resultDigest || errorCode !== undefined) throw new Error("success");
        // Only the reviewed adapter projection may reach this boundary. Reject
        // residual secret fields rather than silently changing a signed digest.
        const encoded = canonicalJson(result.data);
        if (Buffer.byteLength(encoded) > 64 * 1024) throw new Error("size");
        if (canonicalHash(result.data) !== resultDigest
          || canonicalHash(redactForEvidence(result.data)) !== resultDigest) throw new Error("digest");
      }
      // Detach provider/caller references before custody. UNKNOWN contains no data.
      return immutable(JSON.parse(canonicalJson(result)) as IntegrationResult);
    } catch {
      // Never expose provider data or validation diagnostics through exceptions.
      throw new IntegrationError("RESULT_INTEGRITY_MISMATCH", "UNKNOWN");
    }
  };
}
