import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function signIn(page: Page, persona = "owner") {
  await page.goto("/login"); await page.getByLabel("Email").fill(`${persona}@owner-fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("synthetic-owner-password");
  await page.getByRole("button", { name: "Sign in to Relay" }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
}
async function accessible(page: Page) {
  await expect(page).toHaveTitle(/Relay/); await expect(page.getByRole("heading", { name: "Loading your Relay", exact: true })).not.toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
for (const width of [1440, 1024, 768, 390, 320]) {
  test(`Checkpoint B themes, navigation and responsive services at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await signIn(page);
    if (width <= 768) await page.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link")).toHaveText(["Home", "Agents", "Connections", "Activity", "Settings"]);
    if (width <= 768) await page.getByRole("button", { name: "Close menu" }).click();
    for (const theme of ["light", "dark"]) {
      await page.getByLabel("Appearance").selectOption(theme);
      for (const path of ["/", "/agents", "/connections", "/activity", "/advanced"]) {
        await page.goto(path); await expect(page.getByRole("heading", { name: path === "/" ? "Home" : path === "/advanced" ? "Developer tools" : path.slice(1).replace(/^./, (letter) => letter.toUpperCase()), exact: true })).toBeVisible(); await expect(page.getByRole("heading", { name: "Loading your Relay", exact: true })).not.toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-owner-theme", theme);
        await accessible(page);
        if (path === "/agents") {
          const configure = page.getByRole("link", { name: "Configure Sofie" });
          expect(await configure.evaluate((el) => { const range = document.createRange(); range.selectNode(el.firstChild!); return range.getClientRects().length; })).toBe(1);
        }
        if (!process.env.RELAY_OWNER_SKIP_VISUAL) await expect(page).toHaveScreenshot(`checkpoint-b9-${path.slice(1) || "home"}-${width}-${theme}.png`, { fullPage: true });
      }
    }
  });
}

test("Agent management, filtering, capability preview and keyboard disclosure", async ({ page }) => {
  await signIn(page);
  await page.goto("/"); await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.locator("#owner-content")).toBeFocused();
  await page.goto("/agents"); await page.getByRole("textbox", { name: "Search agents", exact: true }).fill("Sofie"); await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("link", { name: "Configure Sofie" }).click(); await expect(page.getByRole("heading", { name: "Sofie", exact: true })).toBeVisible();
  for (const tab of ["Overview", "Capabilities", "Connections", "Activity", "Security"]) { await page.getByRole("navigation", { name: "Agent sections" }).getByRole("link", { name: tab, exact: true }).click(); await accessible(page); }
  await page.goto("/activity?status=DENIED"); const summary = page.locator(".activity-record > summary").first(); await summary.focus(); await page.keyboard.press("Enter");
  await expect(page.getByText("Denied — this operation was not allowed.", { exact: true })).toBeVisible();
  await page.getByText("View technical details", { exact: true }).click(); await expect(page.getByText("Audit reference", { exact: true })).toBeVisible();
  await page.getByLabel("Search activity").fill("no-matching-resource"); await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("heading", { name: "No activity matches these filters" })).toBeVisible();
  for (const section of ["account", "security", "connections", "preferences", "capabilities", "notifications", "privacy", "advanced"]) { await page.goto(`/settings?section=${section}`); await accessible(page); }
  await page.goto("/settings?section=capabilities"); await expect(page.getByText("INACTIVE PREVIEW", { exact: true })).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);
});

