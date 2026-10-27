import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://127.0.0.1:3000";
const out = process.argv[3] ?? "before";
const dir = "/private/tmp/claude-501/-Users-ivandimov-Projects-oportunity-radar/1aba5028-a2c3-43ff-9fea-5be21bce1f6b/scratchpad/shots";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
await page.goto(base + "/businesses?demo=only");
const href = await page.locator('a[href^="/businesses/"]').first().getAttribute("href");
const pages = ["/", "/searches", "/searches/new", "/businesses", href, href + "?tab=findings", href + "?tab=opportunities", href + "?tab=outreach", href + "?tab=activity", "/pipeline", "/patterns", "/import", "/settings"];
let i = 0;
for (const p of pages) {
  await page.goto(base + p, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${dir}/${out}-${String(i++).padStart(2, "0")}-${p.replace(/[^a-z0-9]+/gi, "_").slice(0, 40)}.png`, fullPage: true });
}
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
await m.goto(base + href, { waitUntil: "networkidle" });
await m.screenshot({ path: `${dir}/${out}-mobile-business.png`, fullPage: true });
await m.goto(base + "/", { waitUntil: "networkidle" });
await m.screenshot({ path: `${dir}/${out}-mobile-home.png`, fullPage: true });
await browser.close();
console.log("done", pages.length);
