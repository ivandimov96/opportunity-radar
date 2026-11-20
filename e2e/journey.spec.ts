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
  for (const name of ["Dashboard", "Businesses", "Pipeline", "Settings"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  for (const name of ["To do", "Outreach"]) await expect(nav.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  // Limits and usage are one card of five equal cells, each saying what is left.
  const usage = page.getByLabel("Today and this month");
  await expect(usage.getByRole("link")).toHaveCount(5);
  await expect(usage).toContainText("Search credits");
  await expect(usage).toContainText("left today");
  // Nothing is forgotten: the app plans the next action for every business in play, and the list is one click away.
  await page.goto("/todo");
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
  // A plan made by hand stays exactly as it was written; the app adds its own only where there is none.
  const ownRow = page.locator("li", { hasText: "Review the email and approve it" });
  await expect(ownRow).toContainText("Barton Creek Auto Care");
  await expect(ownRow).toContainText("Mine");
  await expect(page.locator("li", { hasText: "Research failed: try it again or remove the business" })).toContainText("Lone Star Euro Specialists");
  await expect(page.locator("li", { hasText: "No website was found: add it or remove the business" })).toContainText("Quick Lube Corner");
  await page.getByLabel("Kind of work").getByRole("link", { name: /^Decisions/ }).click();
  await expect(page.locator("section li")).toHaveCount(2);
  // The two rows work together: the "When" row now counts decisions only, and every choice keeps its place.
  await expect(page.getByLabel("Show").getByRole("link", { name: /^Any time 2$/ })).toBeVisible();
  await expect(page.getByLabel("Show").getByRole("link", { name: /^Today 2$/ })).toBeVisible();
  await expect(page.getByLabel("Kind of work").getByRole("link", { name: /^My own 1$/ })).toBeVisible();
  // Pressing the chosen filter again clears it.
  await page.getByLabel("Kind of work").getByRole("link", { name: /^Decisions/ }).click();
  await expect(page.getByLabel("Kind of work").getByRole("link", { name: /^Every kind 3$/ })).toHaveAttribute("aria-current", "page");
  // Not today: one dropdown moves it to a later day, and it leaves "Today".
  await ownRow.getByText("Later").click();
  await ownRow.getByRole("button", { name: "Tomorrow" }).click();
  await expect(page.getByRole("heading", { name: "Tomorrow" })).toBeVisible();
  await page.goto("/");
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
  await expect(page.getByRole("link", { name: /^Export$/ })).toHaveAttribute("href", /\/api\/export\?searchId=/);

  // Outreach: one email is ready; nothing is approved, so nothing can be sent yet.
  await page.goto("/");
  await page.getByLabel("Waiting for you").getByRole("link", { name: /^Review/ }).click();
  await expect(page).toHaveURL(/\/outreach\?tab=ready/);
  await expect(page.getByText(/Send approved/)).toHaveCount(0); // nothing is approved yet, so there is nothing to send
  const row = page.locator("tr", { hasText: "Barton Creek Auto Care" });
  await expect(row).toContainText("service@barton-creek-auto-care.example");
  await expect(row).toContainText("Ready");
  await row.getByRole("link", { name: "Review" }).click();

  // Review: the exact email, why this business, the one idea, and the research behind each statement.
  await expect(page.getByRole("heading", { name: /Email to Barton Creek Auto Care/ })).toBeVisible();
  await expect(page.getByText("Why this business")).toBeVisible();
  await expect(page.getByText("Automated estimate follow-up for pending approvals", { exact: true })).toBeVisible();
  await expect(page.getByText("What the email says about them")).toBeVisible();
  await expect(page.getByText("Verified.").first()).toBeVisible();
  await expect(page.getByText(/Independent check: 2 supported/)).toBeVisible();
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
  await page.goto("/settings"); // opens on the first tab that still needs something
  await expect(page.getByRole("heading", { name: "Who is writing?" })).toBeVisible();
  // Four plain tabs, all of them open; the ones the app still needs something from carry a dot.
  await expect(page.getByLabel("Your details").getByRole("link")).toHaveText([/Profile/, /Offer/, /Customers/, /Extras/]);
  await expect(page.getByLabel("Your details").getByLabel("needs your attention")).toHaveCount(3);
  await page.locator('#sender input[name="senderName"]').fill("Ivan Dimov");
  await page.locator('#sender input[name="senderCompany"]').fill("Dimov Software");
  await page.locator('#sender input[name="postalAddress"]').fill("1 Main St, Austin, TX 78701");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  // Saving stays on the tab, and its dot is gone.
  await expect(page.getByRole("heading", { name: "Who is writing?" })).toBeVisible();
  await expect(page.getByLabel("Your details").getByLabel("needs your attention")).toHaveCount(2);
  await expect(page.locator("#signature pre")).toContainText("Ivan Dimov");
  // The signature can be edited: what is typed is used as written, and nothing is added after it.
  const sig = page.locator("#signature");
  // It was saved along with the details, unchanged: it stays automatic, so there is nothing to go back to.
  await expect(sig.getByRole("button", { name: "Use my details" })).toHaveCount(0);
  await sig.getByText("Write my own signature").click();
  await expect(sig.locator("textarea[name=signature]")).toHaveValue(/Ivan Dimov\nDimov Software/);
  await sig.locator("textarea[name=signature]").fill("Ivan\nDimov Software, Austin");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto("/settings?tab=sender&step=you");
  await expect(sig.locator("pre")).toContainText("Ivan\nDimov Software, Austin");
  await expect(sig.locator("pre")).toHaveText("Ivan\nDimov Software, Austin"); // exactly what was typed, nothing after it
  await expect(sig.getByRole("button", { name: "Use my details" })).toBeVisible();
  await expect(sig.locator("textarea")).toHaveCount(1); // one box: the signature itself
  // One button goes back to the signature built from the details.
  await sig.getByRole("button", { name: "Use my details" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto("/settings?tab=sender&step=you");
  await expect(sig.locator("pre")).toContainText("Ivan Dimov");
  await expect(sig.getByRole("button", { name: "Use my details" })).toHaveCount(0);
  await page.goto("/settings?tab=sending");
  await page.locator('#sending select[name="sendWindowStart"]').selectOption("0");
  await page.locator('#sending select[name="sendWindowEnd"]').selectOption("24");
  await page.getByRole("button", { name: "Save changes" }).click();
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

  // Business page: who they are on top, then the work as three steps (research, idea, email); finished steps fold to one line.
  await page.goto("/businesses");
  await page.getByRole("link", { name: "Barton Creek Auto Care" }).click();
  const steps = page.locator('ol[aria-label="Progress"] > li > details > summary');
  // The way from found to won is always in view under the name.
  await expect(page.getByLabel("Journey")).toContainText("Replied");
  await expect(steps).toHaveCount(3);
  await expect(page.locator('select[name="stage"]')).toHaveValue("replied"); // the board move above, persisted
  await expect(page.getByText("Independent auto repair shop offering brake")).toBeHidden(); // research is done: folded
  await steps.nth(0).click();
  await expect(page.getByText("Independent auto repair shop offering brake")).toBeVisible();
  await expect(page.getByText("from their website").first()).toBeVisible(); // where the email address came from
  await expect(steps.nth(1)).toContainText("Automated estimate follow-up for pending approvals"); // the idea, named on its folded step
  await steps.nth(1).click();
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
  await page.getByText("Everything the research found").click();
  await expect(page.getByRole("heading", { name: "Verified facts" })).toBeVisible();
  await expect(page.getByText("How customers book", { exact: true })).toBeVisible();
  await expect(page.getByText("phone only").first()).toBeVisible();
  await expect(page.getByText(/looked for and not found on the site/)).toBeVisible(); // absences are listed once, never as facts
  await steps.nth(2).click();
  await expect(page.getByText("First email")).toBeVisible();
  await expect(page.getByText("Edited subject line").first()).toBeVisible();
  await page.locator('input[name="content"]').fill("Owner called back, wants a demo next week");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Owner called back, wants a demo next week").first()).toBeVisible();
  // The short list holds the latest few; the whole history, with its filters, is one click away.
  await page.getByRole("link", { name: "Show all" }).click();
  await expect(page.locator("section li", { hasText: /Outreach email sent/ }).first()).toBeVisible();

  // A business the research set aside says so, and nothing was written for it.
  await page.goto("/businesses");
  await page.getByRole("link", { name: "Northside Transmission & Brake" }).click();
  await expect(page.getByText("Not a fit").first()).toBeVisible();
  await expect(page.getByText("The research found no idea worth raising with this business.")).toBeVisible();
  await expect(page.getByText("No email yet")).toHaveCount(0); // no idea, so the email step has nothing to do

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

  // Who presses Send: manual until the operator chooses otherwise; choosing it is not yet sending (too few emails sent by hand).
  // Settings is a menu of sections, each about one thing.
  await expect(page.getByLabel("Settings sections").getByRole("link")).toHaveText(["Your details", "Mailbox", "Sending and follow-ups", "Automatic sending", "Do not contact", "Finding and research", "Plan and usage", /^Connections/]);
  await page.getByLabel("Settings sections").getByRole("link", { name: "Automatic sending" }).click();
  await expect(page.locator("#autopilot input[name=sendMode][value=manual]")).toBeChecked();
  await page.locator("#autopilot input[name=sendMode][value=hold]").check();
  await page.locator("#autopilot #holdHours").fill("6");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("#autopilot input[name=sendMode][value=hold]")).toBeChecked();
  await expect(page.locator("#autopilot #holdHours")).toHaveValue("6");
  await expect(page.getByText("Automatic sending is not active yet")).toBeVisible();
  await page.goto("/outreach");
  await expect(page.getByText("Sending on its own is chosen, but not active yet")).toBeVisible();
  // Searching on its own needs a target; a line that names one is kept.
  await page.goto("/settings?tab=automation");
  const finding = page.locator("#automation");
  // Nothing to look for yet: the page says so and points to the profile.
  await expect(finding.getByText("Say who you sell to and where under Your details")).toBeVisible();
  await finding.getByRole("link", { name: "Set it up" }).click();
  // The link leads to the tab it names. "What you sell" is filled in first here.
  await expect(page.getByRole("heading", { name: "Who do you sell to?" })).toBeVisible();
  await page.getByLabel("Your details").getByRole("link", { name: /Offer/ }).click();
  await expect(page.getByRole("heading", { name: "What do you sell?" })).toBeVisible();
  await page.locator("#offer textarea[name=offer]").fill("I build booking tools for small businesses.");
  await page.locator("#offer textarea[name=offerResult]").fill("Fewer missed calls and no-shows.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.getByLabel("Your details").getByRole("link", { name: /Customers/ }).click();
  await expect(page.getByRole("heading", { name: "Who do you sell to?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who do you sell to?" })).toBeVisible();
  // Who you sell to: kinds of business (typed, Enter adds one without saving the page) and a place.
  const audience = page.locator("#audience");
  await expect(audience.getByText("Required").first()).toBeVisible();
  await audience.locator("#targetKindsInput").fill("sign makers");
  await audience.locator("#targetKindsInput").press("Enter");
  await expect(page.getByRole("heading", { name: "Who do you sell to?" })).toBeVisible(); // Enter added the kind; it did not save the step
  await audience.getByRole("button", { name: "Add a place" }).click();
  await audience.getByLabel("Country, place 1").selectOption("GB");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who do you sell to?" })).toBeVisible();
  await expect(page.getByLabel("Your details").getByLabel("needs your attention")).toHaveCount(0);
  await expect(audience.locator("input[name=targetKinds]")).toHaveValue("sign makers");
  await expect(audience.locator("input[name=targetPlaces]")).toHaveValue("GB");
  // The search form offers it with one click.
  await page.goto("/searches/new");
  await page.getByRole("button", { name: "sign makers", exact: true }).click();
  await expect(page.locator("#businessType")).toHaveValue("sign makers");
  // Finding and research reads the same profile; switching the automatic search on is its own decision.
  await page.goto("/settings?tab=automation");
  await expect(finding.getByText("sign makers")).toBeVisible();
  await expect(finding.getByText("United Kingdom")).toBeVisible();
  await finding.getByLabel("Find new businesses on its own").check({ force: true });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(finding.getByLabel("Find new businesses on its own")).toBeChecked();
  // The other cards of the page were not switched off by that save.
  await expect(page.locator("#research input[name=autoResearch]")).toBeChecked();
  // Back to manual, so nothing in this test database sends or searches on its own.
  await finding.getByLabel("Find new businesses on its own").uncheck({ force: true });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(finding.getByLabel("Find new businesses on its own")).not.toBeChecked();
  await page.goto("/settings?tab=autopilot");
  await page.locator("#autopilot input[name=sendMode][value=manual]").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("#autopilot input[name=sendMode][value=manual]")).toBeChecked();
});

test("new search form takes any kind of business in plain words and says what the search will cost", async ({ page }) => {
  await page.goto("/searches/new");
  // No list of sources to choose from: the form says so when search is not set up (no key in the test environment).
  await expect(page.getByRole("checkbox", { name: "Google Maps" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /Foursquare/ })).toHaveCount(0);
  await expect(page.getByText("Search is not set up yet")).toBeVisible();
  // Any kind of business, typed; the cost follows the choices.
  const kind = page.getByLabel("Kind of business");
  await kind.fill("sign makers");
  const cost = page.getByLabel("Expected cost");
  // Only the pages the number asked for needs are read: up to 20 is one page (3 credits), 60 is three.
  await page.getByRole("radio", { name: /Up to 20/ }).click();
  await expect(cost).toContainText("3 search credits");
  await page.getByRole("radio", { name: /Up to 60/ }).click();
  await expect(cost).toContainText("9 search credits");
  await page.getByRole("radio", { name: /Up to 20/ }).click();
  await expect(cost).toContainText("3 search credits");
  await expect(cost).toContainText("Research, up to 20");
  await page.getByRole("radio", { name: /^Save them/ }).click(); // research off: only the search itself costs something
  await expect(cost).toContainText("not started");
  await expect(cost).toContainText("Total");
  await expect(page.locator('input[name="autoInvestigate"]')).toHaveValue("off");
  await expect(page.locator('input[name="autoSave"]')).toHaveValue("on");
  await page.getByRole("radio", { name: /^Show me the list/ }).click();
  await expect(page.locator('input[name="autoSave"]')).toHaveValue("off");
  await page.getByRole("radio", { name: /^Save and research/ }).click();
  await expect(page.locator('input[name="autoInvestigate"]')).toHaveValue("on");
  await expect(page.getByText("The search will look for sign makers, exactly as written.")).toBeVisible();
  // Ideas by field fill the box; typing part of a word offers the matching ones.
  await page.getByRole("tab", { name: "Professional services" }).click();
  await page.getByRole("button", { name: "Accountants" }).click();
  await expect(kind).toHaveValue("accountants");
  await kind.fill("roof");
  await page.getByLabel("Matching ideas").getByRole("button", { name: "Roofers" }).click();
  await expect(kind).toHaveValue("roofers");
  await page.getByRole("button", { name: "Clear the field" }).click();
  await expect(kind).toHaveValue("");
  // Nothing chosen: the summary says what is missing and shows no table of zeros.
  const summary = page.getByLabel("Your choices");
  await expect(summary).toContainText("Choose a kind of business");
  await expect(summary).toContainText("Choose a city");
  await expect(page.getByText("Shown once you choose a kind of business.")).toBeVisible();
  // The full list by field, narrowed by its own filter; a type from it fills the box, and words not in it can still be used.
  await page.getByRole("button", { name: /^All types \(\d+\)$/ }).click();
  await page.getByLabel("Filter all types").fill("hire");
  const all = page.getByLabel("All types", { exact: true });
  await expect(all.getByRole("button", { name: "Skip hire" })).toBeVisible();
  await expect(all.getByRole("button", { name: "Accountants" })).toHaveCount(0);
  await all.getByRole("button", { name: "Marquee hire" }).click();
  await expect(kind).toHaveValue("marquee hire");
  await page.getByLabel("Filter all types").fill("alpaca trekking");
  await page.getByRole("button", { name: "use “alpaca trekking”" }).click();
  await expect(kind).toHaveValue("alpaca trekking");
  await kind.fill("");
  // Typing a word a ready-made type covers offers that type; it is never switched on its own.
  await kind.fill("dentist");
  await page.getByRole("button", { name: "Dental practices" }).first().click();
  await expect(page.getByRole("button", { name: "Orthodontics" })).toBeVisible();
  // Any country: regions load for the chosen one and the city list follows.
  await page.locator('select[name="country"]').selectOption("DE");
  await expect(page.locator('select[name="region"] option', { hasText: "Bavaria" })).toHaveCount(1);
  await page.locator('input[name="city"]').fill("Münch");
  await expect(page.getByRole("option", { name: /Munich|München/ }).first()).toBeVisible();
});

test("where: allowed countries first, city shortcuts, the region follows the city, and a repeat is announced", async ({ page }) => {
  await page.goto("/searches/new");
  const city = page.locator('input[name="city"]');
  const region = page.locator('select[name="region"]');
  // The form opens on the last search (auto repair, Texas) with no city filled in: the city is always chosen anew.
  await expect(city).toHaveValue("");
  // No country limit is set: every country is offered alike, and none carries a warning.
  await expect(page.locator('select[name="country"] optgroup')).toHaveCount(1);
  // The largest cities are one click away; the one already searched for this kind of business is marked, and the next one is offered.
  const largest = page.getByLabel("Largest cities");
  await expect(largest.getByRole("button", { name: /Houston/ })).toBeVisible();
  await expect(largest.getByRole("button", { name: /Austin/ })).toHaveAttribute("title", /Searched .*4 added/);
  await expect(page.getByText("Next one you have not searched for automotive repair:")).toBeVisible();
  await largest.getByRole("button", { name: /Austin/ }).click();
  await expect(city).toHaveValue("Austin");
  await expect(page.getByText(/You searched for automotive repair in Austin/)).toBeVisible();
  await expect(page.getByText(/Austin, Texas, United States · about .* people\. The search covers the whole city: about \d+ km around the centre\./)).toBeVisible();
  await expect(page.locator('input[name="centerLat"]')).not.toHaveValue("");
  // Another kind of business in the same city is not a repeat.
  await page.getByLabel("Kind of business").fill("sign makers");
  await expect(page.getByText(/You searched for/)).toHaveCount(0);
  // Without a state the city list covers the whole country, and picking a city fills its state in.
  await region.selectOption("");
  await city.fill("Minneap");
  await page.getByRole("option", { name: /Minneapolis, Minnesota/ }).click();
  await expect(region).toHaveValue("MN");
  await expect(city).toHaveValue("Minneapolis");
  await expect(page.getByText(/Minneapolis, Minnesota, United States · about/)).toBeVisible();
  // A name typed but not picked is flagged; typing it in full and leaving the field picks it.
  await city.fill("Rochest");
  await expect(page.getByText(/“Rochest” is not picked from the list yet/)).toBeVisible();
  await city.fill("Rochester");
  await expect(page.getByRole("option", { name: /Rochester/ }).first()).toBeVisible();
  await page.getByLabel("Kind of business").click();
  await expect(page.getByText(/Rochester, Minnesota, United States · about/)).toBeVisible();
  // "Around the centre" starts from a distance that fits the city.
  await page.getByText("Around the centre", { exact: true }).click();
  await expect(page.getByText(/The search covers \d+ km around the centre\./)).toBeVisible();
  // The same search in more cities at once: each is a search of its own, and the cost covers all of them.
  await page.getByRole("radio", { name: /Up to 20/ }).click();
  const also = page.getByLabel("Also search");
  await also.getByRole("button", { name: /Saint Paul/ }).click();
  await also.getByRole("button", { name: /Duluth/ }).click();
  const cost = page.getByLabel("Expected cost");
  await expect(cost).toContainText("Finding them, 3 searches");
  await expect(cost).toContainText("9 search credits");
  await expect(page.getByText(/3 cities: Rochester, Saint Paul, Duluth/)).toBeVisible();
  await expect(page.getByLabel("Your choices")).toContainText("Rochester and 2 more cities");
  await expect(page.getByLabel("Your choices")).toContainText("Up to 20 in each city");
  await expect(page.locator('input[name="moreCities"]')).toHaveValue(/Saint Paul.*Duluth/);
  await page.getByRole("button", { name: "Only Rochester" }).click();
  await expect(cost).toContainText("3 search credits");
  // Review limits narrow the list to active businesses.
  await page.getByRole("button", { name: "20+" }).click();
  await expect(page.locator('input[name="minReviews"]')).toHaveValue("20");
  await page.getByRole("button", { name: "4★" }).click();
  await expect(page.locator('input[name="minRating"]')).toHaveValue("4");
  // Any country can be searched and emailed; its region word is its own.
  await page.locator('select[name="country"]').selectOption("GB");
  await expect(page.getByText(/You limited emailing/)).toHaveCount(0);
  await expect(page.locator('label[for="region"]')).toContainText("Nation");
  await page.getByLabel("Largest cities").getByRole("button", { name: /Birmingham/ }).click();
  await expect(city).toHaveValue("Birmingham");
  await expect(region).toHaveValue("ENG");
});

test("loading: the radar greets on arrival only; the dashboard and the to-do list show their outline", async ({ page, context }) => {
  // Just signed in (the test's own sign-in, seconds ago): the first page is announced by the radar.
  const arriving = await (await page.request.get("/")).text();
  expect(arriving).toContain("loader-in");
  // Once the short "just arrived" mark is gone, the dashboard loads with its own outline and no radar.
  await context.clearCookies({ name: "radar_welcome" });
  const working = await (await page.request.get("/")).text();
  expect(working).toContain("Loading the dashboard");
  expect(working).not.toContain("loader-in");
  expect(await (await page.request.get("/todo")).text()).toContain("Loading the to-do list");
  // A visitor (no session) still gets the radar on the front page.
  await context.clearCookies();
  expect(await (await page.request.get("/")).text()).toContain("loader-in");
});

test("businesses: the filters offer what the data holds, and narrow the list", async ({ page }) => {
  await page.goto("/businesses?range=all");
  await page.getByText("More filters").click();
  // Kinds, cities and searches come from the businesses themselves, with how many each has.
  await expect(page.locator('select[name="category"] option')).toContainText(["Any kind", /^car repair \(\d\)$/]);
  await expect(page.locator('select[name="city"] option')).toContainText(["Any city", /^Austin \(\d\)$/]);
  await expect(page.locator('select[name="search"] option')).toContainText(["Any search", /^Auto repair, Austin TX \(fixture\) \(\d\)$/]);
  await page.locator('select[name="result"]').selectOption("qualified");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("Barton Creek Auto Care");
  await expect(page.getByRole("link", { name: /Qualified/ }).filter({ has: page.locator("svg") }).first()).toBeVisible(); // the active filter as a removable pill
  // Contact and next-action filters work on what is known about each business.
  await page.goto("/businesses?range=all&contact=no_email");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await expect(page.locator("tbody tr", { hasText: "Barton Creek Auto Care" })).toHaveCount(0); // the one with an email is not among them
  await page.goto("/businesses?range=all&due=planned");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  // The search box also finds a business by its kind.
  await page.goto("/businesses?range=all&q=car_repair");
  await expect(page.locator("tbody tr", { hasText: "Barton Creek Auto Care" })).toHaveCount(1);
  await page.goto("/businesses?range=all&q=no-such-kind");
  await expect(page.locator("tbody tr")).toHaveCount(0);
});

test("search form validates inline, keeps values and suggests cities by state", async ({ page }) => {
  await page.goto("/searches/new");
  // Sub-category chips narrow the search; each one is its own query, and the cost says so.
  const cost = page.getByLabel("Expected cost");
  await page.getByRole("radio", { name: /Up to 60/ }).click();
  await page.getByRole("button", { name: /Tire shops/ }).click();
  await expect(cost).toContainText("9 search credits");
  await page.getByRole("button", { name: /Transmission specialists/ }).click();
  await expect(cost).toContainText("18 search credits");
  await page.getByRole("button", { name: /Transmission specialists/ }).click();
  // City suggestions follow the selected state (bundled GeoNames data, no network).
  await page.locator('select[name="region"]').selectOption("MN");
  const city = page.locator('input[name="city"]');
  await city.fill("Aus");
  await expect(page.getByRole("option", { name: /Austin, Minnesota/ })).toBeVisible();
  await page.getByRole("option", { name: /Austin, Minnesota/ }).click();
  await expect(city).toHaveValue("Austin");
  await expect(page.locator('input[name="centerLat"]')).toHaveValue(/^43\.66/); // the centre comes with the chosen city
  await page.getByLabel("Around the centre").check();
  // Invalid: no city, bad radius.
  await city.fill("");
  await page.locator('input[name="radiusKm"]').fill("500");
  await page.getByRole("radio", { name: /Up to 40/ }).click();
  await page.getByRole("button", { name: /Start search/ }).click();
  await expect(page.getByText(/things? to fix/).first()).toBeVisible(); // callout at the top and the note under the button
  await expect(page.getByText(/Enter a city: sources are read city by city/)).toBeVisible();
  await expect(page.getByText(/Radius must be at most 100 km/)).toBeVisible();
  await expect(page.locator('input[name="maxResults"]')).toHaveValue("40");
  await expect(page.locator('select[name="region"]')).toHaveValue("MN");
  await expect(page.getByRole("button", { name: /Tire shops/ })).toHaveAttribute("aria-pressed", "true");
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
  await expect(page.getByRole("columnheader", { name: /Score/ })).toBeVisible();
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