test("empty states, authentication, member isolation and V2 authority stay intact", async ({ page }) => {
  for (const route of ["/advanced", "/agents/new", "/settings?section=capabilities", "/advanced/health", "/factory"]) { await page.goto(route); await expect(page).toHaveURL(/\/login$/); }
  expect((await page.request.get("/api/agents")).status()).toBe(401);
  await signIn(page, "empty"); await expect(page.getByRole("heading", { name: "No Agents are connected yet" })).toBeVisible(); await accessible(page);
  await page.goto("/activity"); await expect(page.getByRole("heading", { name: "No activity yet" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click(); await expect(page).toHaveURL(/\/login$/);
  await signIn(page, "member"); await page.goto("/advanced"); await expect(page.getByText("an account member", { exact: false })).toBeVisible();
  expect((await page.request.post("/api/v2/operator/factory", { headers: { origin: new URL(page.url()).origin }, data: { operation: "read", input: {} } })).status()).toBe(403);
  expect(await (await page.request.get("/api/agents")).json()).toMatchObject({ agents: [] });
  expect((await page.request.get("/api/agents/agt_owner_fixture_sofie")).status()).toBe(404);
  await page.goto("/agents/agt_owner_fixture_sofie"); await expect(page.getByText("This page could not be found.")).toBeVisible();
  await page.goto("/"); await page.getByRole("button", { name: "Sign out", exact: true }).click(); await signIn(page, "operator");
  await page.goto("/v2"); await expect(page.locator(".v2-operator")).toContainText("OPERATOR");
  expect((await page.request.post("/api/v2/operator/factory", { headers: { origin: new URL(page.url()).origin }, data: { operation: "read", input: {} } })).status()).toBe(403);
});

test("existing Advanced routes stay reachable without live provider probes", async ({ page }) => {
  await signIn(page); await page.setViewportSize({ width: 320, height: 900 });
  for (const [path, heading] of [["/developer", "Relay MCP"], ["/factory", "MyFactory"], ["/events", "Events & inbox"], ["/memory", "Memory"], ["/sandboxes", "Sandboxes"], ["/browsers", "Browsers"], ["/advanced/health", "System health"], ["/advanced/agents", "Agent administration"], ["/advanced/connections", "Connection setup"], ["/agents/agt_owner_fixture_sofie/advanced", "Sofie"]]) {
    await page.goto(path); await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible(); await accessible(page);
  }
});

test("connection controls stay outside setup; failures and retries are announced", async ({ page }) => {
  await signIn(page, "connection"); await page.setViewportSize({ width: 320, height: 900 }); await page.goto("/connections");
  await expect(page.getByLabel("Fine-grained personal access token")).not.toBeVisible();
  const methods: string[] = []; let release: (() => void) | undefined; const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/connections/github", async (route) => { methods.push(route.request().method()); if (methods.length === 1) { await pending; await route.fulfill({ status: 502, json: { error: { message: "Synthetic connection check failed." } } }); } else await route.fulfill({ json: { ok: true } }); });
  const check = page.getByRole("button", { name: "Test connection", exact: true }); const disconnect = page.getByRole("button", { name: "Disconnect", exact: true });
  await check.focus(); await page.keyboard.press("Enter"); await expect(check).toBeDisabled(); await expect(disconnect).toBeDisabled(); release!();
  await expect(page.getByRole("status")).toHaveText("Synthetic connection check failed."); await check.click(); await expect(page.getByRole("status")).toHaveText("GitHub connection is healthy.");
  await disconnect.click(); await expect(page.getByRole("status")).toHaveText("GitHub disconnected."); expect(methods).toEqual(["POST", "POST", "DELETE"]); await accessible(page);
  await page.goto("/advanced/connections"); const table = page.getByRole("region", { name: "Recent connection activity" });
  for (const badge of await page.locator(".connection-summary .status").all()) expect(await badge.evaluate((el) => { const range = document.createRange(); range.selectNodeContents(el); return range.getClientRects().length; })).toBe(1);
  await table.focus(); await page.keyboard.press("ArrowRight"); await expect.poll(() => table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
});

test("new Agent starts with zero grants and mutations retain input after an error", async ({ page }) => {
  await signIn(page); await page.goto("/agents/new"); let payload: Record<string, unknown> | undefined;
  await page.route("**/api/agents", async (route) => { payload = route.request().postDataJSON(); await route.fulfill({ status: 503, json: { error: "Synthetic unavailable service" } }); });
  await page.getByLabel("Agent name").fill("Bounded assistant"); await page.getByLabel("Purpose", { exact: true }).fill("Local browser fixture"); await page.getByRole("button", { name: "Create Agent", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Synthetic unavailable service"); expect(payload?.capabilities).toEqual([]);
  await expect(page.getByLabel("Agent name")).toHaveValue("Bounded assistant"); await accessible(page);
  await page.goto("/agents/agt_owner_fixture_sofie?tab=capabilities");
  await page.route("**/api/agents/*/capabilities/*", async (route) => route.fulfill({ status: 403, json: { code: "CAPABILITY_DENIED", message: "Synthetic canonical denial" } }));
  await page.getByRole("button", { name: "Allow memory.read", exact: true }).click(); await expect(page.getByText("Synthetic canonical denial", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow memory.read", exact: true })).toBeEnabled();
});


test("Home metrics link to matching views and Agent state stays evidence based", async ({ page }) => {
  await signIn(page);
  const destinations = [
    ["Total agents", "/agents", "Agents"], ["Enabled agents", "/agents?status=ACTIVE", "Agents"],
    ["Running operations", "/v2/tasks?status=RUNNING", "Tasks"], ["Pending approvals", "/v2/approvals?status=PENDING", "Approval center"],
    ["Failed operations", "/activity?status=FAILED", "Activity"], ["Connected services", "/connections?state=CONNECTED", "Connections"],
  ];
  for (const [label, destination, heading] of destinations) {
    await page.goto("/"); const metric = page.getByRole("link", { name: new RegExp(`^${label}`) });
    await metric.focus(); await page.keyboard.press("Enter"); await expect(page).toHaveURL(new RegExp(destination.replace(/[?]/g, "\\?")));
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    if (label === "Enabled agents") await expect(page.getByLabel("Status", { exact: true })).toHaveValue("ACTIVE");
    if (label === "Running operations") await expect(page.getByText("No running operations", { exact: true })).toBeVisible();
    if (label === "Pending approvals") expect(new URL(page.url()).searchParams.get("asOf")).toMatch(/T.*Z$/);
    if (label === "Failed operations") expect(new URL(page.url()).searchParams.get("since")).toMatch(/T.*Z$/);
    if (label === "Connected services") await expect(page.getByRole("heading", { name: "No connected services" })).toBeVisible();
  }
  await page.goto("/agents"); await expect(page.getByText("ENABLED", { exact: true })).toBeVisible();
  await expect(page.getByText("No credential use recorded", { exact: true })).toBeVisible();
  await expect(page.getByText(/Relay has no live heartbeat/)).toBeVisible();
  await page.goto("/connections");
  await expect(page.getByRole("heading", { name: "Current readiness", exact: true })).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Granted permissions", exact: true })).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Historical activity", exact: true })).toHaveCount(2);
  await page.getByRole("link", { name: "View recorded successes" }).first().click();
  await expect(page).toHaveURL(/provider=GITHUB&status=SUCCESS/);
});

for (const width of [1440, 320]) test(`First-login next steps and empty filters at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await signIn(page, "empty");
  for (const theme of ["light", "dark"]) {
    await page.getByLabel("Appearance").selectOption(theme);
    for (const path of ["/", "/agents", "/connections", "/activity"]) {
      await page.goto(path); await expect(page.getByRole("heading", { name: path === "/" ? "Home" : path.slice(1).replace(/^./, (letter) => letter.toUpperCase()), exact: true })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-owner-theme", theme); await accessible(page);
      if (path === "/") await expect(page.getByRole("heading", { name: "Set up your first Agent" })).toBeVisible();
      if (!process.env.RELAY_OWNER_SKIP_VISUAL) await expect(page).toHaveScreenshot(`checkpoint-b9-empty-${path.slice(1) || "home"}-${width}-${theme}.png`, { fullPage: true });
    }
  }
  await page.goto("/"); await page.getByRole("region", { name: "Set up your first Agent" }).getByRole("link", { name: "Create an Agent", exact: true }).click();
  await expect(page.getByLabel("Agent name")).toBeVisible();
  await expect(page.getByLabel("Allow reading shared memory")).not.toBeChecked();
});
