import { afterEach, describe, expect, it } from "vitest";
import { createAgentSecret, decryptSecret, encryptSecret, hashPassword, hashSecret, verifyPassword } from "@/lib/crypto";
import { cleanupDatabase, freshDatabase } from "../helpers";

describe("credential security", () => {
  afterEach(cleanupDatabase);

  it("hashes passwords and agent credentials without storing their plaintext", () => {
    freshDatabase();
    const passwordHash = hashPassword("a-secure-password");
    expect(passwordHash).not.toContain("a-secure-password");
    expect(verifyPassword("a-secure-password", passwordHash)).toBe(true);
    expect(verifyPassword("wrong", passwordHash)).toBe(false);
    const secret = createAgentSecret();
    expect(secret).toMatch(/^rly_/);
    expect(hashSecret(secret)).not.toContain(secret);
  });

  it("encrypts and decrypts provider credentials", () => {
    freshDatabase();
    const encrypted = encryptSecret("github_pat_example");
    expect(encrypted).not.toContain("github_pat_example");
    expect(decryptSecret(encrypted)).toBe("github_pat_example");
  });
});
