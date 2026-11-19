/**
 * Main operator journey on the seeded test fixture (no credentials, in-memory
 * mailbox): dashboard -> review the email with its evidence -> edit, fail a
 * check, fix, approve -> fill in the sender -> send the batch with one button
 * -> the business moves to "Contacted" -> pipeline board -> business page ->
 * do-not-contact list. Nothing leaves the machine.
 */
import { expect, test, type Locator } from "@playwright/test";

// Every page of the workspace needs a signed-in owner: each test starts by signing in through the form.
test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@radar.example");
  await page.locator("#password").fill("Browser-test-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
});

test("end-to-end journey: review, approve, send, pipeline", async ({ page }) => {
  // Navigation is five items; the dashboard says what is waiting.
  await page.goto("/");
  const nav = page.getByRole("navigation").first();
  for (const name of ["Dashboard", "Businesses", "Outreach", "Pipeline", "Settings"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Patterns" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /1 email to review/ })).toBeVisible(); // the next step, with one button
  await expect(page.getByRole("heading", { name: "Finish setting up" })).toBeVisible(); // no keys in the test environment
  await expect(page.getByLabel("From found to won").getByRole("link", { name: /Found\s*4/ })).toBeVisible();
  await expect(page.getByText("Progress, last 7 days")).toBeVisible(); // the default period
  await page.getByLabel("Date range").selectOption("yesterday");
  await expect(page).toHaveURL(/range=yesterday/);
  await expect(page.getByLabel("From found to won").getByRole("link", { name: /Found\s*0/ })).toBeVisible(); // nothing was found yesterday
  await page.goto("/");

  // A search's results are still one click from Businesses.
  await page.goto("/searches");
  await page.getByRole("link", { name: /Auto repair, Austin TX \(fixture\)/ }).click();
  await expect(page.getByRole("link", { name: "Barton Creek Auto Care" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Export CSV/ })).toHaveAttribute("href", /\/api\/export\?searchId=/);

  // Outreach: one email is ready; nothing is approved, so nothing can be sent yet.
  await page.goto("/");
  await page.getByLabel("Waiting for you").getByRole("link", { name: /^Review/ }).click();
  await expect(page).toHaveURL(/\/outreach\?tab=ready/);
  await expect(page.getByText(/Send approved emails/)).toHaveCount(0); // nothing is approved yet, so there is nothing to send
  const row = page.locator("tr", { hasText: "Barton Creek Auto Care" });
  await expect(row).toContainText("service@barton-creek-auto-care.example");
  await expect(row).toContainText("Ready to review");
  await row.getByRole("link", { name: "Review" }).click();

  // Review: the exact email, why this business, the one idea, and the research behind each statement.
  await expect(page.getByRole("heading", { name: /Email to Barton Creek Auto Care/ })).toBeVisible();
  await expect(page.getByText("Why this business")).toBeVisible();
  await expect(page.getByText("Automated estimate follow-up for pending approvals", { exact: true })).toBeVisible();
  await expect(page.getByText("What the email says about them")).toBeVisible();
  await expect(page.getByText("Verified.").first()).toBeVisible();
  await expect(page.getByText(/Independent check: 2 supported/)).toBeVisible();
  await expect(page.getByText(/If this isn't relevant, just reply "no thanks"/)).toBeVisible(); // the signature, added in code
  const subject = page.locator("#email-subject");
  const body = page.locator("#email-body");
  const original = await body.inputValue();
  // The "Suggest" button sits inside the subject field (off here: no model key in the test environment);
  // suggestions from an earlier press are listed under the field, and clicking one puts it in the field.
  await expect(page.getByRole("button", { name: "Suggest" })).toBeDisabled();
  await page.getByRole("button", { name: "Estimates that follow up?" }).click();
  await expect(subject).toHaveValue("Estimates that follow up?");
  await expect(page.getByText(/not saved yet/)).toBeVisible();
  await subject.fill("Edited subject line");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(subject).toHaveValue("Edited subject line");

  // An edit that states an absence as a fact fails a fixed check and takes the email out of the batch.
  await body.fill(`${original} You don't have online booking.`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("A check failed: have a look before this goes out")).toBeVisible();
  await expect(page.getByText(/States as a fact that the business lacks something/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve anyway" })).toBeVisible();
  await body.fill(original);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("A check failed: have a look before this goes out")).toHaveCount(0);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(/Approved: it goes out with the next batch/)).toBeVisible();

  // Sending is refused until the sender is known; the summary says exactly what is missing.
  await page.goto("/outreach/send");
  await expect(page.getByText("Nothing can be sent right now")).toBeVisible();
  await expect(page.getByText(/add your name, a postal address/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Send 1 email/ })).toBeDisabled();

  // Settings: sender, sending hours (any time, so the test does not depend on the clock), the test mailbox.
  await page.goto("/settings?tab=mailbox");
  await expect(page.locator("#mailbox")).toContainText("Connected");
  await expect(page.locator("#mailbox")).toContainText("in-memory test mailbox");
  await page.goto("/settings"); // opens on "You"
  await page.locator('#sender input[name="senderName"]').fill("Ivan Dimov");
  await page.locator('#sender input[name="senderCompany"]').fill("Dimov Software");
  await page.locator('#sender input[name="postalAddress"]').fill("1 Main St, Austin, TX 78701");
  await page.locator("#sender").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.locator("#signature pre")).toContainText("Ivan Dimov");
  await page.goto("/settings?tab=mailbox");
  await page.locator('#sending input[name="sendWindowStart"]').fill("0");
  await page.locator('#sending input[name="sendWindowEnd"]').fill("24");
  await page.locator("#sending").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // One button sends the batch: the summary names the recipient, then the email goes out and is recorded.
  await page.goto("/outreach/send");
  await expect(page.getByText("1 email will be sent")).toBeVisible();
  await expect(page.getByText("service@barton-creek-auto-care.example")).toBeVisible();
  await page.getByRole("button", { name: /Send 1 email/ }).click();
  await expect(page).toHaveURL(/\/outreach\?tab=sent/);
  await expect(page.getByText(/1 email queued/)).toBeVisible();
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.locator('tr[data-status="sent"]').count();
      },
      { timeout: 30_000 },
    )
    .toBe(1);
  await page.locator("tr", { hasText: "Barton Creek Auto Care" }).getByRole("link", { name: "Open" }).click();
  await expect(page.getByText("What happened to this email")).toBeVisible();
  for (const step of ["Queued", "Handed to the mailbox", "Sent"]) await expect(page.locator("ol li", { hasText: step }).first()).toBeVisible();
  await expect(page.locator("#email-body")).toHaveAttribute("readonly", ""); // a sent email can no longer be edited
  await page.goto("/outreach/send");
  await expect(page.getByText("No email is approved yet.")).toBeVisible(); // nothing is left to send twice

  // Pipeline: sending moved the business to "Contacted"; machine stages are counters, not columns.
  await page.setViewportSize({ width: 1500, height: 1100 }); // wide enough for five columns of the board side by side
  await page.goto("/pipeline");
  // Every stage is a column, all in one row that scrolls sideways.
  await expect(page.getByRole("group", { name: "Stages" })).toBeVisible();
  for (const stage of ["qualified", "ready_to_contact", "contacted", "replied", "meeting_scheduled", "proposal_sent", "won", "lost"]) await expect(page.locator(`section[data-stage="${stage}"]`)).toHaveCount(1);
  await expect(page.locator('section[data-stage="discovered"]')).toHaveCount(0);
  const card = page.locator("article[data-business]", { hasText: "Barton Creek Auto Care" });
  const inStage = (stage: string) => page.locator(`section[data-stage="${stage}"]`).locator(card);
  const settled = () => page.waitForFunction(() => !document.querySelector("[data-saving]"));
  // The board uses pointer sensors with an activation distance: drag in small steps, like a hand would.
  const drag = async (from: Locator, to: Locator, yOffset = 120) => {
    await to.evaluate((el) => el.scrollIntoView({ inline: "center", block: "nearest" }));
    await page.waitForTimeout(100);
    const a = (await from.boundingBox())!;
    const b = (await to.boundingBox())!;
    const [sx, sy, tx, ty] = [a.x + a.width / 2, a.y + 12, b.x + b.width / 2, b.y + yOffset];
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(sx + ((tx - sx) * i) / 12, sy + ((ty - sy) * i) / 12);
    await page.mouse.up();
  };
  await expect(inStage("contacted")).toBeVisible();
  await drag(card, page.locator('section[data-stage="meeting_scheduled"]'));
  await expect(inStage("meeting_scheduled")).toBeVisible();
  await settled();
  await page.reload();
  await expect(inStage("meeting_scheduled")).toBeVisible();
  // Two quick drags in a row (the second starts while the first is still saving): the last one wins and persists.
  await drag(card, page.locator('section[data-stage="proposal_sent"]'));
  await expect(inStage("proposal_sent")).toBeVisible(); // landed (its save may still be running)
  await page.waitForTimeout(200); // the drop animation
  await drag(card, page.locator('section[data-stage="lost"]'));
  await expect(inStage("lost")).toBeVisible();
  await settled();
  await page.reload();
  await expect(inStage("lost")).toBeVisible();
  // On a laptop a card carries no stage menu and nothing appears on hover: it is moved by dragging.
  await card.hover();
  await expect(card.getByLabel(/Move Barton Creek Auto Care/)).toBeHidden();
  await drag(card, page.locator('section[data-stage="proposal_sent"]'));
  await expect(inStage("proposal_sent")).toBeVisible();
  await settled();
  // An exact place: with two other businesses in "Replied", the card is dropped between them and stays there.
  for (const name of ["Lone Star Euro Specialists", "Quick Lube Corner"]) {
    await page.goto("/businesses?range=all");
    await page.getByRole("link", { name }).first().click();
    await page.getByRole("link", { name: /^Activity/ }).click();
    await page.getByLabel("Move to stage").selectOption("replied");
    await page.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByLabel("Move to stage")).toHaveValue("replied");
  }
  await page.goto("/pipeline?range=all");
  const repliedNames = () => page.locator('section[data-stage="replied"] article[data-business]').evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")?.split(",")[0]));
  expect(await repliedNames()).toHaveLength(2);
  const [firstReplied, secondReplied] = (await repliedNames()) as string[];
  // Carried over the cards of "Replied" and dropped among them: it lands where the gap showed, not at the end, and that place is saved.
  await drag(card, page.locator('section[data-stage="replied"] article[data-business]').nth(0), 10);
  await expect(inStage("replied")).toBeVisible();
  await settled();
  const placed = (await repliedNames()) as string[];
  expect(placed).toHaveLength(3);
  expect(placed.indexOf("Barton Creek Auto Care")).toBeLessThan(2); // among the cards, not after the last one
  expect(placed.filter((n) => n !== "Barton Creek Auto Care")).toEqual([firstReplied, secondReplied]); // the others kept their order
  await page.reload();
  expect(await repliedNames()).toEqual(placed);
  // Let go outside every stage: nothing moves.
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2, box.y + 12 - i * 3);
  await page.mouse.move(box.x + box.width / 2, 5);
  await page.mouse.up();
  expect(await repliedNames()).toEqual(placed);
  await page.goto("/pipeline"); // back to the default period for what follows
  await expect(inStage("replied")).toBeVisible();
  await settled();
  await page.reload();
  await expect(inStage("replied")).toBeVisible();
  // The pipeline page keeps a move history, automatic moves included.
  await page.getByRole("link", { name: /^History/ }).click(); // the whole process across businesses, by day
  await expect(page).toHaveURL(/view=history/);
  await expect(page.getByText("What happened, last 7 days")).toBeVisible();
  await page.getByRole("link", { name: /^Stage moves \d+$/ }).click(); // narrowed to one kind of event
  const latestMove = page.locator('section[aria-label="Today"] li').first();
  await expect(latestMove).toContainText("Barton Creek Auto Care");
  await expect(latestMove).toContainText("Replied");
  await expect(latestMove).toContainText("moved on the pipeline board");
  await expect(page.locator('section[aria-label="Today"] li', { hasText: "outreach email sent" }).first()).toContainText("automatic");

  // Business page: the overview (what they do, the one idea and what it rests on), then research, emails, notes.
  await page.goto("/businesses");
  await page.getByRole("link", { name: "Barton Creek Auto Care" }).click();
  await expect(page.getByText("Next step", { exact: true })).toBeVisible();
  await expect(page.locator('select[name="stage"]')).toHaveValue("replied"); // the board move above, persisted
  await expect(page.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("href", /tab=opportunities/);
  await expect(page.getByText("Independent auto repair shop offering brake")).toBeVisible();
  await expect(page.getByText("published on their website")).toBeVisible(); // where the email address came from
  await expect(page.getByText("Automated estimate follow-up for pending approvals", { exact: true })).toBeVisible();
  await expect(page.getByText("The one idea to raise")).toBeVisible();
  // The page leads with the idea, what it is worth and what to ask; the reasoning opens on a click.
  await expect(page.getByLabel("Progress")).toContainText("Emailed");
  await expect(page.getByText("Questions to ask them").first()).toBeVisible();
  await page.getByText("What we could build", { exact: true }).click();
  await page.getByText("Evidence", { exact: true }).click();
  await expect(page.getByText("Not seen on their site.").first()).toBeVisible();
  await expect(page.getByText("Other ideas you could offer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Raise this idea instead" })).toHaveCount(0); // already emailed: the idea that was raised stays
  await page.getByText("How the two scores were calculated").click();
  await expect(page.getByText(/Evidence cited/).first()).toBeVisible();
  await page.getByRole("link", { name: /^Research\d/ }).click(); // the tab: label + count
  await expect(page.getByRole("heading", { name: "Verified facts" })).toBeVisible();
  await expect(page.getByText("How customers book", { exact: true })).toBeVisible();
  await expect(page.getByText("phone only").first()).toBeVisible();
  await expect(page.getByText(/looked for and not found on the site/)).toBeVisible(); // absences are listed once, never as facts
  await page.getByRole("link", { name: /^Emails\d/ }).click();
  await expect(page.getByText("First email")).toBeVisible();
  await expect(page.getByText("Edited subject line").first()).toBeVisible();
  await page.getByRole("link", { name: /^Activity\d/ }).click();
  await page.locator('input[name="content"]').fill("Owner called back, wants a demo next week");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Owner called back, wants a demo next week")).toBeVisible();
  await expect(page.locator("section li", { hasText: /Outreach email sent/ }).first()).toBeVisible();

  // A business the research set aside says so, and nothing was written for it.
  await page.goto("/businesses");
  await page.getByRole("link", { name: "Northside Transmission & Brake" }).click();
  await expect(page.getByText("Not a fit").first()).toBeVisible();
  await page.getByRole("link", { name: /^Emails\d/ }).click();
  await expect(page.getByText("No email yet")).toBeVisible();

  // Remove it for good: the business goes, and it is remembered so a later search leaves it out.
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm.getByRole("heading")).toHaveText("Remove Northside Transmission & Brake?"); // the app's own dialog, not the browser's
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden(); // cancelling does nothing
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page).toHaveURL(/\/businesses\?ok=/);
  await expect(page.getByText(/Northside Transmission & Brake was removed and will be left out of future searches/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Northside Transmission & Brake" })).toHaveCount(0);
  await page.goto("/settings?tab=do-not-contact");
  const removedRow = page.locator("#removed tbody tr", { hasText: "Northside Transmission & Brake" });
  await expect(removedRow).toContainText("northside-transmission.example");
  await expect(removedRow.getByRole("button", { name: "Allow again" })).toBeVisible();
  // A business that was emailed keeps its record: no remove button there.
  await page.goto("/businesses");
  await page.getByRole("link", { name: "Barton Creek Auto Care" }).click();
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);

  // Do-not-contact list: add and remove by hand.
  await page.goto("/settings?tab=do-not-contact");
  await page.locator('#do-not-contact input[name="value"]').fill("Blocked@Example.com");
  await page.locator("#do-not-contact").getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Added to the do-not-contact list.")).toBeVisible();
  const entry = page.locator("#do-not-contact li", { hasText: "blocked@example.com" });
  await expect(entry).toBeVisible();
  await entry.getByRole("button").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.locator("#do-not-contact li", { hasText: "blocked@example.com" })).toHaveCount(0);
  await page.goto("/settings?tab=system");
  await expect(page.getByText("Needs a key").first()).toBeVisible();
});

