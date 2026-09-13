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

  for (const route of ["/memory", "/connections", "/activity", "/developer", "/settings"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
  }
  await page.goto("/api/health");
  await expect(page.locator("body")).toContainText('"ok":true');
});

test("critical dashboard routes meet the warm local response target", async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  for (const route of ["/", "/agents", "/memory", "/connections", "/activity", "/developer"]) {
    await page.goto(route);
    const samples: number[] = [];
    for (let sample = 0; sample < 10; sample += 1) {
      const started = performance.now();
      const response = await page.request.get(route);
      samples.push(performance.now() - started);
      expect(response.ok()).toBe(true);
    }
    samples.sort((a, b) => a - b);
    const medianMs = samples[4];
    const p95Ms = samples[9];
    console.info(JSON.stringify({ benchmark: route, medianMs, p95Ms, samples: samples.length }));
    expect(p95Ms).toBeLessThan(250);
  }
});
