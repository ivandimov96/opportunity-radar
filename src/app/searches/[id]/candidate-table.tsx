"use client";
/**
 * The results list with row selection and bulk saving. Rows are rendered
 * from server data; selection lives here; saving posts the chosen ids to a
 * server action. Sorting and paging are links (shared table components).
 *
 * Layout: a fixed-width table from the md breakpoint up, sized so a laptop
 * screen (≈1,200 px of content beside the sidebar) shows every column
 * without horizontal scrolling: business (name, badges, category, address),
 * contact, lead (score + data completeness), sources + when found, status.
 * Below md the same rows render as cards.
 */
import Link from "next/link";
import { useState } from "react";
import { saveCandidatesAction } from "@/app/actions";
import { Badge, Icon, StatusPill, fmtRelative } from "@/components/ui";
import { SortHeader, type SP } from "@/components/table";
import type { TableParams } from "@/lib/table";

export interface CandidateRow {
  id: string;
  rank: number;
  name: string;
  category: string | null;
  matchedBy: string[] | null;
  website: string | null;
  websiteDomain: string | null;
  phone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  operatingStatus: string | null;
  brand: string | null;
  kind: string;
  leadScore: number;
  leadReasons: string[] | null;
  completeness: number;
  sources: { provider: string; providerId: string; sourceUrl: string | null; attribution: string; fetchedAt: string | null; matchedBy: string | null }[];
  mergeRule: string | null;
  mergeConfidence: number | null;
  possibleDuplicateOf: string | null;
  businessId: string | null;
  savedVia: string | null;
  createdAt: string;
  business: { id: string; status: string; verdict: string | null; priority: number | null; investigatedAt: string | null; isDemo: boolean } | null;
}

