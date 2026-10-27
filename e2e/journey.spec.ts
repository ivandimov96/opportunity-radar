/**
 * Main operator journey in demo mode (no credentials):
 * load demo data -> inspect search -> open business profile -> review findings,
 * opportunities, scores -> edit & approve an outreach draft -> update pipeline
 * -> record a validation signal -> see it on the patterns page -> data persists.
 */
import { expect, test } from "@playwright/test";

test("end-to-end demo journey", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Find businesses that genuinely need software/ })).toBeVisible();

  // Load demo data from the empty-state guide
  await page.getByRole("button", { name: /Load demo data/ }).click();
  await page.waitForURL(/\/searches$/);
  await page.getByRole("link", { name: /DEMO — Auto repair/ }).click();
  await expect(page.getByText("These businesses do not exist")).toBeVisible();
  await expect(page.getByRole("link", { name: "Barton Creek Auto Care (Demo)" })).toBeVisible();

  // Open the richest demo business: the workflow stepper and next step are visible
  await page.getByRole("link", { name: "Barton Creek Auto Care (Demo)" }).click();
  await expect(page.getByText("Synthetic demo record").first()).toBeVisible();
  await expect(page.getByText("Next step:")).toBeVisible();
  await expect(page.locator("ol").getByText("In conversation")).toBeVisible();

  // Findings: verified vs unknown are separate, with evidence
  await page.getByRole("link", { name: /^Findings/ }).click();
  await expect(page.getByText("Verified observations · 7")).toBeVisible();
  await expect(page.getByText("Unknowns · 2")).toBeVisible();
  await expect(page.getByText("Website asks customers to call to schedule service")).toBeVisible();

  // Opportunities: scores, hypothesis framing, explanations
  await page.getByRole("link", { name: /^Opportunities/ }).click();
  await expect(page.getByText("Automated estimate follow-up for pending approvals")).toBeVisible();
  await expect(page.getByText("Problem hypothesis").first()).toBeVisible();
  await page.getByText("Why these scores").first().click();
  await expect(page.getByText("Verified evidence count").first()).toBeVisible();

  // Outreach: evidence view, edit and approve
  await page.getByRole("link", { name: /^Outreach/ }).click();
  await expect(page.getByText("Claims → evidence")).toBeVisible();
  await expect(page.locator("mark.claim").first()).toBeVisible();
  await page.locator('input[name="subject"]').fill("Edited subject line");
  await page.getByRole("button", { name: /Approve for sending/ }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(page.locator('input[name="subject"]')).toHaveValue("Edited subject line");
  await expect(page.getByText("edited", { exact: true })).toBeVisible();

  // Pipeline rail: stage, activity note, validation signal
  await page.locator('select[name="stage"]').selectOption("contacted");
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await page.getByRole("link", { name: /^Activity/ }).click();
  await expect(page.getByText("Stage changed to contacted")).toBeVisible();
  await page.locator('input[name="content"]').fill("Owner replied, interested in estimate follow-up");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Owner replied, interested in estimate follow-up")).toBeVisible();
  await page.locator('select[name="signalType"]').selectOption("confirmed_problem");
  await page.locator('input[name="notes"]').fill("Confirmed estimates go cold");
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByText("Validation signal: confirmed_problem")).toBeVisible();

  // Patterns show the category and the real validation signal
  await page.goto("/patterns");
  await expect(page.getByText("Estimate & quote follow-up").first()).toBeVisible();
  await expect(page.getByText("confirmed problem").first()).toBeVisible();

  // Persistence: the stage advanced to validated and survives reload
  await page.goto("/businesses");
  await page.getByRole("link", { name: "Barton Creek Auto Care (Demo)" }).click();
  await expect(page.locator('select[name="stage"]')).toHaveValue("validated");

  // Insufficient-evidence case is explicit
  await page.goto("/businesses");
  await page.getByRole("link", { name: "Northside Transmission & Brake (Demo)" }).click();
  await expect(page.getByText(/Insufficient evidence of a commercially compelling/).first()).toBeVisible();

  // Settings shows live / demo / missing credential distinctions
  await page.goto("/settings");
  await expect(page.getByText("Needs credentials").first()).toBeVisible();
  await expect(page.getByText("Not implemented").first()).toBeVisible();
});

test("new search form lists live providers and credential gaps", async ({ page }) => {
  await page.goto("/searches/new");
  await expect(page.getByText("OpenStreetMap", { exact: true })).toBeVisible();
  await expect(page.getByText(/Google Places API \(New\)/)).toBeVisible();
  await expect(page.getByText(/GOOGLE_PLACES_API_KEY not set/)).toBeVisible();
});

test("mobile layout exposes navigation and the primary action", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/businesses");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("link", { name: /Pipeline/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
});
