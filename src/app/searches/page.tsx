import Link from "next/link";
import { PROVIDER_LABEL } from "@/lib/discovery";
import { listSearches } from "@/lib/queries";
import { Badge, Card, Flash, Icon, PageHeader, StatusPill, fmtRelative } from "@/components/ui";
import { FilterBar, Pagination, SortHeader, TableEmpty } from "@/components/table";
import { dateBounds, parseTableParams } from "@/lib/table";
import { getPlaybook } from "@/lib/industries";
import { describeFilters } from "@/lib/search-input";
import { countryName, regionName } from "@/lib/geo/world";


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
        title="Searches"
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
      <Flash msg={sp.ok} />
      {(total > 0 || anyFilter) && <FilterBar basePath={base} sp={sp} params={t} placeholder="Search by name, kind or city" dateFields={[{ key: "createdAt", label: "Created" }]} />}
      <Card padded={false}>
        {rows.length === 0 ? (
          anyFilter ? (
            <TableEmpty icon="search" title="No searches match" description="Change the search text or the date range." action={<Link href={base} className="btn">Reset</Link>} />
          ) : (
            <TableEmpty
              icon="search"
              title="No searches yet"
              description="Start with an industry, a country, a region and a city. Google Maps finds the businesses; a CSV brings your own list."
              action={
                <>
                  <Link href="/searches/new" className="btn btn-primary">
                    Start a search
                  </Link>
                  <Link href="/import" className="btn">
                    Import a CSV
                  </Link>
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
                  <th>Kind of business</th>
                  <th>Where</th>
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
                      </Link>
                    </td>
                    <td className="text-ink-muted">
                      <span title={describeFilters(r).join(" · ")}>{r.filters?.customCategory || getPlaybook(r.industry).label}</span>
                    </td>
                    <td className="text-ink-muted">
                      {[r.city, r.region ? regionName(r.country, r.region) : null, countryName(r.country)].filter(Boolean).join(", ")}
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