test("new search form shows Google Maps as the only active source and planned sources that cannot be selected", async ({ page }) => {
  await page.goto("/searches/new");
  const maps = page.getByRole("checkbox", { name: "Google Maps" });
  if (await maps.isEnabled()) await expect(maps).toBeChecked();
  else await expect(page.getByText(/Unavailable here: Set SERPER_API_KEY/)).toBeVisible(); // no key in the test environment
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
  // Only Google Maps is selectable; planned ones are shown but disabled; there is no demo source.
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
  // On a phone the board shows one stage at a time and never scrolls sideways; a card can be moved without dragging.
  await page.goto("/pipeline?range=all");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole("group", { name: "Stages" })).toBeVisible();
  // On a phone each card has a "Move to" menu, since dragging is awkward on a touch screen.
  const phoneCard = page.locator("article[data-business]", { hasText: "Barton Creek Auto Care" });
  await phoneCard.getByLabel(/Move Barton Creek Auto Care/).selectOption("meeting_scheduled");
  await expect(page.locator('section[data-stage="meeting_scheduled"]').locator(phoneCard)).toBeVisible();
  await page.waitForFunction(() => !document.querySelector("[data-saving]"));
});

test("list pages share one table model: search, sort, date range, pagination; system page shows jobs", async ({ page }) => {
  await page.goto("/businesses?pageSize=10");
  await expect(page.getByRole("columnheader", { name: /Priority/ })).toBeVisible();
  await page.locator("th").getByRole("link", { name: "Business" }).click(); // sort by name
  await expect(page).toHaveURL(/sort=name/);
  await expect(page.getByRole("columnheader", { name: /^Business/ })).toHaveAttribute("aria-sort", /ascending|descending/);
  await page.getByRole("textbox", { name: "Search" }).fill("barton");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=barton/);
  await expect(page.getByRole("link", { name: /Barton Creek Auto Care/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^All \d+$/ })).toContainText("1"); // view counts follow the search
  // The period is one dropdown: the last 7 days unless chosen otherwise, applied as soon as it is picked.
  await expect(page.getByLabel("Date range")).toHaveValue("7d");
  await page.getByLabel("Date range").selectOption("month");
  await expect(page).toHaveURL(/range=month/);
  await expect(page.getByRole("link", { name: /Barton Creek Auto Care/ })).toBeVisible();
  await page.getByLabel("Date range").selectOption("custom"); // two day fields appear
  await page.getByLabel("From date").fill("2000-01-01");
  await page.getByLabel("To date").fill("2000-01-02");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/range=custom&from=2000-01-01&to=2000-01-02/);
  await expect(page.getByText(/No businesses match/)).toBeVisible();
  await page.getByRole("link", { name: "Reset" }).click();
  await expect(page.getByLabel("Date range")).toHaveValue("7d");
  await expect(page.getByText(/of \d+ businesses/)).toBeVisible();
  await page.goto("/searches");
  await expect(page.getByLabel("Search")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Created/ })).toBeVisible();
  await page.goto("/system");
  await expect(page.getByRole("heading", { name: "System" })).toBeVisible();
  await expect(page.getByText(/Recent jobs/)).toBeVisible();
  await expect(page.getByText(/discover search|investigate business|send email|No jobs yet/).first()).toBeVisible();
  await expect(page.getByText(/Source health/)).toBeVisible();
});