function Meter({ value, title }: { value: number; title: string }) {
  const tone = value >= 70 ? "bg-ok" : value >= 40 ? "bg-warn" : "bg-bad";
  return (
    <div className="h-1 w-full rounded-full bg-surface-3 overflow-hidden" title={title} role="img" aria-label={title}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function NameCell({ r }: { r: CandidateRow }) {
  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        <span className="text-[11px] text-ink-faint tabular-nums shrink-0">{r.rank}.</span>
        {r.businessId ? (
          <Link href={`/businesses/${r.businessId}`} className="row-link truncate max-w-full">
            {r.name}
          </Link>
        ) : (
          <span className="font-medium truncate max-w-full">{r.name}</span>
        )}
        {r.business?.isDemo && <Badge tone="demo">demo</Badge>}
        {r.kind === "chain" && <Badge tone="neutral" title="Chain or franchise">chain</Badge>}
        {r.brand && r.kind !== "chain" && <Badge tone="neutral" title={`Brand: ${r.brand}`}>brand</Badge>}
        {r.operatingStatus === "closed" && <Badge tone="bad" title="The source marks this listing as closed">closed</Badge>}
        {r.possibleDuplicateOf && <Badge tone="warn" title="A similar business nearby was kept separate; review before merging">possible duplicate</Badge>}
        {r.sources.length > 1 && <Badge tone="info" title={`Seen by ${r.sources.length} sources; merged by ${r.mergeRule?.replace(/_/g, " ")} (confidence ${Math.round((r.mergeConfidence ?? 0) * 100)}%)`}>{r.sources.length} sources</Badge>}
      </div>
    </>
  );
}

function Contact({ r, compact = false }: { r: CandidateRow; compact?: boolean }) {
  const cls = compact ? "flex flex-wrap gap-x-3 gap-y-0.5 text-xs" : "text-xs space-y-0.5 min-w-0";
  return (
    <div className={cls}>
      <div className="truncate">
        {r.website ? (
          <a href={r.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 max-w-full">
            <span className="truncate">{r.websiteDomain ?? "website"}</span> <Icon name="external" className="w-3 h-3 shrink-0" />
          </a>
        ) : (
          <span className="text-ink-faint">no website</span>
        )}
      </div>
      <div className="text-ink-muted truncate">{r.phone ?? <span className="text-ink-faint">no phone</span>}</div>
      {r.email && (
        <div className="text-ink-muted truncate">
          <a href={`mailto:${r.email}`}>{r.email}</a>
        </div>
      )}
    </div>
  );
}

function Status({ r }: { r: CandidateRow }) {
  return r.business ? (
    <div className="flex flex-col gap-1 items-start">
      <StatusPill status={r.business.verdict ?? r.business.status} />
      <span className="text-[11px] text-ink-faint">{r.savedVia === "new" ? "saved" : `matched by ${r.savedVia?.replace(/_/g, " ")}`}</span>
    </div>
  ) : (
    <span className="text-xs text-ink-faint">not saved</span>
  );
}

export function CandidateTable({ rows, searchId, basePath, sp, params, providerLabel, firecrawlEnabled }: { rows: CandidateRow[]; searchId: string; basePath: string; sp: SP; params: TableParams; providerLabel: Record<string, string>; firecrawlEnabled: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const unsavedOnPage = rows.filter((r) => !r.businessId).map((r) => r.id);
  const allOn = unsavedOnPage.length > 0 && unsavedOnPage.every((id) => selected.has(id));
  const toggle = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(unsavedOnPage));
  const sortProps = { sp, params, basePath };
  const describe = (r: CandidateRow) => {
    const location = [r.street, r.city, r.region].filter(Boolean).join(", ");
    const category = r.category ? r.category.replace(/_/g, " ") : null;
    return { location, category, refreshed: r.sources.map((s) => s.fetchedAt).filter(Boolean).sort().at(-1) ?? null };
  };
  const sources = (r: CandidateRow) => (
    <div className="flex flex-wrap gap-1">
      {r.sources.map((s) => (
        <a key={`${s.provider}:${s.providerId}`} href={s.sourceUrl ?? undefined} target={s.sourceUrl ? "_blank" : undefined} rel="noreferrer" className="hover:no-underline" title={`${s.attribution}${s.matchedBy ? ` · ${s.matchedBy}` : ""} · id ${s.providerId}`}>
          <Badge tone="neutral">{providerLabel[s.provider] ?? s.provider}</Badge>
        </a>
      ))}
    </div>
  );

  return (
    <form action={saveCandidatesAction}>
      <input type="hidden" name="searchId" value={searchId} />
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="candidateId" value={id} />
      ))}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 flex-wrap px-4 py-2.5 bg-accent-soft/40 border-b border-line text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <button className="btn btn-sm btn-primary">
            <Icon name="plus" /> Save selected
          </button>
          <label className={`flex items-center gap-1.5 text-xs ${firecrawlEnabled ? "" : "opacity-60"}`} title={firecrawlEnabled ? "Queue the saved businesses for website research" : "Research needs FIRECRAWL_API_KEY"}>
            <input type="checkbox" name="investigate" value="on" disabled={!firecrawlEnabled} className="accent-[var(--accent)]" /> and research them
          </label>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {/* Wide screens: a fixed-layout table that always fits the card's width. (`table` is also Tailwind's display utility, so the breakpoint switch sits on a wrapper.) */}
      <div className="hidden md:block">
      <table className="table table-fixed w-full">
        <colgroup>
          <col className="w-9" />
          <col />
          <col className="w-[200px] xl:w-[230px]" />
          <col className="w-[92px]" />
          <col className="w-[150px] hidden lg:table-column" />
          <col className="w-[128px]" />
        </colgroup>
        <thead>
          <tr>
            <th>
              <input type="checkbox" checked={allOn} onChange={toggleAll} disabled={!unsavedOnPage.length} aria-label="Select every unsaved business on this page" className="accent-[var(--accent)]" />
            </th>
            <SortHeader label="Business" field="name" defaultDir="asc" {...sortProps} />
            <th>Contact</th>
            <SortHeader label="Lead" field="lead" {...sortProps} />
            <SortHeader label="Source · found" field="discovered" className="hidden lg:table-cell" {...sortProps} />
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = describe(r);
            return (
              <tr key={r.id} className={selected.has(r.id) ? "bg-accent-soft/20" : ""}>
                <td className="align-top pt-3.5">{!r.businessId && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} className="accent-[var(--accent)]" />}</td>
                <td className="min-w-0">
                  <NameCell r={r} />
                  <div className="text-xs text-ink-faint truncate" title={[d.category, r.matchedBy?.join("; "), d.location].filter(Boolean).join(" · ")}>
                    {d.category ?? "category unknown"}
                    {d.location ? ` · ${d.location}` : ""}
                  </div>
                </td>
                <td className="min-w-0">
                  <Contact r={r} />
                </td>
                <td>
                  <div className="text-sm font-semibold tabular-nums leading-tight" title={r.leadReasons?.join(", ") ?? undefined}>
                    {r.leadScore}
                  </div>
                  <div className="mt-1.5">
                    <Meter value={r.completeness} title={`Data completeness ${r.completeness}% (name, coordinates, street, city, phone, website, email)`} />
                  </div>
                </td>
                <td className="hidden lg:table-cell">
                  {sources(r)}
                  <div className="text-[11px] text-ink-faint mt-1 truncate" title={d.refreshed ? `Source record read ${fmtRelative(d.refreshed)}` : undefined}>
                    found {fmtRelative(r.createdAt)}
                  </div>
                </td>
                <td>
                  <Status r={r} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {/* Narrow screens: one card per business. */}
      <ul className="md:hidden divide-y divide-line">
        {rows.map((r) => {
          const d = describe(r);
          return (
            <li key={r.id} className={`p-4 flex gap-3 ${selected.has(r.id) ? "bg-accent-soft/20" : ""}`}>
              <div className="pt-0.5 w-4 shrink-0">{!r.businessId && <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} className="accent-[var(--accent)]" />}</div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <NameCell r={r} />
                <div className="text-xs text-ink-faint">
                  {d.category ?? "category unknown"}
                  {d.location ? ` · ${d.location}` : ""}
                </div>
                <Contact r={r} compact />
                <div className="flex items-center gap-3 flex-wrap text-xs">
                  <span className="font-semibold tabular-nums" title={r.leadReasons?.join(", ") ?? undefined}>
                    Lead {r.leadScore}
                  </span>
                  <span className="text-ink-faint">data {r.completeness}%</span>
                  <span className="text-ink-faint">found {fmtRelative(r.createdAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  {sources(r)}
                  <Status r={r} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </form>
  );
}
