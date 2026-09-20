import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "**/*performance.spec.ts",
  use: { baseURL: "http://127.0.0.1:3210", trace: "retain-on-failure" },
  webServer: {
    command: "RELAY_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/relay_e2e_playwright RELAY_SESSION_SECRET=e2e-session-secret RELAY_ENCRYPTION_KEY=e2e-encryption-key RELAY_ADMIN_PASSWORD=relay-e2e NEXT_PUBLIC_RELAY_URL=http://127.0.0.1:3210 pnpm dev:e2e",
    url: "http://127.0.0.1:3210/api/health",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
