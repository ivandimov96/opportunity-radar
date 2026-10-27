import Link from "next/link";
import { listSearches } from "@/lib/queries";
import { Badge, Card, EmptyState, Icon, PageHeader, StatusPill, fmtRelative } from "@/components/ui";
import { getPlaybook } from "@/lib/industries";
import { seedDemoAction } from "../actions";

export default async function SearchesPage() {
  const rows = await listSearches();
  return (
    <>
      <PageHeader
        title="Discover"
        subtitle="Each search pulls businesses from the selected sources and merges them into one deduplicated list."
        actions={
          <>
            <Link href="/import" className="btn">
              <Icon name="upload" /> Import CSV
            </Link>
            <Link href="/searches/new" className="btn btn-primary">
              <Icon name="plus" /> New search
            </Link>
          </>
        }
      />
      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            icon="search"
            title="No searches yet"
            description="Start with a city and an industry. OpenStreetMap needs no credentials. Or load synthetic demo data to see the whole workflow."
            action={
              <>
                <Link href="/searches/new" className="btn btn-primary">
                  Start a search
                </Link>
                <form action={seedDemoAction}>
                  <button className="btn">Load demo data</button>
                </form>
              </>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Search</th>
                  <th>Industry</th>
                  <th>Location</th>
                  <th>Sources</th>
                  <th>Status</th>
                  <th className="text-right">Businesses</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/searches/${r.id}`} className="row-link">
                        {r.name}
                      </Link>{" "}
                      {r.isDemo && <Badge tone="demo">demo</Badge>}
                    </td>
                    <td className="text-ink-muted">{getPlaybook(r.industry).label}</td>
                    <td className="text-ink-muted">{[r.city, r.region, r.country].filter(Boolean).join(", ")}</td>
                    <td>
                      <div className="flex gap-1">
                        {r.providers.map((p) => (
                          <Badge key={p} tone={p === "demo" ? "demo" : "neutral"}>
                            {p === "osm" ? "OpenStreetMap" : p === "google_places" ? "Google" : p}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td>
                      <StatusPill status={r.status} />
                    </td>
                    <td className="text-right tabular-nums">
                      {r.stats ? (
                        <>
                          <span className="font-medium">{r.stats.total}</span>
                          <span className="text-ink-faint text-xs"> · {r.stats.created} new</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-xs text-ink-faint">{fmtRelative(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
