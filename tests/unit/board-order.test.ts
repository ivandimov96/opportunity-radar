import { describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { useTempDb } from "../helpers";
import { businesses, prospects } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ensureProspect, moveOnBoard } from "@/lib/pipeline/prospects";

async function column(db: Awaited<ReturnType<typeof useTempDb>>, stage: string) {
  return (await db.select({ id: prospects.businessId, position: prospects.position }).from(prospects).where(eq(prospects.stage, stage)).orderBy(asc(sql`coalesce(${prospects.position}, 1000000000)`)).all()).map((r) => r.id);
}

describe("pipeline board order", () => {
  it("saves the visible order, keeps hidden cards in place, and moves a card between columns in one go", async () => {
    const db = await useTempDb();
    const ids = ["a", "b", "c", "d", "e"].map(() => newId());
    for (const [i, id] of ids.entries()) {
      await db.insert(businesses).values({ id, name: `Shop ${i}`, nameNormalized: `shop ${i}`, industry: "auto_repair", firstProvider: "csv", priority: 50 - i }).run();
      await ensureProspect(id, "qualified");
    }
    const [a, b, c, d, e] = ids;
    // Full column, reordered: e first.
    await moveOnBoard(e, "qualified", [e, a, b, c, d]);
    expect(await column(db, "qualified")).toEqual([e, a, b, c, d]);

    // A filtered board shows only b and d; the operator puts d above b. a, c, e keep their places.
    await moveOnBoard(d, "qualified", [d, b]);
    expect(await column(db, "qualified")).toEqual([e, a, d, b, c]); // d moved above b; c keeps its place after b

    // Cross-column move: c lands in Contacted (empty) and leaves Qualified.
    await moveOnBoard(c, "contacted", [c]);
    expect(await column(db, "contacted")).toEqual([c]);
    expect(await column(db, "qualified")).toEqual([e, a, d, b]);

    // Into a column that already has a card: a joins Contacted above c, in the order the operator dropped it.
    await moveOnBoard(a, "contacted", [a, c]);
    expect(await column(db, "contacted")).toEqual([a, c]);
    expect((await db.select().from(prospects).where(eq(prospects.businessId, a)).get())?.stage).toBe("contacted");
  });
});
