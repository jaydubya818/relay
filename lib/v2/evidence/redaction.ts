import type { CanonicalValue } from "@/lib/v2/contracts";

const SECRET_KEY = /(authorization|bearer|cookie|password|passwd|secret|token|api[-_]?key|cvv|card[-_]?number|pan)/i;
const SECRET_VALUE = /(?:rly_|rsvc_|Bearer\s+)[A-Za-z0-9._~-]{12,}/g;

export function redactForEvidence(value: unknown, key = "root"): CanonicalValue {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.replaceAll(SECRET_VALUE, "[REDACTED]");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Evidence contains a non-finite number.");
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => redactForEvidence(entry));
  if (typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("Evidence only supports plain objects.");
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).map(([entryKey, entry]) => [entryKey, redactForEvidence(entry, entryKey)]));
  }
  throw new TypeError(`Evidence contains unsupported type ${typeof value}.`);
}

