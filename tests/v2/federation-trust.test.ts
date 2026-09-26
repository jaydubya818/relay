import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { configureV2PlatformBindings } from "@/lib/v2/platform-bindings";
import { GET } from "@/app/api/federation/trust/route";

describe("public federation trust material", () => {
  it("fails closed when federation is disabled", async () => {
    vi.stubEnv("RELAY_FEDERATION_ENABLED", "false");
    expect((await GET()).status).toBe(503);
    vi.unstubAllEnvs();
  });

  it("returns only the active delivery verification key and issuer", async () => {
    const key = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    vi.stubEnv("RELAY_FEDERATION_ENABLED", "true");
    configureV2PlatformBindings({
      signer: { keyId: "evidence", async sign() { return ""; }, async verify() { return false; }, async publicKeyPem() { return ""; },
        forPurpose(purpose) {
          if (purpose !== "federation-delivery") throw new Error("Wrong purpose");
          return { keyId: "delivery-v1", keyVersion: "1", async sign() { return ""; }, async verify() { return false; }, async publicKeyPem() { return key; } };
        } },
      keyResolver: { publicKeyForKeyId: async () => undefined },
      federation: { issuer: "https://relay.example.test", keyWrapper: { keyId: "wrap", async wrap() { return ""; }, async unwrap() { return Buffer.alloc(0); } } },
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ origin: "https://relay.example.test", keyId: "delivery-v1", keyVersion: "1", publicKey: key });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    vi.unstubAllEnvs();
  });
});
