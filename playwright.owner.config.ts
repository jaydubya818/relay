import { defineConfig } from "@playwright/test";
const databaseUrl = process.env.RELAY_OWNER_TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:56547/relay_e2e_owner_experience";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "owner-experience.spec.ts",
  workers: 1,
  timeout: 180000,
  expect: { timeout: 15000, toHaveScreenshot: { maxDiffPixelRatio: 0.005 } },
  use: { baseURL: "http://127.0.0.1:3219", trace: "retain-on-failure", timezoneId: "UTC", locale: "en-US", colorScheme: "light", contextOptions: { reducedMotion: "reduce" } },
  webServer: {
    command: "pnpm exec tsx scripts/reset-owner-e2e.ts && pnpm exec next dev --hostname 127.0.0.1 --port 3219",
    url: "http://127.0.0.1:3219/login", reuseExistingServer: false, timeout: 120000,
    env: {
      RELAY_OWNER_TEST_BUILD: "true",
      RELAY_DATABASE_URL: databaseUrl, RELAY_SESSION_SECRET: "synthetic-session-secret-owner-experience",
      RELAY_ENCRYPTION_KEY: "synthetic-encryption-key-owner-experience", RELAY_ALLOW_SIGNUP: "false",
      RELAY_DEPLOYMENT_MODE: "private-preview", RELAY_V2_ACTIONS_ENABLED: "false", RELAY_FEDERATION_ENABLED: "false",
      RELAY_TELEGRAM_ENABLED: "false", NEXT_PUBLIC_RELAY_URL: "http://127.0.0.1:3219",
      MYFACTORY_CLIENT_TOKEN: "", MYFACTORY_RELAY_ACCOUNT_ID: "", GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "",
    },
  },
});
