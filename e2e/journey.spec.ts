/**
 * Main user journey in demo mode (no credentials):
 * load demo data -> inspect search -> open business profile -> review findings,
 * opportunities, scores -> edit & approve an outreach draft -> update pipeline
 * -> record a validation signal -> see it on the patterns page -> data persists.
 */
import { expect, test } from "@playwright/test";

test("end-to-end demo journey", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("ANTHROPIC_API_KEY")).toBeVisible();

  // Load demo data
  await page.getByRole("button", { name: /Load demo data/ }).first().click();
  await page.waitForURL(/\/searches$/);
  await page.getByRole("link", { name: /DEMO — Auto repair/ }).click();
  await expect(page.getByText("This search returned synthetic businesses")).toBeVisible();
  await expect(page.getByRole("cell", { name: /Barton Creek Auto Care/ })).toBeVisible();

  // Open the richest demo business
  await page.getByRole("link", { name: "Barton Creek Auto Care (Demo)" }).click();
  await expect(page.getByText("Demo data.")).toBeVisible();
  await expect(page.getByText("Contact channels")).toBeVisible();

  // Findings: verified vs unknown are separate
  await page.getByRole("link", { name: /^findings/ }).click();
  await expect(page.getByText("Verified observations (7)")).toBeVisible();
  await expect(page.getByText("Unknowns & assumptions (2)")).toBeVisible();
  await expect(page.getByText("Website asks customers to call to schedule service")).toBeVisible();

  // Opportunities: scores and explanations
  await page.getByRole("link", { name: /^opportunities/ }).click();
  await expect(page.getByText("Automated estimate follow-up for pending approvals")).toBeVisible();
  await expect(page.getByText("Problem hypothesis (to validate)").first()).toBeVisible();
  await page.getByText("Why these scores").first().click();
  await expect(page.getByText("Verified evidence count").first()).toBeVisible();

  // Outreach: edit and approve
  await page.getByRole("link", { name: /^outreach/ }).click();
  await expect(page.getByText("Claims → evidence")).toBeVisible();
  const subject = page.locator('input[name="subject"]');
  await subject.fill("Edited subject line");
  await page.getByRole("button", { name: /Save & approve/ }).click();
  await expect(page.getByText("approved", { exact: true })).toBeVisible();
  await expect(page.locator('input[name="subject"]')).toHaveValue("Edited subject line");
  await expect(page.getByText("edited", { exact: true })).toBeVisible();

  // Pipeline: stage + note + validation signal
  await page.getByRole("link", { name: /^pipeline/ }).click();
  await page.locator('select[name="stage"]').selectOption("contacted");
  await page.getByRole("button", { name: "Update stage" }).click();
  await expect(page.getByText("Stage changed to contacted")).toBeVisible();
  await page.locator('input[name="content"]').fill("Owner replied, interested in estimate follow-up");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Owner replied, interested in estimate follow-up")).toBeVisible();
  await page.locator('select[name="signalType"]').selectOption("confirmed_problem");
  await page.locator('input[name="notes"]').fill("Confirmed estimates go cold");
  await page.getByRole("button", { name: "Record signal" }).click();
  await expect(page.getByText("Validation signal: confirmed_problem")).toBeVisible();

  // Patterns show the category and the real validation signal
  await page.goto("/patterns");
  await expect(page.getByText("Estimate & quote follow-up").first()).toBeVisible();
  await expect(page.getByText("confirmed problem").first()).toBeVisible();

  // Persistence: reload the business page and the pipeline changes are still there
  await page.goto("/businesses");
  await page.getByRole("link", { name: "Barton Creek Auto Care (Demo)" }).click();
  await expect(page.getByText("Problem validated", { exact: true }).first()).toBeVisible(); // confirmed_problem signal advanced the stage

  // Insufficient-evidence case is explicit
  await page.goto("/businesses");
  await page.getByRole("link", { name: "Northside Transmission & Brake (Demo)" }).click();
  await expect(page.getByText(/Insufficient evidence of a commercially compelling/)).toBeVisible();

  // Settings shows live/demo/missing credential distinctions
  await page.goto("/settings");
  await expect(page.getByText("missing credentials").first()).toBeVisible();
  await expect(page.getByText("not implemented").first()).toBeVisible();
});

test("new search form validates and live providers are listed", async ({ page }) => {
  await page.goto("/searches/new");
  await expect(page.getByText("OpenStreetMap", { exact: true })).toBeVisible();
  await expect(page.getByText(/Google Places API \(New\)/)).toBeVisible();
  await expect(page.getByText("GOOGLE_PLACES_API_KEY not set")).toBeVisible();
});