test.describe("accounts", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("a visitor sees the landing page, cannot open the workspace, and a new account gets no workspace", async ({ page }) => {
    // The shared sign-in of this file ran first: sign out to be a visitor.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Find your next clients. Send the first email with confidence." })).toBeVisible();
    await page.goto("/businesses");
    await expect(page).toHaveURL(/\/login\?next=%2Fbusinesses/);
    // A wrong password says the same thing as an unknown email.
    await page.getByLabel("Email").fill("owner@radar.example");
    await page.locator("#password").fill("not-the-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText("The email or the password is not right.");
    // Signing up: a weak password is refused, a good one creates a member without a workspace.
    await page.goto("/signup");
    await page.getByLabel("Your name").fill("New Person");
    await page.getByLabel("Email").fill("new.person@radar.example");
    await page.locator("#password").fill("longenough");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.locator('p[role="alert"]')).toContainText("at least one letter and one number");
    await page.getByLabel("Your name").fill("New Person");
    await page.locator("#password").fill("Longenough-1");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByRole("heading", { name: "Welcome, New" })).toBeVisible();
    for (const path of ["/", "/businesses", "/settings", "/api/export"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/welcome$/); // no workspace for a member, whatever the address
    }
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("link", { name: "Get started", exact: true })).toBeVisible();
  });
});
