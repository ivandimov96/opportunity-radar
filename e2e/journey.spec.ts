/**
 * Main operator journey in demo mode (no credentials):
 * load demo data -> inspect search -> open business profile -> review profile
 * facts, opportunities, scores -> edit & approve an outreach draft -> update
 * pipeline -> record a validation signal -> see it on the patterns page -> persists.
 */
import { expect, test } from "@playwright/test";

test("end-to-end demo journey", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Find businesses that genuinely need software/ })).toBeVisible();

  await page.getByRole("button", { name: /Load demo data/ }).click();
  await page.waitForURL(/\/searches$/);
  await page.getByRole("link", { name: /DEMO — Auto repair/ }).click();
  await expect(page.getByText("These businesses do not exist")).toBeVisible();
  await expect(page.getByRole("link", { name: "Barton Creek Auto Care (Demo)" })).toBeVisible();

  // Profile: stepper, next step, summary, structured facts with evidence, gaps
  await page.getByRole("link", { name: "Barton Creek Auto Care (Demo)" }).click();
  await expect(page.getByText("Synthetic demo record").first()).toBeVisible();
  await expect(page.getByText("Next step:")).toBeVisible();
  await expect(page.locator("ol").getByText("In conversation")).toBeVisible();
  await expect(page.getByText("Independent auto repair shop offering brake")).toBeVisible();
  await expect(page.getByText("How customers book")).toBeVisible();
  await expect(page.getByText("phone only").first()).toBeVisible();
  await expect(page.getByText("Not found on the site").first()).toBeVisible();

  // Opportunities: scores, hypothesis framing, "based on" facts, explanations
  await page.getByRole("link", { name: /^Opportunities/ }).click();
  await expect(page.getByText("Automated estimate follow-up for pending approvals")).toBeVisible();
  await expect(page.getByText("What problem might exist").first()).toBeVisible();
  await expect(page.getByText("What we observed").first()).toBeVisible();
  await expect(page.getByText("How we could validate it").first()).toBeVisible();
  await page.getByText("Why these scores").first().click();
  await expect(page.getByText("Evidence cited").first()).toBeVisible();

  // Outreach: evidence view, edit and approve
  await page.getByRole("link", { name: /^Outreach/ }).click();
  await expect(page.getByText("Claims → evidence")).toBeVisible();
  await expect(page.locator("mark.claim").first()).toBeVisible();
  await page.locator('input[name="subject"]').fill("Edited subject line");
  await page.getByRole("button", { name: /Approve for sending/ }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(page.locator('input[name="subject"]')).toHaveValue("Edited subject line");

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

  await page.goto("/patterns");
  await expect(page.getByText("Estimate & quote follow-up").first()).toBeVisible();
  await expect(page.getByText("confirmed problem").first()).toBeVisible();

  await page.goto("/businesses");
  await page.getByRole("link", { name: "Barton Creek Auto Care (Demo)" }).click();
  await expect(page.locator('select[name="stage"]')).toHaveValue("validated");

  // No-opportunity verdict is explicit
  await page.goto("/businesses");
  await page.getByRole("link", { name: "Northside Transmission & Brake (Demo)" }).click();
  await expect(page.getByText(/No compelling software opportunity/).first()).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByText("Needs credentials").first()).toBeVisible();
  await expect(page.getByText("Not implemented").first()).toBeVisible();
});

test("new search form lists live providers and credential gaps", async ({ page }) => {
  await page.goto("/searches/new");
  await expect(page.getByText("OpenStreetMap", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Google Places API \(New\)/).first()).toBeVisible();
  await expect(page.getByText(/GOOGLE_PLACES_API_KEY not set/)).toBeVisible();
});

