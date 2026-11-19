/** Seeds the browser-journey database (DATABASE_PATH) with the fixture. Run by the Playwright web server command. */
import { closeDatabase } from "@/db/client";
import { stableId } from "@/lib/ids";
import { setState } from "@/lib/settings";
import { seedFixture } from "./seed";
import { createUser } from "@/lib/auth";

const r = await seedFixture();
// The owner the browser tests sign in as.
await createUser({ email: "owner@radar.example", password: "Browser-test-1", name: "Test Owner", role: "owner" });
// Subject suggestions as a press of "Suggest" would have stored them, so the browser test can use them without a model call.
const subjects = ["An idea for your estimates", "Estimates that follow up?"];
await setState(`subjects:${stableId("draft:fixture-auto-1:1")}`, { options: subjects, tried: subjects, at: new Date().toISOString() });
console.log(`Seeded fixture search ${r.searchId} with ${r.businessIds.length} businesses into ${process.env.DATABASE_PATH}.`);
closeDatabase();
