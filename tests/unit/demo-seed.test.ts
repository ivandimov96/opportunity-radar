import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb } from "../helpers";
import { seedDemo } from "@/db/seed-demo";
import { businesses, opportunities, outreachDrafts } from "@/db/schema";
import { stableId } from "@/lib/ids";

describe("demo seed", () => {
  it("produces identical ids on every fresh seed so demo links stay valid", async () => {
    const db1 = await useTempDb();
    const r1 = await seedDemo();
    const b1 = (await db1.select({ id: businesses.id, name: businesses.name }).from(businesses).all()).sort((a, b) => a.name.localeCompare(b.name));
    const o1 = (await db1.select({ id: opportunities.id }).from(opportunities).all()).map((o) => o.id).sort();
    const d1 = (await db1.select({ id: outreachDrafts.id }).from(outreachDrafts).all()).map((o) => o.id);

    const db2 = await useTempDb();
    const r2 = await seedDemo();
    const b2 = (await db2.select({ id: businesses.id, name: businesses.name }).from(businesses).all()).sort((a, b) => a.name.localeCompare(b.name));
    const o2 = (await db2.select({ id: opportunities.id }).from(opportunities).all()).map((o) => o.id).sort();
    const d2 = (await db2.select({ id: outreachDrafts.id }).from(outreachDrafts).all()).map((o) => o.id);

    expect(r1.searchId).toBe(r2.searchId);
    expect(b1).toEqual(b2);
    expect(o1).toEqual(o2);
    expect(d1).toEqual(d2);
    expect(b1[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("re-seeding an already seeded database is idempotent", async () => {
    const db = await useTempDb();
    await seedDemo();
    await seedDemo();
    expect(await db.select().from(businesses).where(eq(businesses.isDemo, true)).all()).toHaveLength(4);
    expect(stableId("x")).toBe(stableId("x"));
    expect(stableId("x")).not.toBe(stableId("y"));
  });
});
