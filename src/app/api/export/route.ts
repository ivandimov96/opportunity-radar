import { exportBusinessesCsv, exportSearchCsv } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** CSV export: every business, or everything collected for one search (?searchId=). */
export async function GET(req: Request) {
  const searchId = new URL(req.url).searchParams.get("searchId");
  const date = new Date().toISOString().slice(0, 10);
  if (searchId) {
    const out = await exportSearchCsv(searchId);
    if (!out) return new Response("Search not found", { status: 404 });
    const slug = out.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "search";
    return new Response(out.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${slug}-${date}.csv"` } });
  }
  const csv = await exportBusinessesCsv();
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="businesses-${date}.csv"` } });
}
