// Exercises a real OpenStreetMap discovery on a deployed instance through the UI.
import { chromium } from "@playwright/test";
const base = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${base}/searches/new`, { waitUntil: "networkidle" });
await page.locator('input[name="name"]').fill("Vercel live check");
await page.locator('input[name="maxResults"]').fill("5");
await page.locator('input[name="city"]').fill("Round Rock");
await page.getByRole("button", { name: /Start discovery/ }).click();
await page.waitForURL(/\/searches\//, { timeout: 60_000 });
const url = page.url();
let status = "";
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(3000);
  await page.goto(url, { waitUntil: "networkidle" });
  const text = await page.locator("body").innerText();
  status = /Done|Failed/.exec(text)?.[0] ?? "pending";
  if (status !== "pending") {
    console.log(status, "|", text.split("\n").filter((l) => /Found|new ·|Overpass|OpenStreetMap|reported problems|failed/i.test(l)).slice(0, 6).join(" | "));
    const rows = await page.locator("table tbody tr").count();
    console.log("rows:", rows);
    break;
  }
}
if (status === "pending") console.log("still pending after 2 minutes");
await browser.close();
