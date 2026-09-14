import { afterEach, describe, expect, it } from "vitest";
import { appendAuditRecord, createLocalEd25519Signer, createLocalRsaKeyWrapper, deleteEvidenceArtifact, exportAuditBundle, InMemoryEvidenceObjectClient, listAuditRecords, readEvidenceArtifact, storeEvidenceJson, verifyAuditBundle, verifyAuditRecords } from "@/lib/v2/evidence";
import { redactForEvidence } from "@/lib/v2/evidence/redaction";
import { cleanupDatabase, freshDatabase, secondAccount } from "../helpers";

describe("Relay V2 evidence and audit", () => {
  afterEach(cleanupDatabase);

  it("serializes concurrent appends into a verifiable account chain", async () => {
    const { accountId } = await freshDatabase();
    const signer = createLocalEd25519Signer();
    await Promise.all(Array.from({ length: 12 }, (_, index) => appendAuditRecord({ accountId, eventType: "test.concurrent", outcome: "SUCCESS", details: { index } }, signer)));
    const records = await listAuditRecords(accountId);
    expect(records.map((record) => record.sequence)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    await expect(verifyAuditRecords(records, signer)).resolves.toBe(true);
  });

  it("redacts secrets before persistence and supports offline key rotation verification", async () => {
    const { accountId } = await freshDatabase();
    const first = createLocalEd25519Signer("signing-key-1");
    const second = createLocalEd25519Signer("signing-key-2");
    await appendAuditRecord({ accountId, eventType: "secret.test", outcome: "DENIED", details: { authorization: "Bearer restricted-canary-value", nested: { apiKey: "restricted-canary-value", safe: "visible" } } }, first);
    await appendAuditRecord({ accountId, eventType: "rotation.test", outcome: "SUCCESS" }, second);
    const bundle = await exportAuditBundle(accountId, [first, second]);
    expect(JSON.stringify(bundle)).not.toContain("restricted-canary-value");
    expect(bundle.records[0]?.details).toEqual({ authorization: "[REDACTED]", nested: { apiKey: "[REDACTED]", safe: "visible" } });
    expect(verifyAuditBundle(JSON.parse(JSON.stringify(bundle)))).toBe(true);
  });

  it("does not corrupt hashes or identifiers that contain Luhn-valid digit runs", () => {
    const hash = `a${"4111111111111111"}b${"0".repeat(46)}`;
    const identifier = `act_a${"4111111111111111"}b`;
    expect(redactForEvidence({ hash, identifier, note: "card 4111 1111 1111 1111" })).toEqual({
      hash,
      identifier,
      note: "card [REDACTED_PAYMENT_NUMBER]",
    });
  });

  it("rejects tampering, deletion, reordering, tenant substitution, and wrong keys", async () => {
    const { accountId } = await freshDatabase();
    const otherAccountId = await secondAccount();
    const signer = createLocalEd25519Signer();
    await appendAuditRecord({ accountId, eventType: "one", outcome: "SUCCESS" }, signer);
    await appendAuditRecord({ accountId, eventType: "two", outcome: "SUCCESS" }, signer);
    const bundle = await exportAuditBundle(accountId, signer);
    const clone = () => structuredClone(bundle);
    const tampered = clone(); tampered.records[0]!.outcome = "FAILED";
    const deleted = clone(); deleted.records.pop();
    const reordered = clone(); reordered.records.reverse();
    const substituted = clone(); substituted.accountId = otherAccountId;
    const wrongKey = clone(); wrongKey.signingKeys[0]!.publicKeyPem = await createLocalEd25519Signer("other").publicKeyPem();
    expect([tampered, deleted, reordered, substituted, wrongKey].map(verifyAuditBundle)).toEqual([false, false, false, false, false]);
  });

  it("isolates audit queries and encrypted artifacts by account", async () => {
    const { accountId } = await freshDatabase();
    const otherAccountId = await secondAccount();
    const signer = createLocalEd25519Signer();
    await appendAuditRecord({ accountId, eventType: "private", outcome: "SUCCESS" }, signer);
    expect(await listAuditRecords(otherAccountId)).toEqual([]);

    const objects = new InMemoryEvidenceObjectClient();
    const keys = createLocalRsaKeyWrapper();
    const stored = await storeEvidenceJson({ accountId, classification: "RESTRICTED", source: "RELAY_OBSERVED", value: { password: "restricted-canary-value", result: "ok" } }, { objects, keys });
    const ciphertext = objects.objects.get(stored.objectReference)!;
    expect(ciphertext.toString()).not.toContain("restricted-canary-value");
    await expect(readEvidenceArtifact(otherAccountId, stored.artifactId, { objects, keys })).resolves.toBeUndefined();
    const read = await readEvidenceArtifact(accountId, stored.artifactId, { objects, keys });
    expect(JSON.parse(read!.body.toString())).toEqual({ password: "[REDACTED]", result: "ok" });
    await expect(readEvidenceArtifact(accountId, stored.artifactId, { objects, keys: createLocalRsaKeyWrapper() })).rejects.toThrow();
  });

  it("enforces retention and account scope when deleting artifacts", async () => {
    const { accountId } = await freshDatabase();
    const otherAccountId = await secondAccount();
    const objects = new InMemoryEvidenceObjectClient();
    const keys = createLocalRsaKeyWrapper();
    const retained = await storeEvidenceJson({ accountId, classification: "INTERNAL", source: "RELAY_OBSERVED", value: { ok: true }, retentionUntil: "2099-01-01T00:00:00.000Z" }, { objects, keys });
    await expect(deleteEvidenceArtifact(otherAccountId, retained.artifactId, { objects })).resolves.toBe(false);
    await expect(deleteEvidenceArtifact(accountId, retained.artifactId, { objects })).rejects.toThrow("retention");
    await expect(deleteEvidenceArtifact(accountId, retained.artifactId, { objects }, "2100-01-01T00:00:00.000Z")).resolves.toBe(true);
    await expect(readEvidenceArtifact(accountId, retained.artifactId, { objects, keys })).resolves.toBeUndefined();
  });
});
