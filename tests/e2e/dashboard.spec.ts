import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@relay.local");
  await page.getByLabel("Password").fill("relay-e2e");
  await page.getByRole("button", { name: "Sign in to Relay" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

test("operator can sign in, inspect core pages, and create an agent credential", async ({ page }) => {
  await signIn(page);
  mkdirSync("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/relay-overview.png", fullPage: true });

  await page.getByRole("link", { name: "Agents" }).click();
  await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible();
  const name = `Browser Agent ${Date.now()}`;
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Description").fill("Created through the Relay dashboard golden path");
  await page.getByRole("button", { name: "Create agent" }).click();
  await expect(page.getByText("Copy this credential now")).toBeVisible();
  await expect(page.locator(".secret")).toContainText("rly_");

  for (const route of ["/memory", "/connections", "/sandboxes", "/browsers", "/events", "/activity", "/developer", "/settings"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
  }
  await page.goto("/connections");
  await expect(page.getByText("Google Workspace", { exact: true }).first()).toBeVisible();
  await page.goto("/sandboxes");
  await expect(page.getByText("docker")).toBeVisible();
  await page.goto("/browsers");
  await expect(page.getByText("https://example.com/")).toBeVisible();
  await page.goto("/events");
  await expect(page.getByText("github.push").first()).toBeVisible();
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await expect(page.getByText("PROCESSED")).toBeVisible();
  await page.goto("/api/health");
  await expect(page.locator("body")).toContainText('"ok":true');
});

test("a new account owner can register and revoke the browser session on logout", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Account name").fill("E2E Account");
  await page.getByLabel("Your name").fill("E2E Owner");
  await page.getByLabel("Email").fill("owner-e2e@example.com");
  await page.getByLabel("Password").fill("e2e-password-long-enough");
  await page.getByRole("button", { name: "Create Relay account" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("No agents yet. Create the first durable identity.")).toBeVisible();
  for (const [route, empty] of [["/sandboxes", "No sandboxes"], ["/browsers", "No active or historical browser sessions"], ["/events", "No events have been ingested"]] as const) {
    await page.goto(route);
    await expect(page.getByText(empty, { exact: false })).toBeVisible();
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Relay" })).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
