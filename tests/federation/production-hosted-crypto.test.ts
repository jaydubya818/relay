import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes, sign as signBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { productionCryptoBindings } from "@/lib/v2/production-crypto";
import { crc32c } from "@/lib/v2/evidence/google-kms";
import { productionHostedCrypto } from "@/lib/v2/production-hosted-crypto";
import type { SigningKey } from "@/lib/v2/evidence/signing-provider";

const kmsProjectId = "relay-prod-kms";
const keyVersion = (name: string) => `projects/${kmsProjectId}/locations/us-west1/keyRings/relay/cryptoKeys/${name}/cryptoKeyVersions/1`;
const identity = {
  issuer: "https://oidc.vercel.com/jaydubya818",
  audience: "https://vercel.com/jaydubya818",
  ownerId: "team_p8z8exJRTGfOPk1GC9vUOpv3",
  projectId: "prj_3IRvr9knK5VJcBTgTYMvhv6ixmJK",
  environment: "production",
  subject: "owner:jaydubya818:project:relay:environment:production",
  provider: "//iam.googleapis.com/projects/1234567890/locations/global/workloadIdentityPools/relay/providers/vercel",
};
const signingPairs = new Map((["evidence", "federation-delivery", "passport"] as const).map((purpose) => [purpose, generateKeyPairSync("ed25519")]));
const keys: SigningKey[] = (["evidence", "federation-delivery", "passport"] as const).map((purpose) => ({
  keyId: `production-${purpose}`,
  keyVersion: keyVersion(purpose),
  purpose,
  algorithm: "Ed25519",
  publicKeyPem: signingPairs.get(purpose)!.publicKey.export({ type: "spki", format: "pem" }).toString(),
  state: "ACTIVE",
  activatedAt: "2026-01-01T00:00:00.000Z",
}));
const wrapVersion = keyVersion("owner-dek");
const environment = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_TARGET_ENV: "production",
  RELAY_CRYPTO_BACKEND: "kms",
  RELAY_PRODUCTION_KMS_PROJECT_ID: kmsProjectId,
  RELAY_PRODUCTION_IDENTITY_JSON: JSON.stringify(identity),
  RELAY_PRODUCTION_SIGNING_KEYS_JSON: JSON.stringify(keys),
  RELAY_PRODUCTION_WRAPPING_VERSIONS_JSON: JSON.stringify([{ version: wrapVersion, state: "ACTIVE" }]),
  RELAY_ISSUER_URL: "https://relay.example",
  RELAY_V2_ACTIONS_ENABLED: "true",
  RELAY_FEDERATION_ENABLED: "true",
};

function assertion() {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: identity.issuer,
    aud: identity.audience,
    owner_id: identity.ownerId,
    project_id: identity.projectId,
    environment: identity.environment,
    sub: identity.subject,
    iat: now,
    exp: now + 900,
  };
  return `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.synthetic`;
}

function kmsRequest() {
  const wrappingKey = randomBytes(32);
  const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace("https://cloudkms.googleapis.com/v1/", "");
    if (url === "https://sts.googleapis.com/v1/token") {
      return Response.json({
        access_token: "synthetic-sts-token",
        token_type: "Bearer",
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        expires_in: 300,
      });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
    if (!init?.body) {
      return Response.json({
        name: path,
        state: "ENABLED",
        algorithm: path.includes("owner-dek") ? "GOOGLE_SYMMETRIC_ENCRYPTION" : "EC_SIGN_ED25519",
        protectionLevel: "SOFTWARE",
      });
    }
    if (path.endsWith(":asymmetricSign")) {
      const version = path.slice(0, -":asymmetricSign".length);
      const purpose = path.match(/\/cryptoKeys\/([^/]+)\/cryptoKeyVersions\//)?.[1] as "evidence" | "federation-delivery" | "passport" | undefined;
      const privateKey = purpose ? signingPairs.get(purpose)?.privateKey : undefined;
      if (!privateKey) return new Response("", { status: 404 });
      const signature = signBytes(null, Buffer.from(body.data!, "base64"), privateKey);
      return Response.json({
        name: version,
        verifiedDataCrc32c: true,
        protectionLevel: "SOFTWARE",
        signature: signature.toString("base64"),
        signatureCrc32c: String(crc32c(signature)),
      });
    }
    if (path.endsWith(":encrypt")) {
      const version = path.slice(0, -":encrypt".length);
      const plaintext = Buffer.from(body.plaintext!, "base64");
      const aad = Buffer.from(body.additionalAuthenticatedData!, "base64");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", wrappingKey, iv);
      cipher.setAAD(aad);
      const ciphertext = Buffer.from(JSON.stringify({
        version,
        iv: iv.toString("base64"),
        data: Buffer.concat([cipher.update(plaintext), cipher.final()]).toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
      }));
      return Response.json({
        name: version,
        ciphertext: ciphertext.toString("base64"),
        ciphertextCrc32c: String(crc32c(ciphertext)),
        verifiedPlaintextCrc32c: true,
        verifiedAdditionalAuthenticatedDataCrc32c: true,
      });
    }
    if (path.endsWith(":decrypt")) {
      const ciphertext = Buffer.from(body.ciphertext!, "base64");
      const encoded = JSON.parse(ciphertext.toString()) as { iv: string; data: string; tag: string };
      const decipher = createDecipheriv("aes-256-gcm", wrappingKey, Buffer.from(encoded.iv, "base64"));
      decipher.setAAD(Buffer.from(body.additionalAuthenticatedData!, "base64"));
      decipher.setAuthTag(Buffer.from(encoded.tag, "base64"));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(encoded.data, "base64")), decipher.final()]);
      return Response.json({ plaintext: plaintext.toString("base64"), plaintextCrc32c: String(crc32c(plaintext)) });
    }
    return new Response("", { status: 404 });
  });
  return request;
}

