import Link from "next/link";
import { listSearches } from "@/lib/queries";
import { Badge, Card, Empty, PageHeader, StatusBadge, fmtDate } from "@/components/ui";
import { getPlaybook } from "@/lib/industries";
import { seedDemoAction } from "../actions";

export default function SearchesPage() {
  const rows = listSearches();
  return (
    <>
      <PageHeader
        title="Searches"
        subtitle="Each search discovers businesses from the selected providers and merges them into the shared business list."
        actions={
          <>
            <form action={seedDemoAction}>
              <button className="btn">Load demo data</button>
            </form>
            <Link href="/searches/new" className="btn btn-primary">
              New search
            </Link>
          </>
        }
      />
      <Card>
        {rows.length === 0 ? (
          <Empty>No searches yet.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Industry</th>
                <th>Location</th>
                <th>Providers</th>
                <th>Status</th>
                <th>Results</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/searches/${r.id}`}>{r.name}</Link> {r.isDemo && <Badge tone="demo">demo</Badge>}
                  </td>
                  <td>{getPlaybook(r.industry).label}</td>
                  <td>{[r.city, r.region, r.country].filter(Boolean).join(", ")}</td>
                  <td className="text-xs">{r.providers.join(", ")}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>{r.stats ? `${r.stats.total} (${r.stats.created} new, ${r.stats.merged} merged)` : "—"}</td>
                  <td className="text-xs text-ink-muted">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
