import { generateKeyPairSync } from "node:crypto";
import { defineConfig } from "@playwright/test";
const signingKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const wrappingKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "integrations.spec.ts", workers: 1, timeout: 90000,
  expect: { timeout: 15000 }, use: { baseURL: "http://127.0.0.1:3262", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm exec tsx scripts/reset-integration-e2e.ts && pnpm exec next dev --hostname 127.0.0.1 --port 3262",
    url: "http://127.0.0.1:3262/login", reuseExistingServer: false, timeout: 120000,
    env: { RELAY_OWNER_TEST_BUILD: "true", RELAY_DATABASE_URL: process.env.RELAY_INTEGRATION_TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:56631/relay_e2e_integrations",
      RELAY_SESSION_SECRET: "synthetic-integration-session-secret", RELAY_ENCRYPTION_KEY: "synthetic-integration-encryption-key",
      RELAY_INTEGRATIONS_PREVIEW: "true", RELAY_ALLOW_SIGNUP: "false", RELAY_DEPLOYMENT_MODE: "local",
      RELAY_V2_ACTIONS_ENABLED: "true", RELAY_FEDERATION_ENABLED: "true", RELAY_CRYPTO_BACKEND: "managed-secret",
      RELAY_ISSUER_URL: "https://synthetic-relay.example", RELAY_SIGNING_KEY_ID: "synthetic-integration-signing",
      RELAY_WRAPPING_KEY_ID: "synthetic-integration-wrapping", RELAY_SIGNING_PRIVATE_KEY: signingKey, RELAY_WRAPPING_PRIVATE_KEY: wrappingKey,
      NEXT_PUBLIC_RELAY_URL: "http://127.0.0.1:3262", COMPOSIO_API_KEY: "", GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "",
    },
  },
});