afterEach(() => vi.unstubAllEnvs());

it("composes pinned production OIDC with KMS signing and owner-bound envelope operations", async () => {
  const request = kmsRequest();
  const getAssertion = vi.fn(async () => assertion());
  const hosted = productionHostedCrypto(environment, getAssertion, request);
  const bindings = productionCryptoBindings(environment, hosted);
  expect(bindings.signer.keyId).toBe("production-evidence");

  const signature = await bindings.signer.sign("local production wiring check");
  expect(await bindings.signer.verify("local production wiring check", signature)).toBe(true);
  const passportSigner = bindings.signer.forPurpose?.("passport");
  expect(passportSigner).toBeDefined();
  expect(await passportSigner!.publicKeyPem())
    .toBe(signingPairs.get("passport")!.publicKey.export({ type: "spki", format: "pem" }).toString());

  const wrappingKey = bindings.federation!.keyWrapper;
  const wrapped = await wrappingKey.wrap("owner-a", Buffer.alloc(32, 7));
  expect(await wrappingKey.unwrap("owner-a", wrapped)).toEqual(Buffer.alloc(32, 7));
  await expect(wrappingKey.unwrap("owner-b", wrapped)).rejects.toThrow("unavailable");
  expect(getAssertion).toHaveBeenCalledTimes(7);
  const stsCalls = request.mock.calls.filter(([url]) => String(url) === "https://sts.googleapis.com/v1/token");
  const kmsCalls = request.mock.calls.filter(([url]) => String(url).startsWith("https://cloudkms.googleapis.com/v1/"));
  expect(stsCalls).toHaveLength(7);
  expect(stsCalls.every(([, options]) => !new Headers(options?.headers).has("authorization"))).toBe(true);
  expect(kmsCalls.every(([, options]) => new Headers(options?.headers).get("authorization") === "Bearer synthetic-sts-token")).toBe(true);
});

it.each([
  { ...environment, NODE_ENV: "development" },
  { ...environment, VERCEL_TARGET_ENV: "preview" },
  { ...environment, RELAY_CRYPTO_BACKEND: "managed-secret" },
  { ...environment, RELAY_PRODUCTION_KMS_PROJECT_ID: "other-project" },
  { ...environment, RELAY_PRODUCTION_IDENTITY_JSON: JSON.stringify({ ...identity, subject: "owner:other:project:relay:environment:production" }) },
  { ...environment, RELAY_PRODUCTION_IDENTITY_JSON: JSON.stringify({ ...identity, customEnvironmentId: "env_wrong" }) },
])("rejects non-production or unpinned production crypto configuration", (configured) => {
  expect(() => productionHostedCrypto(configured, async () => assertion(), kmsRequest())).toThrow("configuration is unavailable or invalid");
});

it("rejects a KMS registry that escapes the pinned Google project", () => {
  const unsafeKeys = keys.map((key, index) => index === 0 ? { ...key, keyVersion: key.keyVersion.replace(kmsProjectId, "other-project") } : key);
  expect(() => productionHostedCrypto({ ...environment, RELAY_PRODUCTION_SIGNING_KEYS_JSON: JSON.stringify(unsafeKeys) }, async () => assertion(), kmsRequest()))
    .toThrow("configuration is unavailable or invalid");
});
