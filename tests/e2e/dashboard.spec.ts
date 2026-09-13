import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

test("operator can sign in, inspect core pages, and create an agent credential", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@relay.local");
  await page.getByLabel("Password").fill("relay-e2e");
  await page.getByRole("button", { name: "Sign in to Relay" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
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

  for (const route of ["/memory", "/connections", "/activity", "/developer", "/settings"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
  }
  await page.goto("/api/health");
  await expect(page.locator("body")).toContainText('"ok":true');
});
