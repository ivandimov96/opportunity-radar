"use client";
/**
 * The search form: what to look for, where, which source, which filters, and
 * what happens after discovery. Server-validated (src/lib/search-input.ts); on
 * error the form re-renders with the submitted values and inline messages.
 * Location data is bundled (countries, regions, cities worldwide); the only
 * network calls are to this app's own /api/regions and /api/places.
 *
 * Layout: one column of numbered steps, each a card of equal width, and a
 * sticky summary panel on wide screens that mirrors the choices and holds the
 * submit button (below the steps on narrow screens).
 */
import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSearch, type CreateSearchState } from "@/app/actions";
import { Badge, Callout, Card, Icon } from "@/components/ui";
import type { RawSearchValues } from "@/lib/search-input";
import { suggestIndustries } from "@/lib/discovery/taxonomy";
import { CitySelect, type Suggestion } from "./city-select";

export interface PlaybookOption {
  key: string;
  label: string;
  description: string;
  osmSupported: boolean;
  segments: { key: string; label: string; description: string }[];
}
export interface ProviderOption {
  key: string;
  label: string;
  status: "active" | "internal" | "disabled" | "future";
  description: string;
  futurePurpose?: string;
  available: boolean;
  reason?: string;
}
interface Country {
  code: string;
  name: string;
  continent: string;
}
interface Region {
  code: string;
  name: string;
}