test("search form validates inline, keeps values, suggests cities by state, and starts a filtered demo search", async ({ page }) => {
  await page.goto("/searches/new");
  // Sub-type chips narrow the search and are reflected in the live summary.
  await page.getByRole("button", { name: /Tire shops/ }).click();
  await expect(page.getByText(/1 of 6 sub-types/)).toBeVisible();
  // City suggestions follow the selected state (bundled GeoNames data, no network).
  await page.locator('select[name="region"]').selectOption("MN");
  const city = page.locator('input[name="city"]');
  await city.fill("Aus");
  await expect(page.getByRole("option", { name: /Austin, MN/ })).toBeVisible();
  await page.getByRole("option", { name: /Austin, MN/ }).click();
  await expect(city).toHaveValue("Austin");
  await expect(page.getByText(/Center 43\.6666/)).toBeVisible();
  // Invalid: no city, bad radius.
  await city.fill("");
  await page.getByLabel("Radius around the center").check();
  await page.locator('input[name="radiusKm"]').fill("500");
  await page.locator('input[name="maxResults"]').fill("7");
  await page.getByRole("button", { name: /Start discovery/ }).click();
  await expect(page.getByText(/things? to fix/)).toBeVisible();
  await expect(page.getByText(/A radius needs a city/)).toBeVisible();
  await expect(page.getByText(/Radius must be at most 100 km/)).toBeVisible();
  await expect(page.locator('input[name="maxResults"]')).toHaveValue("7");
  await expect(page.locator('select[name="region"]')).toHaveValue("MN");
  await expect(page.getByRole("button", { name: /Tire shops/ })).toHaveAttribute("aria-pressed", "true");
  // Texas registry is only offered for Texas.
  await expect(page.getByRole("checkbox", { name: /Texas sales tax permits/ })).toBeDisabled();
  // Fix: demo source only needs no place.
  await page.getByLabel("Whole city / region area").check();
  await page.getByRole("checkbox", { name: /OpenStreetMap/ }).uncheck();
  for (const name of [/^Overture Maps/, /^Texas sales tax/]) {
    const box = page.getByRole("checkbox", { name });
    if ((await box.count()) && (await box.isEnabled()) && (await box.isChecked())) await box.uncheck();
  }
  await page.getByRole("checkbox", { name: /Demo/ }).check();
  await page.getByRole("checkbox", { name: /Must have a phone number/ }).check();
  await page.getByRole("button", { name: /Start discovery/ }).click();
  await page.waitForURL(/\/searches\/[0-9a-f-]+$/);
  await expect(page.getByText(/phone required/).first()).toBeVisible();
  await expect(page.getByText(/Tire shops/).first()).toBeVisible();
  await expect(page.getByText(/\d+ new · \d+ merged/)).toBeVisible({ timeout: 15000 }); // discovery finished; stats rendered (demo records already exist from the first journey)
  await page.getByText(/Discovery details/).click();
  await expect(page.getByText(/Ranking: \d+ candidate/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Export CSV/ })).toHaveAttribute("href", /\/api\/export\?searchId=/);
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

test("list pages share one table model: search, sort, date range, pagination; system page shows jobs", async ({ page }) => {
  await page.goto("/businesses?pageSize=10");
  await expect(page.getByRole("columnheader", { name: /Priority/ })).toBeVisible();
  await page.locator("th").getByRole("link", { name: "Business" }).click(); // sort by name
  await expect(page).toHaveURL(/sort=name/);
  await expect(page.getByRole("columnheader", { name: /^Business/ })).toHaveAttribute("aria-sort", /ascending|descending/);
  await page.getByLabel("Search").fill("barton");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/q=barton/);
  await expect(page.getByRole("link", { name: /Barton Creek Auto Care/ })).toBeVisible();
  await page.getByLabel("From date").fill("2000-01-01");
  await page.getByLabel("To date").fill("2000-01-02");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/No businesses match/)).toBeVisible();
  await page.getByRole("link", { name: "Reset" }).click();
  await expect(page.getByText(/of \d+ businesses/)).toBeVisible();
  await page.goto("/searches");
  await expect(page.getByLabel("Search")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Created/ })).toBeVisible();
  await page.goto("/system");
  await expect(page.getByRole("heading", { name: "System" })).toBeVisible();
  await expect(page.getByText(/Recent jobs/)).toBeVisible();
  await expect(page.getByText(/discover search|investigate business|No jobs yet/).first()).toBeVisible();
  await expect(page.getByText(/Source health/)).toBeVisible();
});
