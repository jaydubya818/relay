import type { CanonicalValue } from "@/lib/v2/contracts";

const SECRET_KEY = /(authorization|bearer|cookie|password|passwd|secret|token|api[-_]?key|cvv|cvc|card[-_]?number|pan|routing[-_]?number|bank[-_]?account|account[-_]?number|iban)/i;
const SECRET_VALUE = /(?:rly_|rsvc_|Bearer\s+)[A-Za-z0-9._~-]{12,}/g;
const PAYMENT_NUMBER = /(?:\d[ -]?){12,18}\d/g;

function isLuhn(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0; let alternate = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) { let digit = Number(digits[index]); if (alternate && (digit *= 2) > 9) digit -= 9; sum += digit; alternate = !alternate; }
  return sum % 10 === 0;
}

function redactString(value: string) {
  return value.replaceAll(SECRET_VALUE, "[REDACTED]").replace(PAYMENT_NUMBER, (candidate) => isLuhn(candidate) ? "[REDACTED_PAYMENT_NUMBER]" : candidate);
}

export function redactForEvidence(value: unknown, key = "root"): CanonicalValue {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return redactString(value);
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