function Field({ label, hint, error, children, optional }: { label: string; hint?: React.ReactNode; error?: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <div className="min-w-0">
      <label className="label">
        {label} {optional && <span className="normal-case font-normal text-ink-faint">(optional)</span>}
      </label>
      {children}
      {error ? <p className="text-xs text-bad mt-1">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

function Toggle({ name, label, hint, defaultChecked, onChange }: { name: string; label: string; hint?: string; defaultChecked: boolean; onChange?: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-line p-3 cursor-pointer hover:bg-surface-2 min-w-0">
      <input type="hidden" name={name} value="off" />
      <input type="checkbox" name={name} value="on" defaultChecked={defaultChecked} onChange={(e) => onChange?.(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
      <span className="text-sm min-w-0">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-ink-muted">{hint}</span>}
      </span>
    </label>
  );
}

function Step({ n, title, description, children, id }: { n: number; title: string; description?: string; children: React.ReactNode; id?: string }) {
  return (
    <Card
      id={id}
      title={
        <span className="flex items-center gap-2.5">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-accent-soft text-accent text-xs font-semibold shrink-0">{n}</span>
          {title}
        </span>
      }
      description={description}
    >
      {children}
    </Card>
  );
}

export function SearchForm(props: { playbooks: PlaybookOption[]; providers: ProviderOption[]; countries: Country[]; initialRegions: Region[]; synonyms: Record<string, string[]>; aiEnabled: boolean; firecrawlEnabled: boolean; defaults: RawSearchValues }) {
  const [state, action, pending] = useActionState<CreateSearchState, FormData>(createSearch, null);
  // Remount the fields whenever the server returns a new state so every input re-initializes from the submitted values.
  const key = state ? JSON.stringify(state.values) : "initial";
  return <SearchFields key={key} {...props} state={state} action={action} pending={pending} />;
}

function SearchFields({ playbooks, providers, countries, initialRegions, aiEnabled, firecrawlEnabled, defaults, state, action, pending }: { playbooks: PlaybookOption[]; providers: ProviderOption[]; countries: Country[]; initialRegions: Region[]; synonyms: Record<string, string[]>; aiEnabled: boolean; firecrawlEnabled: boolean; defaults: RawSearchValues; state: CreateSearchState; action: (fd: FormData) => void; pending: boolean }) {
  const v = state?.values ?? defaults;
  const errors = state?.errors ?? {};
  const [industry, setIndustry] = useState(v.industry);
  const [segments, setSegments] = useState<string[]>(v.segments);
  const [customCategory, setCustomCategory] = useState(v.customCategory);
  const [keywords, setKeywords] = useState(v.keywords);
  const [areaMode, setAreaMode] = useState<"area" | "radius">(v.areaMode);
  const [radiusKm, setRadiusKm] = useState(v.radiusKm);
  const [country, setCountry] = useState(v.country || "US");
  const [regions, setRegions] = useState<Region[]>(initialRegions);
  const [region, setRegion] = useState(v.region.toUpperCase());
  const [city, setCity] = useState(v.city);
  const [center, setCenter] = useState<Suggestion | null>(null);
  const [autoInvestigate, setAutoInvestigate] = useState(v.autoInvestigate);
  const [autoSave, setAutoSave] = useState(v.autoSave);
  const [maxResults, setMaxResults] = useState(v.maxResults);
  const [providersSel, setProvidersSel] = useState<string[]>(v.providers.length ? v.providers : ["google_maps"]);
  const playbook = useMemo(() => playbooks.find((p) => p.key === industry) ?? playbooks[0], [playbooks, industry]);
  const countryName = countries.find((c) => c.code === country)?.name ?? country;
  const regionName = (code: string | null) => regions.find((r) => r.code === code)?.name ?? code ?? "";

  useEffect(() => {
    if (country === defaults.country && initialRegions.length) {
      setRegions(initialRegions);
      return;
    }
    let live = true;
    fetch(`/api/regions?country=${encodeURIComponent(country)}`)
      .then((r) => r.json())
      .then((d: { regions: Region[] }) => live && setRegions(d.regions))
      .catch(() => live && setRegions([]));
    return () => {
      live = false;
    };
  }, [country, defaults.country, initialRegions]);

  const usable = (p: ProviderOption) => p.status === "active" && p.available;
  const effectiveProviders = providersSel.filter((k) => {
    const p = providers.find((x) => x.key === k);
    return p ? usable(p) : false;
  });
  const errorCount = Object.keys(errors).length;
  const suggestion = useMemo(() => {
    const text = playbook.key === "generic" ? customCategory : keywords;
    return suggestIndustries(text).filter((s) => s.key !== industry)[0] ?? null;
  }, [customCategory, keywords, industry, playbook.key]);
  const toggleSegment = (k: string) => setSegments((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const toggleProvider = (k: string) => setProvidersSel((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const byStatus = (st: ProviderOption["status"]) => providers.filter((p) => p.status === st);

  const areaText = !city
    ? "Enter a city to define the area."
    : areaMode === "radius"
      ? `${radiusKm || "?"} km around ${city}${center ? ` (center ${center.lat}, ${center.lon} from the bundled place list)` : " (center resolved when the search runs)"}`
      : `The whole of ${city}${region ? `, ${regionName(region)}` : ""}, ${countryName}: a metro-sized radius around the city center, from its population (no lookup).`;
  const placeText = [city, region ? regionName(region) : null, countryName].filter(Boolean).join(", ");
  const sourceText = effectiveProviders.map((k) => providers.find((p) => p.key === k)?.label ?? k).join(" + ") || "no source";
  const queries = playbook.key === "generic" ? (customCategory ? 1 : 0) : Math.max(1, segments.length);
  const summary: { k: string; v: React.ReactNode; bad?: boolean }[] = [
    { k: "Business", v: playbook.key === "generic" ? (customCategory ? `“${customCategory}”` : "category missing") : playbook.label, bad: playbook.key === "generic" && !customCategory },
    { k: "Categories", v: playbook.segments.length ? (segments.length ? `${segments.length} of ${playbook.segments.length} categories` : "all categories") : "—" },
    { k: "Name filter", v: keywords ? `“${keywords}”` : "none" },
    { k: "Place", v: city ? placeText : "city missing", bad: !city },
    { k: "Area", v: areaMode === "radius" ? `${radiusKm || "?"} km radius` : "whole city" },
    { k: "Source", v: sourceText, bad: !effectiveProviders.length },
    { k: "Results", v: `up to ${maxResults || "?"}` },
    { k: "Afterwards", v: `${autoSave ? "saved automatically" : "review before saving"}${autoSave && autoInvestigate ? ", then researched" : ""}` },
  ];

  return (
    <form action={action} noValidate>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px] items-start">
        <div className="min-w-0 space-y-5">
          {errorCount > 0 && (
            <Callout tone="bad" title={`${errorCount} thing${errorCount === 1 ? "" : "s"} to fix`}>
              {errors.form ?? "Check the highlighted fields below."}
            </Callout>
          )}

          <Step n={1} title="What kind of business" description="The business type becomes one Google Maps query, or one per chosen category; each listing keeps Google's own category so you can see what matched.">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {playbooks.map((p) => (
                <label key={p.key} className={`flex items-start gap-3 rounded-[var(--radius-sm)] border p-3 cursor-pointer hover:bg-surface-2 min-w-0 ${industry === p.key ? "border-accent bg-accent-soft/40" : "border-line"}`}>
                  <input type="radio" name="industry" value={p.key} checked={industry === p.key} onChange={() => { setIndustry(p.key); setSegments([]); }} className="mt-1 accent-[var(--accent)]" />
                  <span className="text-sm min-w-0">
                    <span className="font-medium">{p.label}</span>
                    <span className="block text-xs text-ink-muted">{p.description}</span>
                  </span>
                </label>
              ))}
            </div>
            {errors.industry && <p className="text-xs text-bad mt-2">{errors.industry}</p>}

            {playbook.segments.length > 0 && (
              <div className="mt-5 pt-5 border-t border-line">
                <div className="label">
                  Business category <span className="normal-case font-normal text-ink-faint">(none selected = all of them, one query)</span>
                </div>
                <div className="flex flex-wrap gap-2 mt-1">
                  {playbook.segments.map((s) => {
                    const on = segments.includes(s.key);
                    return (
                      <button key={s.key} type="button" onClick={() => toggleSegment(s.key)} className={`chip ${on ? "chip-active" : ""}`} title={s.description} aria-pressed={on}>
                        {on && <Icon name="check" className="w-3 h-3" />} {s.label}
                      </button>
                    );
                  })}
                </div>
                {segments.map((k) => (
                  <input key={k} type="hidden" name="segments" value={k} />
                ))}
                <p className="hint">{segments.length ? `${segments.length} quer${segments.length === 1 ? "y" : "ies"}: ${playbook.segments.filter((s) => segments.includes(s.key)).map((s) => s.description).join(" ")}` : "All categories of this business type are searched with one query."}</p>
                {errors.segments && <p className="text-xs text-bad mt-1">{errors.segments}</p>}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4 mt-5 pt-5 border-t border-line">
              {playbook.key === "generic" ? (
                <Field label="Business category to look for" hint="One or two words, e.g. roofing, bakery, veterinarian: sent to Google Maps as the query." error={errors.customCategory}>
                  <input className={`input ${errors.customCategory ? "border-bad" : ""}`} name="customCategory" value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} placeholder="e.g. roofing" />
                </Field>
              ) : (
                <input type="hidden" name="customCategory" value="" />
              )}
              <Field label="Business name contains" optional hint="Added to the query and applied to the names, e.g. “transmission”." error={errors.keywords}>
                <input className="input" name="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. transmission" />
              </Field>
            </div>
            {suggestion && (
              <p className="text-xs text-ink-muted mt-2">
                “{suggestion.matched}” sounds like <strong>{suggestion.label}</strong>.{" "}
                <button type="button" className="underline" onClick={() => { setIndustry(suggestion.key); setSegments([]); }}>
                  Switch the business type
                </button>
              </p>
            )}
          </Step>

          <Step n={2} title="Where" description="Any country. Pick the region, then start typing the city: suggestions come from a bundled list of 45,000 places worldwide. Search the whole city, or a radius around its center.">
            <div className="grid md:grid-cols-3 gap-4">
              <Field label="Country" error={errors.country}>
                <select className={`select ${errors.country ? "border-bad" : ""}`} name="country" value={country} onChange={(e) => { setCountry(e.target.value); setRegion(""); setCity(""); }}>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={country === "US" ? "State" : "Region / state"} optional={country !== "US"} error={errors.region} hint={regions.length ? undefined : "No regions listed for this country."}>
                <select className={`select ${errors.region ? "border-bad" : ""}`} name="region" value={region} onChange={(e) => { setRegion(e.target.value); setCity(""); }} disabled={!regions.length}>
                  <option value="">{country === "US" ? "Choose a state…" : "All regions"}</option>
                  {regions.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                      {country === "US" ? ` (${r.code})` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="City" error={errors.city} hint={country === "US" && !region ? "Choose a state first." : undefined}>
                <CitySelect key={`${country}-${region}-${v.city}`} country={country} region={region || null} defaultValue={city} hasError={Boolean(errors.city)} disabled={country === "US" && !region} regionLabel={regionName} onPick={(s) => { setCenter(s); if (s) setCity(s.name); }} />
              </Field>
            </div>
            <div className="mt-5 pt-5 border-t border-line grid md:grid-cols-[auto_1fr] gap-4 items-start">
              <div>
                <div className="label">Area</div>
                <div className="inline-flex rounded-[var(--radius-sm)] border border-line overflow-hidden" role="radiogroup">
                  <label className={`flex items-center gap-2 text-sm px-3 py-2 cursor-pointer ${areaMode === "area" ? "bg-accent-soft/60 text-ink" : "hover:bg-surface-2"}`}>
                    <input type="radio" name="areaMode" value="area" checked={areaMode === "area"} onChange={() => setAreaMode("area")} className="accent-[var(--accent)]" /> Whole city area
                  </label>
                  <label className={`flex items-center gap-2 text-sm px-3 py-2 cursor-pointer border-l border-line ${areaMode === "radius" ? "bg-accent-soft/60 text-ink" : "hover:bg-surface-2"}`}>
                    <input type="radio" name="areaMode" value="radius" checked={areaMode === "radius"} onChange={() => setAreaMode("radius")} className="accent-[var(--accent)]" /> Radius around the center
                  </label>
                </div>
              </div>
              <div className={areaMode === "radius" ? "" : "opacity-50"}>
                <div className="label">Radius</div>
                <div className="flex items-center gap-2">
                  <input className={`input w-24 ${errors.radiusKm ? "border-bad" : ""}`} type="number" name="radiusKm" min={1} max={100} value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} disabled={areaMode !== "radius"} aria-label="Radius in km" />
                  <span className="text-sm text-ink-muted">km</span>
                  {errors.radiusKm && <span className="text-xs text-bad">{errors.radiusKm}</span>}
                </div>
              </div>
            </div>
            <p className="text-xs text-ink-muted mt-3 flex items-start gap-1.5">
              <Icon name="globe" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{areaText}</span>
            </p>
          </Step>

          <Step n={3} title="Source" description="Google Maps is the only active source: SerpApi free plan, 250 searches of 20 listings per month, every page cached locally. Planned sources are listed so you know what is coming; they never run.">
            <div className="space-y-2">
              {byStatus("active").map((p) => (
                <ProviderRow key={p.key} p={p} checked={providersSel.includes(p.key) && usable(p)} usable={usable(p)} onToggle={() => toggleProvider(p.key)} note={p.available ? undefined : `Unavailable here: ${p.reason}`} />
              ))}
              {errors.providers && <p className="text-xs text-bad">{errors.providers}</p>}
            </div>
            <div className="mt-4 pt-4 border-t border-line">
              <div className="label">Planned</div>
              <div className="space-y-2 mt-1">
                {byStatus("future").map((p) => (
                  <ProviderRow key={p.key} p={p} checked={false} usable={false} planned note={p.futurePurpose} />
                ))}
              </div>
            </div>
          </Step>

          <Step n={4} title="Filters and limits" description="Applied while discovering. Skipped candidates are counted so you can see what a filter cost.">
            <div className="grid md:grid-cols-2 gap-3">
              <Toggle name="excludeChains" label="Exclude chains & franchises" hint="Known brands, dealerships and store-locator pages are set aside (counted, never hidden from the log)." defaultChecked={v.excludeChains} />
              <Toggle name="requirePhone" label="Must have a phone number" hint="Keeps only reachable businesses." defaultChecked={v.requirePhone} />
              <Toggle name="requireWebsite" label="Must already have a website" hint="Off by default: research can try to locate a website later." defaultChecked={v.requireWebsite} />
              <Toggle name="skipKnown" label="Skip businesses already in Radar" hint="New businesses only; known ones are still merged, just not listed." defaultChecked={v.skipKnown} />
            </div>
            <div className="grid md:grid-cols-2 gap-4 mt-5 pt-5 border-t border-line">
              <Field label="Maximum results" error={errors.maxResults} hint="Best leads first: businesses with a website, phone and address rank highest.">
                <input className={`input ${errors.maxResults ? "border-bad" : ""}`} type="number" name="maxResults" value={maxResults} onChange={(e) => setMaxResults(e.target.value)} min={1} max={500} />
              </Field>
              <Field label="Search name" optional hint="Generated from type and place when empty." error={errors.name}>
                <input className="input" name="name" defaultValue={v.name} placeholder="e.g. Body shops · Austin · Oct" />
              </Field>
            </div>
          </Step>

          <Step n={5} title="After discovery" description="What happens to the results once they are listed.">
            <div className="grid md:grid-cols-2 gap-3">
              <Toggle name="autoSave" label="Save results automatically" hint="Every listed business is saved to Radar and linked to this search. Off: review the list first and save the ones you want." defaultChecked={v.autoSave} onChange={setAutoSave} />
              <Toggle name="autoInvestigate" label="Research saved businesses automatically" hint={firecrawlEnabled ? "Best leads first: locate the website, read it, collect facts, score opportunities." : "Needs FIRECRAWL_API_KEY; without it the businesses are saved and wait for research."} defaultChecked={v.autoInvestigate} onChange={setAutoInvestigate} />
            </div>
            <div className={`grid md:grid-cols-2 gap-4 mt-5 pt-5 border-t border-line ${autoInvestigate && autoSave ? "" : "opacity-60"}`}>
              <Field label="Minimum lead score" error={errors.minLeadScore} hint="0–100. Independents with site, phone and address score ~90+; listing-only records ~40.">
                <input className={`input ${errors.minLeadScore ? "border-bad" : ""}`} type="number" name="minLeadScore" defaultValue={v.minLeadScore} min={0} max={100} />
              </Field>
              <Field label="Research at most" optional error={errors.autoInvestigateLimit} hint="Leave empty for all qualifying results.">
                <input className={`input ${errors.autoInvestigateLimit ? "border-bad" : ""}`} type="number" name="autoInvestigateLimit" defaultValue={v.autoInvestigateLimit} min={1} max={500} placeholder="all" />
              </Field>
            </div>
            {!aiEnabled && <p className="text-xs text-ink-muted mt-3">Without a model key, verdicts come from deterministic rules over verified facts.</p>}
          </Step>
        </div>

        <aside className="xl:sticky xl:top-5 min-w-0">
          <Card title="Summary" description="What this search will do.">
            <dl className="text-sm divide-y divide-line">
              {summary.map((row) => (
                <div key={row.k} className="flex justify-between gap-3 py-2">
                  <dt className="text-ink-muted shrink-0">{row.k}</dt>
                  <dd className={`text-right min-w-0 break-words ${row.bad ? "text-bad" : "font-medium"}`}>{row.v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-ink-muted mt-3">
              {queries ? `${queries} Google Maps quer${queries === 1 ? "y" : "ies"}, up to 3 pages each: at most ${queries * 3} of the month's 250 searches; cached pages are free.` : "Enter a category to form the query."}
            </p>
            <div className="mt-4 space-y-2">
              <button className="btn btn-primary btn-lg w-full justify-center" disabled={pending} aria-busy={pending}>
                {pending ? <Icon name="refresh" className="animate-spin" /> : <Icon name="play" />} {pending ? "Starting…" : "Start search"}
              </button>
              <Link href="/searches" className="btn btn-ghost w-full justify-center">
                Cancel
              </Link>
              {pending && <p className="text-xs text-ink-muted text-center">Validating and queueing the search.</p>}
              {errorCount > 0 && <p className="text-xs text-bad text-center">{errorCount} thing{errorCount === 1 ? "" : "s"} to fix above.</p>}
            </div>
          </Card>
        </aside>
      </div>
    </form>
  );
}

function ProviderRow({ p, checked, usable, planned, onToggle, note }: { p: ProviderOption; checked: boolean; usable: boolean; planned?: boolean; onToggle?: () => void; note?: string }) {
  return (
    <label className={`flex items-start gap-3 rounded-[var(--radius-sm)] border border-line p-3 min-w-0 ${usable ? "cursor-pointer hover:bg-surface-2" : "opacity-60 cursor-not-allowed"}`} aria-disabled={!usable}>
      <input type="checkbox" name="providers" value={p.key} checked={checked} onChange={onToggle} disabled={!usable} className="mt-1 accent-[var(--accent)]" aria-label={p.label} />
      <span className="text-sm min-w-0">
        <span className="font-medium flex items-center gap-2 flex-wrap">
          {p.label}
          {planned ? <Badge tone="accent">New</Badge> : p.status === "active" ? <Badge tone="ok" dot>Active</Badge> : null}
          {planned && <span className="text-[11px] font-normal text-ink-faint">coming later · not selectable</span>}
        </span>
        <span className="block text-xs text-ink-muted">{planned ? note : p.description}</span>
        {!planned && note && <span className="block text-xs text-warn mt-0.5">{note}</span>}
      </span>
    </label>
  );
}
