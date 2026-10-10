import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function login(page: Page, persona = "owner") {
  await page.goto("/login"); await page.getByLabel("Email").fill(`${persona}@integration-fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-integration-password");
  await page.getByRole("button", { name: "Sign in to Relay" }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await page.goto("/connections/integrations");
}
test("catalog, search, setup disclosure, reconnect persistence and accessible mobile layout", async ({ page }) => {
  const external: string[] = [];
  await page.route("**/*", async route => { if (!route.request().url().startsWith("http://127.0.0.1:3262")) { external.push(route.request().url()); await route.abort(); } else await route.continue(); });
  await login(page);
  await expect(page.getByRole("heading", { name: "GitHub", exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic Research Agent", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connection setup unavailable" })).toHaveCount(3);
  await page.reload(); await expect(page.getByText("repo:read", { exact: true })).toBeVisible();
  await page.getByLabel("Search integrations").fill("Calendar"); await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Google Calendar", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "GitHub", exact: true })).toHaveCount(0);
  await page.getByLabel("Search integrations").fill("nothing-matches"); await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No integrations match these filters" })).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  }
  await page.screenshot({ path: "test-results/integration-catalog-mobile.png", fullPage: true });
  expect(external).toEqual([]);
});
test("other owner cannot see records or Agent metadata", async ({ page }) => {
  await login(page, "other");
  await expect(page.getByText("Synthetic Research Agent", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No recorded connection.")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Revoke Relay access" })).toHaveCount(0);
});
test("owner revokes locally and refresh retains denial with provider revocation pending", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Revoke Relay access" }).click();
  await expect(page.getByText("Pending — Relay access blocked", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Revoke Relay access" })).toHaveCount(0);
  await expect(page.getByText("Pending — Relay access blocked", { exact: true })).toBeVisible();
  await expect(page.getByText("integration.connection.revoked — LOCAL_DENIAL_PROVIDER_PENDING", { exact: true })).toBeVisible();
});
