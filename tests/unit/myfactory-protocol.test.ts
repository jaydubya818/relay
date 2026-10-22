/**
 * Tests for lib/myfactory-protocol.mjs covering:
 *  - Legacy single-key receipt verification
 *  - keyId-signed receipts (QA-10: Relay must handle keyId envelopes after a host upgrade)
 *  - Tampered receipts (signature altered / payload altered)
 *  - Wrong keyId / missing key ring entry
 *  - Backward-compat: legacy receipts still work with a string public key
 *  - Cross-entry isolation: a keyId receipt is not accepted with the wrong key
 */
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  receiptDescription,
  readReceipt,
  requestId,
} from "@/lib/myfactory-protocol.mjs";

// ---------------------------------------------------------------------------
// Fixture key pairs
// ---------------------------------------------------------------------------
function makeKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicKey: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

const LEGACY_KEY = makeKeyPair();
const KEY_A = makeKeyPair();
const KEY_B = makeKeyPair();
const WRONG_KEY = makeKeyPair();

const ISSUE_ID = requestId("relay", "stable-idempotency-key");

// ---------------------------------------------------------------------------
// Fixture receipts
// ---------------------------------------------------------------------------
const BASE_RECEIPT = {
  version: 1 as const,
  issueId: ISSUE_ID,
  workOrderId: "wo_test_001",
  state: "ADMITTED",
  updatedAt: "2026-10-22T00:00:00.000Z",
  workOrderUrl: "http://127.0.0.1:8788/?workOrder=wo_test_001",
};

function makeDescription(receipt: object, privateKeyPem: string) {
  return receiptDescription("Original issue body", receipt as never, privateKeyPem);
}

const LEGACY_DESC = makeDescription(BASE_RECEIPT, LEGACY_KEY.privateKey);
const KEY_A_DESC = makeDescription({ ...BASE_RECEIPT, keyId: "key-a" }, KEY_A.privateKey);
const KEY_B_DESC = makeDescription({ ...BASE_RECEIPT, keyId: "key-b" }, KEY_B.privateKey);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("myfactory-protocol readReceipt — legacy mode", () => {
  it("verifies a valid legacy receipt with a string public key", () => {
    const receipt = readReceipt(LEGACY_DESC, LEGACY_KEY.publicKey, ISSUE_ID);
    expect(receipt).toMatchObject({ version: 1, issueId: ISSUE_ID, workOrderId: "wo_test_001" });
    expect(receipt?.keyId).toBeUndefined();
  });

  it("returns null when no receipt block is present", () => {
    expect(readReceipt("No receipt here", LEGACY_KEY.publicKey, ISSUE_ID)).toBeNull();
  });

  it("throws on a tampered payload (edited after signing)", () => {
    // Flip one character in the base64url-encoded payload
    const tampered = LEGACY_DESC.replace(/("encoded":"[A-Za-z0-9_-]{4})/, (m, p) => p.slice(0, -1) + "X\"");
    expect(() => readReceipt(tampered, LEGACY_KEY.publicKey, ISSUE_ID)).toThrow();
  });

  it("throws when the signature is truncated", () => {
    const truncated = LEGACY_DESC.replace(/"signature":"[A-Za-z0-9_-]+"/,
      (_m) => `"signature":"AAAA"`);
    expect(() => readReceipt(truncated, LEGACY_KEY.publicKey, ISSUE_ID)).toThrow();
  });

  it("throws when verified with the wrong key", () => {
    expect(() => readReceipt(LEGACY_DESC, WRONG_KEY.publicKey, ISSUE_ID)).toThrow("Unverified factory receipt");
  });

  it("throws when the issueId does not match", () => {
    const wrongId = requestId("relay", "completely-different-key");
    expect(() => readReceipt(LEGACY_DESC, LEGACY_KEY.publicKey, wrongId)).toThrow("Wrong factory receipt");
  });
});

describe("myfactory-protocol readReceipt — keyId mode (QA-10)", () => {
  const keyRing = { "key-a": KEY_A.publicKey, "key-b": KEY_B.publicKey };

  it("verifies a receipt signed with key-a using a key ring", () => {
    const receipt = readReceipt(KEY_A_DESC, keyRing, ISSUE_ID);
    expect(receipt).toMatchObject({ keyId: "key-a", workOrderId: "wo_test_001" });
  });

  it("verifies a receipt signed with key-b using a key ring", () => {
    const receipt = readReceipt(KEY_B_DESC, keyRing, ISSUE_ID);
    expect(receipt).toMatchObject({ keyId: "key-b", workOrderId: "wo_test_001" });
  });

  it("throws when the keyId is not present in the key ring", () => {
    const partialRing = { "key-a": KEY_A.publicKey }; // key-b absent
    expect(() => readReceipt(KEY_B_DESC, partialRing, ISSUE_ID)).toThrow("Unverified factory receipt");
  });

  it("throws when a keyId receipt is verified with the wrong key in the ring", () => {
    const badRing = { "key-a": WRONG_KEY.publicKey };
    expect(() => readReceipt(KEY_A_DESC, badRing, ISSUE_ID)).toThrow("Unverified factory receipt");
  });

  it("throws when a keyId receipt is passed a plain-string key (legacy mode cannot verify keyId receipts)", () => {
    // A string key has no way to do key-ring lookup — this should fail.
    expect(() => readReceipt(KEY_A_DESC, KEY_A.publicKey, ISSUE_ID)).toThrow("Unverified factory receipt");
  });

  it("throws on a tampered keyId receipt payload", () => {
    const tampered = KEY_A_DESC.replace(/("encoded":"[A-Za-z0-9_-]{4})/, (m, p) => p.slice(0, -1) + "X\"");
    expect(() => readReceipt(tampered, keyRing, ISSUE_ID)).toThrow();
  });
});

describe("myfactory-protocol readReceipt — key ring with legacy fallback", () => {
  // When a host starts signing with keyId but older receipts (no keyId) may still
  // be in flight, callers can pass a ring that also contains the legacy key at "".
  it("verifies a legacy receipt using the empty-string slot in a key ring", () => {
    const mixedRing = { "": LEGACY_KEY.publicKey, "key-a": KEY_A.publicKey };
    const receipt = readReceipt(LEGACY_DESC, mixedRing, ISSUE_ID);
    expect(receipt).toMatchObject({ version: 1, workOrderId: "wo_test_001" });
  });

  it("verifies a keyId receipt alongside legacy in the same ring", () => {
    const mixedRing = { "": LEGACY_KEY.publicKey, "key-a": KEY_A.publicKey };
    const receipt = readReceipt(KEY_A_DESC, mixedRing, ISSUE_ID);
    expect(receipt).toMatchObject({ keyId: "key-a" });
  });
});

describe("myfactory-protocol readReceipt — cross-key isolation", () => {
  it("does not accept a key-a receipt when only key-b is in the ring", () => {
    const partialRing = { "key-b": KEY_B.publicKey };
    expect(() => readReceipt(KEY_A_DESC, partialRing, ISSUE_ID)).toThrow("Unverified factory receipt");
  });

  it("does not accept a key-b receipt verified against key-a", () => {
    const crossRing = { "key-b": KEY_A.publicKey }; // key-b points to the wrong PEM
    expect(() => readReceipt(KEY_B_DESC, crossRing, ISSUE_ID)).toThrow("Unverified factory receipt");
  });
});
