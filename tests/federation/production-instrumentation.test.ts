import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { register } from "@/instrumentation";
import { requireV2PlatformBindings } from "@/lib/v2/platform-bindings";

const kmsProjectId = "relay-prod-kms";
const keyVersion = (name: string) => `projects/${kmsProjectId}/locations/us-west1/keyRings/relay/cryptoKeys/${name}/cryptoKeyVersions/1`;
const keyPairs = new Map(["evidence", "federation-delivery", "passport"].map((purpose) => [purpose, generateKeyPairSync("ed25519")]));
const keys = ["evidence", "federation-delivery", "passport"].map((purpose) => ({
  keyId: `production-${purpose}`,
  keyVersion: keyVersion(purpose),
  purpose,
  algorithm: "Ed25519",
  publicKeyPem: keyPairs.get(purpose)!.publicKey.export({ type: "spki", format: "pem" }).toString(),
  state: "ACTIVE",
  activatedAt: "2026-01-01T00:00:00.000Z",
}));
const identity = {
  issuer: "https://oidc.vercel.com/jaydubya818",
  audience: "https://vercel.com/jaydubya818",
  ownerId: "team_p8z8exJRTGfOPk1GC9vUOpv3",
  projectId: "prj_3IRvr9knK5VJcBTgTYMvhv6ixmJK",
  environment: "production",
  subject: "owner:jaydubya818:project:relay:environment:production",
  provider: "//iam.googleapis.com/projects/1234567890/locations/global/workloadIdentityPools/relay/providers/vercel",
};

afterEach(() => vi.unstubAllEnvs());

it("wires the production KMS provider during opt-in Node startup", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_TARGET_ENV", "production");
  vi.stubEnv("RELAY_FEDERATION_ENABLED", "true");
  vi.stubEnv("RELAY_V2_ACTIONS_ENABLED", "true");
  vi.stubEnv("RELAY_DEPLOYMENT_MODE", "production");
  vi.stubEnv("RELAY_CRYPTO_BACKEND", "kms");
  vi.stubEnv("RELAY_ISSUER_URL", "https://relay.example");
  vi.stubEnv("RELAY_PRODUCTION_KMS_PROJECT_ID", kmsProjectId);
  vi.stubEnv("RELAY_PRODUCTION_IDENTITY_JSON", JSON.stringify(identity));
  vi.stubEnv("RELAY_PRODUCTION_SIGNING_KEYS_JSON", JSON.stringify(keys));
  vi.stubEnv("RELAY_PRODUCTION_WRAPPING_VERSIONS_JSON", JSON.stringify([{ version: keyVersion("owner-dek"), state: "ACTIVE" }]));

  await register();
  expect(requireV2PlatformBindings().signer.keyId).toBe("production-evidence");
  expect(requireV2PlatformBindings().signer.keyVersion).toBe(keyVersion("evidence"));
  expect(requireV2PlatformBindings().federation?.issuer).toBe("https://relay.example");
});

it("leaves the existing default-off startup path inert", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("RELAY_FEDERATION_ENABLED", "false");
  await expect(register()).resolves.toBeUndefined();
});
