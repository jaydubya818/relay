import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*performance.spec.ts",
  use: { baseURL: "http://127.0.0.1:3211", trace: "retain-on-failure" },
  webServer: {
    command: "RELAY_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/relay_e2e_playwright RELAY_SESSION_SECRET=e2e-session-secret RELAY_ENCRYPTION_KEY=e2e-encryption-key RELAY_ADMIN_PASSWORD=relay-e2e RELAY_ALLOW_SIGNUP=false NEXT_PUBLIC_RELAY_URL=http://127.0.0.1:3211 pnpm exec tsx scripts/reset-e2e.ts && pnpm build && RELAY_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/relay_e2e_playwright RELAY_SESSION_SECRET=e2e-session-secret RELAY_ENCRYPTION_KEY=e2e-encryption-key RELAY_ADMIN_PASSWORD=relay-e2e RELAY_ALLOW_SIGNUP=false NEXT_PUBLIC_RELAY_URL=http://127.0.0.1:3211 pnpm exec next start --hostname 127.0.0.1 --port 3211",
    url: "http://127.0.0.1:3211/api/health",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
