import { exportBusinessesCsv } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const csv = exportBusinessesCsv();
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="businesses-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
