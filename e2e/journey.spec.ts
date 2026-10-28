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
  // Results table: sources, saved status, export; filters narrow it.
  await expect(page.getByRole("columnheader", { name: /Business/ })).toBeVisible();
  await expect(page.getByText(/Demo data/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Export CSV/ })).toHaveAttribute("href", /\/api\/export\?searchId=/);
  await page.getByLabel("Saved", { exact: true }).selectOption("no");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/No results match these filters/)).toBeVisible();
  await page.getByRole("link", { name: /Reset/ }).click();
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

  // Pipeline board: the confirmed-problem signal above advanced the business to "validated"; a drag moves it on,
  // and the "Move to" control works without a mouse. Both persist.
  await page.goto("/pipeline");
  const card = page.locator("article[data-business]", { hasText: "Barton Creek Auto Care (Demo)" });
  await expect(page.locator('section[data-stage="validated"]').locator(card)).toBeVisible();
  await card.dragTo(page.locator('section[data-stage="won"] > div').last());
  await expect(page.locator('section[data-stage="won"]').locator(card)).toBeVisible();
  await page.reload();
  await expect(page.locator('section[data-stage="won"]').locator(card)).toBeVisible();
  await card.hover(); // the "Move to" control appears on hover on wide screens (always visible on phones)
  await card.getByLabel(/Move Barton Creek Auto Care/).selectOption("in_conversation");
  await expect(page.locator('section[data-stage="in_conversation"]').locator(card)).toBeVisible();
  await page.reload();
  await expect(page.locator('section[data-stage="in_conversation"]').locator(card)).toBeVisible();

  await page.goto("/patterns");
  await expect(page.getByText("Estimate & quote follow-up").first()).toBeVisible();
  await expect(page.getByText("confirmed problem").first()).toBeVisible();

  await page.goto("/businesses");
  await page.getByRole("link", { name: "Barton Creek Auto Care (Demo)" }).click();
  await expect(page.locator('select[name="stage"]')).toHaveValue("in_conversation"); // the board move above, persisted
  await expect(page.getByText("moved on the pipeline board").first()).toBeVisible();

  // No-opportunity verdict is explicit
  await page.goto("/businesses");
  await page.getByRole("link", { name: "Northside Transmission & Brake (Demo)" }).click();
  await expect(page.getByText(/No compelling software opportunity/).first()).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByText("Needs credentials").first()).toBeVisible();
  await expect(page.getByText("Not implemented").first()).toBeVisible();
});

test("new search form shows Google Maps as the only active source and planned sources that cannot be selected", async ({ page }) => {
  await page.goto("/searches/new");
  const maps = page.getByRole("checkbox", { name: "Google Maps" });
  if (await maps.isEnabled()) await expect(maps).toBeChecked();
  else await expect(page.getByText(/Unavailable here: Set SERPAPI_API_KEY/)).toBeVisible(); // no key in the test environment
  await expect(page.getByRole("checkbox", { name: "Overture Maps" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "OpenStreetMap" })).toHaveCount(0);
  for (const name of ["Foursquare Places API", "Web Search APIs", "LinkedIn Sales Navigator"]) {
    const box = page.getByRole("checkbox", { name });
    await expect(box).toBeDisabled();
    await expect(box).not.toBeChecked();
  }
  await expect(page.getByText("New", { exact: true })).toHaveCount(3);
  await expect(page.getByText(/B2B company discovery, account research and sales prospecting/)).toBeVisible();
  await expect(page.getByText(/not selectable/).first()).toBeVisible();
  // Any country: regions load for the chosen one and the city list follows.
  await page.locator('select[name="country"]').selectOption("DE");
  await expect(page.locator('select[name="region"] option', { hasText: "Bavaria" })).toHaveCount(1);
  await page.locator('input[name="city"]').fill("Münch");
  await expect(page.getByRole("option", { name: /Munich|München/ }).first()).toBeVisible();
});

test("search form validates inline, keeps values and suggests cities by state", async ({ page }) => {
  await page.goto("/searches/new");
  // Category chips narrow the search and are reflected in the live summary.
  await page.getByRole("button", { name: /Tire shops/ }).click();
  await expect(page.getByText(/1 of 6 categories/)).toBeVisible();
  // City suggestions follow the selected state (bundled GeoNames data, no network).
  await page.locator('select[name="region"]').selectOption("MN");
  const city = page.locator('input[name="city"]');
  await city.fill("Aus");
  await expect(page.getByRole("option", { name: /Austin, Minnesota/ })).toBeVisible();
  await page.getByRole("option", { name: /Austin, Minnesota/ }).click();
  await expect(city).toHaveValue("Austin");
  await page.getByLabel("Radius around the center").check();
  await expect(page.getByText(/center 43\.6666/)).toBeVisible();
  // Invalid: no city, bad radius.
  await city.fill("");
  await page.locator('input[name="radiusKm"]').fill("500");
  await page.locator('input[name="maxResults"]').fill("7");
  await page.getByRole("button", { name: /Start search/ }).click();
  await expect(page.getByText(/things? to fix/).first()).toBeVisible(); // callout at the top and the note under the button
  await expect(page.getByText(/Enter a city: sources are read city by city/)).toBeVisible();
  await expect(page.getByText(/Radius must be at most 100 km/)).toBeVisible();
  await expect(page.locator('input[name="maxResults"]')).toHaveValue("7");
  await expect(page.locator('select[name="region"]')).toHaveValue("MN");
  await expect(page.getByRole("button", { name: /Tire shops/ })).toHaveAttribute("aria-pressed", "true");
  // Only the two open-data sources are selectable; planned ones are shown but disabled, and demo data is not a source.
  await expect(page.getByRole("checkbox", { name: "Google Maps" })).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: /Foursquare/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Demo data" })).toHaveCount(0);
  await expect(page.getByText("Extras")).toHaveCount(0);
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
