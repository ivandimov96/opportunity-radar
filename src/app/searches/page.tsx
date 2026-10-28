import Link from "next/link";
import { listSearches } from "@/lib/queries";
import { Badge, Card, Icon, PageHeader, StatusPill, fmtRelative } from "@/components/ui";
import { FilterBar, Pagination, SortHeader, TableEmpty } from "@/components/table";
import { dateBounds, parseTableParams } from "@/lib/table";
import { getPlaybook } from "@/lib/industries";
import { describeFilters } from "@/lib/search-input";
import { seedDemoAction } from "../actions";

const PROVIDER_LABEL: Record<string, string> = { overture: "Overture", osm: "OpenStreetMap", google_places: "Google", tx_permits: "Texas permits", csv: "CSV", demo: "Demo" };

export default async function SearchesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const t = parseTableParams(sp, { defaultSort: "created", sortable: ["created", "name", "results", "status"], pageSize: 50, dateFields: ["createdAt"] });
  const { fromIso, toIso } = dateBounds(t.from, t.to);
  const { rows, total } = await listSearches({ q: t.q || undefined, from: fromIso, to: toIso, sort: t.sort as "created", dir: t.dir, page: t.page, pageSize: t.pageSize });
  const base = "/searches";
  const anyFilter = Boolean(t.q || t.from || t.to);
  return (
    <>
      <PageHeader
        title="Discover"
        subtitle="Each search pulls businesses from the selected sources, ranks them, and merges them into one deduplicated list."
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
      {(total > 0 || anyFilter) && <FilterBar basePath={base} sp={sp} params={t} placeholder="Search by name, city, state or industry" dateFields={[{ key: "createdAt", label: "Created" }]} />}
      <Card padded={false}>
        {rows.length === 0 ? (
          anyFilter ? (
            <TableEmpty icon="search" title="No searches match" description="Change the search text or the date range." action={<Link href={base} className="btn">Reset</Link>} />
          ) : (
            <TableEmpty
              icon="search"
              title="No searches yet"
              description="Start with a city and an industry. Overture Maps and OpenStreetMap need no credentials. Or load synthetic demo data to see the whole workflow."
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
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Search" field="name" sp={sp} params={t} basePath={base} defaultDir="asc" />
                  <th>Industry · filters</th>
                  <th>Location</th>
                  <th>Sources</th>
                  <SortHeader label="Status" field="status" sp={sp} params={t} basePath={base} defaultDir="asc" />
                  <SortHeader label="Businesses" field="results" sp={sp} params={t} basePath={base} className="text-right" />
                  <SortHeader label="Created" field="created" sp={sp} params={t} basePath={base} />
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
                    <td className="text-ink-muted">
                      {getPlaybook(r.industry).label}
                      <div className="text-[11px] text-ink-faint max-w-[260px] truncate" title={describeFilters(r).join(" · ")}>
                        {describeFilters(r).join(" · ")}
                      </div>
                    </td>
                    <td className="text-ink-muted">
                      {[r.city, r.region, r.country].filter(Boolean).join(", ")}
                      {r.stats?.area ? (
                        <div className="text-[11px] text-ink-faint max-w-[220px] truncate" title={r.stats.area}>
                          {r.stats.area}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div className="flex gap-1 flex-wrap">
                        {r.providers.map((p) => (
                          <Badge key={p} tone={p === "demo" ? "demo" : "neutral"}>
                            {PROVIDER_LABEL[p] ?? p}
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
                    <td className="text-xs text-ink-faint whitespace-nowrap" title={r.createdAt}>
                      {fmtRelative(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && <Pagination basePath={base} sp={sp} params={t} total={total} label="searches" />}
      </Card>
    </>
  );
}
