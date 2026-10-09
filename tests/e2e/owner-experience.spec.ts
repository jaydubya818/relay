import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function signIn(page: Page, persona = "owner") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${persona}@owner-fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-owner-password");
  await page.getByRole("button", { name: "Sign in to Relay" }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
}
async function accessible(page: Page) {
  await expect(page).toHaveTitle(/Relay/);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
for (const width of [1440, 768, 390]) {
  test(`owner journey, accessibility and visual baseline at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);
    const primary = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(primary.getByRole("link")).toHaveText(["Home", "Agents", "Connections", "Activity", "Settings"]);
    await expect(page.getByText("Postgres", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create agent", exact: true })).toHaveCount(0);
    await accessible(page);
    if (!process.env.RELAY_OWNER_SKIP_VISUAL) await expect(page).toHaveScreenshot(`owner-home-${width}.png`, { fullPage: true });
    await primary.getByRole("link", { name: "Agents", exact: true }).click();
    await page.getByRole("link", { name: "Permissions for Sofie" }).click();
    await expect(page.getByRole("heading", { name: "Permissions", exact: true })).toBeVisible();
    await expect(page.getByText("Allowed by grant", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Credentials", { exact: true })).toHaveCount(0);
    await accessible(page);
    await page.getByRole("link", { name: "View all activity" }).click();
    await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    await expect(page.getByText("Read received messages", { exact: true })).toBeVisible();
    await expect(page.getByText("Not allowed", { exact: true }).last()).toBeVisible();
    await accessible(page);
    if (!process.env.RELAY_OWNER_SKIP_VISUAL) await expect(page).toHaveScreenshot(`owner-activity-${width}.png`, { fullPage: true });
    await page.getByText("View technical details", { exact: true }).first().click();
    await expect(page.getByText("Audit reference", { exact: true }).first()).toBeVisible();
    await primary.getByRole("link", { name: "Connections", exact: true }).click();
    await expect(page.getByRole("heading", { name: "GitHub", exact: true })).toBeVisible();
    await expect(page.getByText("Google Workspace", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Fine-grained personal access token")).toHaveCount(0);
    await accessible(page);
    await primary.getByRole("link", { name: "Settings", exact: true }).click();
    await accessible(page);
  });
  test(`empty owner is understandable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, "empty");
    await expect(page.getByRole("heading", { name: "No Agents are connected yet" })).toBeVisible();
    await expect(page.getByText("FAILED", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Needs attention" })).toHaveCount(0);
    await accessible(page);
    if (!process.env.RELAY_OWNER_SKIP_VISUAL) await expect(page).toHaveScreenshot(`empty-home-${width}.png`, { fullPage: true });
    await page.goto("/connections");
    await expect(page.getByRole("heading", { name: "No service connections yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Connect with GitHub|Connect Google/ })).toHaveCount(0);
    await page.goto("/activity");
    await expect(page.getByRole("heading", { name: "No activity yet" })).toBeVisible();
    await page.goto("/activity?status=DENIED");
    await expect(page.getByRole("heading", { name: "No activity matches these filters" })).toBeVisible();
    await accessible(page);
  });
}

test("advanced owner routes remain reachable; disabled configuration is neutral", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Advanced / Developer tools" }).click();
  await expect(page.getByRole("heading", { name: "Developer tools", exact: true })).toBeVisible();
  await accessible(page);
  for (const [route, heading] of [["/developer", "Relay MCP"], ["/factory", "MyFactory"], ["/events", "Events & inbox"], ["/memory", "Memory"], ["/sandboxes", "Sandboxes"], ["/browsers", "Browsers"], ["/advanced/health", "System health"], ["/advanced/agents", "Agent administration"], ["/advanced/connections", "Connection setup"], ["/agents/agt_owner_fixture_sofie/advanced", "Sofie"]]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await accessible(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await accessible(page);
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await page.goto("/advanced/health");
  await expect(page.locator("article").filter({ has: page.getByRole("heading", { name: "V2 runtime actions" }) })).toContainText("DISABLED");
  await expect(page.getByText("FAILED", { exact: true })).toHaveCount(0);
  await accessible(page);
});

test("keyboard navigation and progressive disclosure", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#owner-content")).toBeFocused();
  await page.goto("/activity");
  const details = page.getByText("View technical details", { exact: true }).first();
  await details.focus(); await page.keyboard.press("Enter");
  await expect(page.getByText("Audit reference", { exact: true }).first()).toBeVisible();
});

test("existing member isolation and OWNER-only Factory denial remain enforced", async ({ page }) => {
  await signIn(page, "member");
  await page.goto("/advanced");
  await expect(page.getByText("an account member", { exact: false })).toBeVisible();
  const denied = await page.request.post("/api/v2/operator/factory", { data: { operation: "read", input: {} } });
  expect(denied.status()).toBe(403);
  const agents = await page.request.get("/api/agents");
  expect(await agents.json()).toMatchObject({ agents: [] });
  const foreign = await page.request.get("/api/agents/agt_owner_fixture_sofie");
  expect(foreign.status()).toBe(404);
});

test("canonical operator membership still enters V2 without gaining OWNER-only Factory authority", async ({ page }) => {
  await signIn(page, "operator");
  await page.goto("/v2");
  await expect(page.locator(".v2-operator")).toContainText("OPERATOR");
  const denied = await page.request.post("/api/v2/operator/factory", { data: { operation: "read", input: {} } });
  expect(denied.status()).toBe(403);
});

test("unauthenticated advanced routes and APIs retain authentication", async ({ page }) => {
  for (const route of ["/advanced", "/advanced/health", "/advanced/agents", "/developer", "/factory"]) {
    await page.goto(route); await expect(page).toHaveURL(/\/login$/);
  }
  expect((await page.request.get("/api/agents")).status()).toBe(401);
});
