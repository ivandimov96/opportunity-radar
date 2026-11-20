"use client";
/**
 * The search form: any kind of business, typed in plain words, in any city.
 * Server-validated (src/lib/search-input.ts); on error the form re-renders with
 * the submitted values and inline messages. Location data is bundled; the only
 * network calls are to this app's own /api/regions and /api/places.
 *
 * Layout: three cards (what, where, what happens next) and a panel that says in
 * one sentence what the search will do and what it is expected to cost, with
 * the button under it. The panel stays in view on wide screens and follows the
 * cards on narrow ones.
 */
import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSearch, type CreateSearchState } from "@/app/actions";
import { Callout, Card, Icon } from "@/components/ui";
import type { RawSearchValues } from "@/lib/search-input";
import { suggestIndustries } from "@/lib/discovery/taxonomy";
import { ALL_BUSINESS_TYPE_COUNT, BUSINESS_KIND_GROUPS, filterBusinessTypes, matchBusinessKinds, type BusinessKind } from "@/lib/business-kinds";
import { estimateSearchCost, fmtUsd, type SearchCostBasis } from "@/lib/search-cost";
import { CitySelect, fmtPop, type Suggestion } from "./city-select";

export interface PlaybookOption {
  key: string;
  label: string;
  description: string;
  segments: { key: string; label: string; description: string }[];
}
/** A search that was run before: what was looked for and where. */
export interface PastSearch {
  industry: string;
  custom: string | null;
  country: string;
  city: string | null;
  at: string;
  /** Businesses it added. */
  created: number | null;
}

const REGION_WORD: Record<string, string> = { US: "State", GB: "Nation", CA: "Province", AU: "State", DE: "State", IE: "County" };
const daysAgo = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

export interface SourceState {
  /** Sources that can run here (sent with the form). */
  usable: string[];
  /** Why no source can run, when none can. */
  problem: string | null;
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

/** A labelled input. No description under it: the label says what it is, and only an error adds a line. */
function Field({ label, error, children, optional, htmlFor }: { label: string; error?: string; children: React.ReactNode; optional?: boolean; htmlFor?: string }) {
  return (
    <div className="min-w-0">
      <label className="label" htmlFor={htmlFor}>
        {label} {optional && <span className="font-normal text-ink-faint">(optional)</span>}
      </label>
      {children}
      {error && (
        <p className="text-xs text-bad mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Toggle({ name, label, defaultChecked, onChange }: { name: string; label: string; defaultChecked: boolean; onChange?: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-line p-3 cursor-pointer hover:bg-surface-2 min-w-0">
      <input type="hidden" name={name} value="off" />
      <input type="checkbox" name={name} value="on" defaultChecked={defaultChecked} onChange={(e) => onChange?.(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
      <span className="text-sm min-w-0">
        <span className="font-medium">{label}</span>
      </span>
    </label>
  );
}

/** A card of the form with its icon in one of the page's tones. */
function Part({ icon, tone, title, children, id }: { icon: React.ComponentProps<typeof Icon>["name"]; tone: string; title: string; children: React.ReactNode; id?: string }) {
  return (
    <Card
      id={id}
      title={
        <span className="flex items-center gap-2.5">
          <span className="fact-icon w-7 h-7 rounded-full grid place-items-center shrink-0" style={{ "--c": tone } as React.CSSProperties}>
            <Icon name={icon} className="w-3.5 h-3.5" />
          </span>
          {title}
        </span>
      }
    >
      {children}
    </Card>
  );
}

export function SearchForm(props: { profile: { /** The kinds of business the operator sells to. */ kinds: string[]; /** What the profile still lacks for searching, in plain words. */ missing: string[] }; playbooks: PlaybookOption[]; source: SourceState; countries: Country[]; initialRegions: Region[]; cost: SearchCostBasis; aiEnabled: boolean; firecrawlEnabled: boolean; defaults: RawSearchValues; allowedCountries: string[]; past: PastSearch[] }) {
  const [state, action, pending] = useActionState<CreateSearchState, FormData>(createSearch, null);
  // Remount the fields whenever the server returns a new state so every input re-initializes from the submitted values.
  const key = state ? JSON.stringify(state.values) : "initial";
  return <SearchFields key={key} {...props} state={state} action={action} pending={pending} />;
}

function SearchFields({ profile, playbooks, source, countries, initialRegions, cost, aiEnabled, firecrawlEnabled, defaults, allowedCountries, past, state, action, pending }: { profile: { /** The kinds of business the operator sells to. */ kinds: string[]; /** What the profile still lacks for searching, in plain words. */ missing: string[] }; playbooks: PlaybookOption[]; source: SourceState; countries: Country[]; initialRegions: Region[]; cost: SearchCostBasis; aiEnabled: boolean; firecrawlEnabled: boolean; defaults: RawSearchValues; allowedCountries: string[]; past: PastSearch[]; state: CreateSearchState; action: (fd: FormData) => void; pending: boolean }) {
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
  /** Bumped when a city is set from outside the field (a shortcut), so the field shows it. */
  const [cityNonce, setCityNonce] = useState(0);
  const [largest, setLargest] = useState<Suggestion[]>([]);
  /** Other cities to run the same search in: each becomes a search of its own. */
  const [more, setMore] = useState<Suggestion[]>([]);
  const [minReviews, setMinReviews] = useState(v.minReviews);
  const [minRating, setMinRating] = useState(v.minRating);
  const [autoInvestigate, setAutoInvestigate] = useState(v.autoInvestigate);
  const [autoSave, setAutoSave] = useState(v.autoSave);
  // The number is chosen from the cards (one per page of listings): an earlier value in between moves up to the next card.
  const [maxResults, setMaxResults] = useState(() => String(Math.min(cost.maxPages, Math.max(1, Math.ceil((Number(v.maxResults) || cost.listingsPerPage) / cost.listingsPerPage))) * cost.listingsPerPage));
  const [researchLimit, setResearchLimit] = useState(v.autoInvestigateLimit);
  const presets = useMemo(() => playbooks.filter((p) => p.key !== "generic"), [playbooks]);
  const preset = presets.find((p) => p.key === industry) ?? null;
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

  // The largest places of the chosen country or region: one-click shortcuts under the city field.
  useEffect(() => {
    let live = true;
    const params = new URLSearchParams({ country, q: "", limit: "10" });
    if (region) params.set("region", region);
    fetch(`/api/places?${params}`)
      .then((r) => r.json())
      .then((d: { places: Suggestion[] }) => live && setLargest(d.places))
      .catch(() => live && setLargest([]));
    return () => {
      live = false;
    };
  }, [country, region]);

  const errorCount = Object.keys(errors).length;
  const typeText = preset ? preset.label : customCategory;
  // Typing always means "exactly these words"; a ready-made type is chosen only by pressing it.
  const typeChanged = (text: string) => {
    setIndustry("generic");
    setSegments([]);
    setCustomCategory(text);
  };
  const pickPreset = (k: string) => {
    setIndustry(k);
    setSegments([]);
    setCustomCategory("");
  };
  const suggestion = useMemo(() => (preset ? null : (suggestIndustries(customCategory)[0] ?? null)), [customCategory, preset]);
  // Ideas for the field: a kind fills it with its words; one that stands for a ready-made type selects that type.
  const [group, setGroup] = useState(BUSINESS_KIND_GROUPS[0].key);
  const pickKind = (kind: BusinessKind) => (kind.preset && presets.some((p) => p.key === kind.preset) ? pickPreset(kind.preset) : typeChanged(kind.label.toLowerCase()));
  const kindOn = (kind: BusinessKind) => (kind.preset ? industry === kind.preset : !preset && customCategory.trim().toLowerCase() === kind.label.toLowerCase());
  const matches = useMemo(() => (preset ? [] : matchBusinessKinds(customCategory).filter((m) => !m.preset)), [customCategory, preset]);
  // The long list: every type by field, opened on request and narrowed by its own filter box.
  const [allOpen, setAllOpen] = useState(false);
  const [allFilter, setAllFilter] = useState("");
  const allTypes = useMemo(() => (allOpen ? filterBusinessTypes(allFilter) : []), [allOpen, allFilter]);
  const shownGroup = BUSINESS_KIND_GROUPS.find((g) => g.key === group) ?? BUSINESS_KIND_GROUPS[0];
  // Where: a picked city brings its region along; a shortcut does the same and shows in the field.
  const mayEmail = !allowedCountries.length || allowedCountries.includes(country);
  const countryGroups = allowedCountries.length ? [countries.filter((c) => allowedCountries.includes(c.code)), countries.filter((c) => !allowedCountries.includes(c.code))] : [[], countries];
  const regionWord = REGION_WORD[country] ?? "Region";
  const cityPicked = (place: Suggestion | null) => {
    setCenter(place);
    if (!place) return;
    setCity(place.name);
    if (place.region && regions.some((r) => r.code === place.region) && place.region !== region) setRegion(place.region);
  };
  const chooseCity = (place: Suggestion) => {
    cityPicked(place);
    setCityNonce((n) => n + 1);
  };
  // Searches already run for this kind of business in this country, by city.
  const sameKind = (p: PastSearch) => (preset ? p.industry === preset.key : p.industry === "generic" && Boolean(customCategory.trim()) && (p.custom ?? "").trim().toLowerCase() === customCategory.trim().toLowerCase());
  const searchedIn = (name: string) => past.find((p) => p.country === country && (p.city ?? "").toLowerCase() === name.toLowerCase() && sameKind(p)) ?? null;
  const repeat = city.trim() ? searchedIn(city.trim()) : null;
  const nextCity = what0(preset, customCategory) ? (largest.find((p) => !searchedIn(p.name)) ?? null) : null;
  const toggleSegment = (k: string) => setSegments((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  const queries = preset ? Math.max(1, segments.length) : customCategory.trim() ? 1 : 0;
  const perSearch = Math.max(1, queries) * cost.maxPages * cost.listingsPerPage;
  const research = autoSave && autoInvestigate;
  // The extra cities, without the main one: each is a search of its own.
  const extras = more.filter((p) => p.name.toLowerCase() !== city.trim().toLowerCase());
  const cities = 1 + extras.length;
  const est = estimateSearchCost(cost, { queries, maxResults: Number(maxResults), research, researchLimit: researchLimit ? Number(researchLimit) : null, cities });
  // One choice per page of listings a query can read: 20, 40, 60, each with what it costs to find.
  const sizes = Array.from({ length: cost.maxPages }, (_, i) => (i + 1) * cost.listingsPerPage);
  const creditsFor = (n: number) => estimateSearchCost(cost, { queries: Math.max(1, queries), maxResults: n, research: false, researchLimit: null, cities }).searchCredits;
  const after: "list" | "save" | "research" = !autoSave ? "list" : autoInvestigate ? "research" : "save";
  const setAfter = (a: "list" | "save" | "research") => {
    setAutoSave(a !== "list");
    setAutoInvestigate(a === "research");
  };
  // A repeat of the same search while its pages are still kept costs no credits (one city, same kind, whole city).
  const reused = Boolean(repeat && cities === 1 && areaMode === "area" && Date.now() - new Date(repeat.at).getTime() < cost.cacheDays * 86_400_000);
  const toggleMore = (p: Suggestion) => setMore((cur) => (cur.some((x) => x.name === p.name) ? cur.filter((x) => x.name !== p.name) : cur.length >= 9 ? cur : [...cur, p]));
  const what = preset ? preset.label.toLowerCase() : customCategory.trim();
  const place = [city, region ? regionName(region) : null, countryName].filter(Boolean).join(", ");
  const moreHasError = Boolean(errors.keywords || errors.name);
  const blocked = !source.usable.length;

  return (
    <form action={action} noValidate>
      <input type="hidden" name="industry" value={industry} />
      <input type="hidden" name="customCategory" value={preset ? "" : customCategory} />
      {source.usable.map((k) => (
        <input key={k} type="hidden" name="providers" value={k} />
      ))}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="min-w-0 space-y-5">
          {errorCount > 0 && (
            <Callout tone="bad" title={`${errorCount} thing${errorCount === 1 ? "" : "s"} to fix`}>
              {errors.form ?? errors.providers ?? "Check the marked fields below."}
            </Callout>
          )}
          {blocked && (
            <Callout tone="warn" title="Search is not set up yet">
              {source.problem ?? "No source of business listings is available."}
            </Callout>
          )}

          {profile.missing.length > 0 && (
            <Callout tone="info" title="Your profile can fill this in for you" action={<Link href="/settings?tab=sender&step=audience" className="btn btn-sm">Complete it</Link>}>
              Still missing under Your details: {profile.missing.join(", ")}. You can search without it.
            </Callout>
          )}

          <Part icon="search" tone="var(--accent)" title="What kind of business">
            <Field label="Kind of business" htmlFor="businessType" error={errors.customCategory ?? errors.industry}>
              <div className="relative">
                <Icon name="search" className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                <input id="businessType" className={`input !h-12 !pl-11 ${typeText ? "!pr-11" : ""} !text-[1.05rem] ${errors.customCategory || errors.industry ? "border-bad" : ""}`} value={typeText} onChange={(e) => typeChanged(e.target.value)} placeholder="e.g. sign makers, accountants, dog groomers" autoComplete="off" maxLength={80} />
                {typeText && (
                  <button type="button" onClick={() => typeChanged("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center rounded-full text-ink-faint hover:text-ink hover:bg-surface-2" aria-label="Clear the field">
                    <Icon name="x" className="w-4 h-4" />
                  </button>
                )}
              </div>
            </Field>
            {matches.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mt-2.5" aria-label="Matching ideas">
                <span className="text-xs text-ink-faint">Did you mean</span>
                {matches.map((m) => (
                  <button key={m.label} type="button" className="chip" onClick={() => pickKind(m)}>
                    {m.label}
                  </button>
                ))}
              </div>
            )}
            {suggestion && (
              <p className="text-sm text-ink-muted mt-2">
                There is a ready-made type for this:{" "}
                <button type="button" className="font-semibold text-accent-text underline" onClick={() => pickPreset(suggestion.key)}>
                  {suggestion.label}
                </button>
                . It lets you pick sub-categories.
              </p>
            )}
            {what && (
              <p className="text-sm mt-3 flex items-center gap-2 text-ink-muted" aria-live="polite">
                <Icon name="check" className="w-4 h-4 text-ok shrink-0" />
                <span>
                  The search will look for <strong className="text-ink">{what}</strong>
                  {preset ? " (a ready-made type: narrow it with the sub-categories below)" : ", exactly as written"}.
                </span>
              </p>
            )}

            {profile.kinds.length > 0 && (
              <div className="mt-5 pt-5 border-t border-line">
                <div className="label">From your profile</div>
                <div className="flex flex-wrap gap-1.5">
                  {profile.kinds.map((kind) => {
                    const on = !preset && customCategory.trim().toLowerCase() === kind.toLowerCase();
                    return (
                      <button key={kind} type="button" onClick={() => typeChanged(on ? "" : kind)} className={`chip ${on ? "chip-active" : ""}`}>
                        {kind}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-5 pt-5 border-t border-line">
              <div className="label">Ideas by field</div>
              <div className="flex flex-wrap gap-x-1 gap-y-1 mb-3" role="tablist" aria-label="Fields">
                {BUSINESS_KIND_GROUPS.map((g) => {
                  const on = g.key === shownGroup.key;
                  return (
                    <button key={g.key} type="button" role="tab" aria-selected={on} onClick={() => setGroup(g.key)} className={`px-2.5 h-8 rounded-[var(--radius-sm)] text-sm font-semibold ${on ? "bg-surface-3 text-ink" : "text-ink-muted hover:text-ink hover:bg-surface-2"}`}>
                      {g.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2" role="tabpanel" aria-label={shownGroup.label}>
                {shownGroup.kinds.map((kind) => {
                  const on = kindOn(kind);
                  const isPreset = Boolean(kind.preset && presets.some((p) => p.key === kind.preset));
                  return (
                    <button key={kind.label} type="button" onClick={() => (on ? typeChanged("") : pickKind(kind))} className={`chip ${on ? "chip-active" : ""}`} title={isPreset ? "A ready-made type: you can narrow it to sub-categories" : `Search for “${kind.label.toLowerCase()}”`} aria-pressed={on}>
                      {on && <Icon name="check" className="w-3 h-3" />} {kind.label}
                      {isPreset && !on && <span className="hidden sm:inline text-ink-faint font-normal">· with sub-categories</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 pt-5 border-t border-line">
              <button type="button" onClick={() => setAllOpen((o) => !o)} aria-expanded={allOpen} className="flex items-center gap-2 text-sm font-semibold text-ink hover:text-accent-text">
                <Icon name="chevronRight" className={`w-4 h-4 transition-transform ${allOpen ? "rotate-90" : ""}`} />
                All types ({ALL_BUSINESS_TYPE_COUNT})
              </button>
              {allOpen && (
                <div className="mt-3">
                  <input className="input" value={allFilter} onChange={(e) => setAllFilter(e.target.value)} placeholder="Filter the list, e.g. hire, clinic, repair" aria-label="Filter all types" autoComplete="off" />
                  <div className="mt-3 max-h-[22rem] overflow-y-auto rounded-[var(--radius-sm)] border border-line bg-surface-2 px-4 py-3 space-y-4" aria-label="All types">
                    {allTypes.length === 0 && (
                      <p className="text-sm text-ink-muted">
                        Nothing in the list matches “{allFilter}”. You can still search for it:{" "}
                        <button type="button" className="font-semibold text-accent-text underline" onClick={() => typeChanged(allFilter.trim())}>
                          use “{allFilter.trim()}”
                        </button>
                        .
                      </p>
                    )}
                    {allTypes.map((f) => (
                      <div key={f.field}>
                        <div className="text-xs font-semibold text-ink-muted mb-1.5">
                          {f.field} <span className="font-normal text-ink-faint">({f.types.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {f.types.map((name) => {
                            const on = !preset && customCategory.trim().toLowerCase() === name.toLowerCase();
                            return (
                              <button key={name} type="button" onClick={() => typeChanged(on ? "" : name.toLowerCase())} className={`chip ${on ? "chip-active" : ""}`} aria-pressed={on}>
                                {on && <Icon name="check" className="w-3 h-3" />} {name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {preset && preset.segments.length > 0 && (
              <div className="mt-5 pt-5 border-t border-line">
                <div className="label">
                  Sub-categories
                </div>
                <div className="flex flex-wrap gap-2">
                  {preset.segments.map((s) => {
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
                {segments.length > 1 && <p className="hint">Each chosen sub-category is searched on its own, so {segments.length} sub-categories cost {segments.length} times the search credits.</p>}
                {errors.segments && <p className="text-xs text-bad mt-1">{errors.segments}</p>}
              </div>
            )}
          </Part>

          <Part icon="globe" tone="var(--info)" title="Where">
            <div className="grid md:grid-cols-3 gap-4">
              <Field label="Country" htmlFor="country" error={errors.country}>
                <select id="country" className={`select ${errors.country ? "border-bad" : ""}`} name="country" value={country} onChange={(e) => { setCountry(e.target.value); setRegion(""); setCity(""); setCenter(null); setMore([]); }}>
                  {countryGroups[0].length > 0 && (
                    <optgroup label="Countries you limited emailing to">
                      {countryGroups[0].map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label={countryGroups[0].length ? "Other countries" : "Countries"}>
                    {countryGroups[1].map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </Field>
              <Field label="City" htmlFor="city" error={errors.city}>
                <CitySelect key={`${country}-${region}-${v.city}-${cityNonce}`} country={country} region={region || null} defaultValue={city} defaultCenter={center} hasError={Boolean(errors.city)} regionLabel={regionName} onPick={cityPicked} onText={setCity} note={(p) => { const done = searchedIn(p.name); return done ? `searched ${daysAgo(done.at)}` : null; }} />
              </Field>
              <Field label={regionWord} htmlFor="region" optional={country !== "US"} error={errors.region}>
                <select id="region" className={`select ${errors.region ? "border-bad" : ""}`} name="region" value={region} onChange={(e) => { setRegion(e.target.value); setCity(""); setCenter(null); }} disabled={!regions.length}>
                  <option value="">{country === "US" ? "Any state" : `Any ${regionWord.toLowerCase()}`}</option>
                  {regions.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                      {country === "US" ? ` (${r.code})` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {!mayEmail && (
              <div className="mt-4">
                <Callout tone="warn" title={`You limited emailing to other countries than ${countryName}`}>
                  You can search there, but emails to businesses in {countryName} are blocked by your own limit. Add it, or clear the limit, under <Link href="/settings?tab=sending">Settings → Mailbox and sending</Link>.
                </Callout>
              </div>
            )}

            {largest.length > 0 && (
              <div className="mt-4">
                <div className="label">
                  Largest cities in {region ? regionName(region) : countryName}
                </div>
                <div className="flex flex-wrap gap-2" aria-label="Largest cities">
                  {largest.map((p) => {
                    const on = city.trim().toLowerCase() === p.name.toLowerCase();
                    const done = searchedIn(p.name);
                    return (
                      <button key={`${p.name}-${p.region}`} type="button" onClick={() => chooseCity(p)} className={`chip ${on ? "chip-active" : ""}`} aria-pressed={on} title={done ? `Searched ${daysAgo(done.at)}${done.created != null ? `: ${done.created} added` : ""}` : `About ${fmtPop(p.population)} people`}>
                        {done && <Icon name="check" className="w-3 h-3 text-ok" />} {p.name} <span className="font-normal text-ink-faint">{fmtPop(p.population)}</span>
                      </button>
                    );
                  })}
                </div>
                {nextCity && largest.some((p) => searchedIn(p.name)) && (
                  <p className="text-sm text-ink-muted mt-2.5">
                    Next one you have not searched for {what}:{" "}
                    <button type="button" className="font-semibold text-accent-text underline" onClick={() => chooseCity(nextCity)}>
                      {nextCity.name}
                    </button>
                    .
                  </p>
                )}
              </div>
            )}

            {city.trim() && largest.filter((p) => p.name.toLowerCase() !== city.trim().toLowerCase()).length > 0 && (
              <div className="mt-4 pt-4 border-t border-line">
                <div className="label">
                  Also search <span className="font-normal text-ink-faint">(optional)</span>
                </div>
                <div className="flex flex-wrap gap-2" aria-label="Also search">
                  {largest
                    .filter((p) => p.name.toLowerCase() !== city.trim().toLowerCase())
                    .map((p) => {
                      const on = more.some((x) => x.name === p.name);
                      const done = searchedIn(p.name);
                      return (
                        <button key={`${p.name}-${p.region}`} type="button" onClick={() => toggleMore(p)} className={`chip ${on ? "chip-active" : ""}`} aria-pressed={on} title={done ? `Searched ${daysAgo(done.at)}` : undefined}>
                          {on ? <Icon name="check" className="w-3 h-3" /> : <Icon name="plus" className="w-3 h-3" />} {p.name}
                          {done && !on && <span className="font-normal text-ink-faint">· searched</span>}
                        </button>
                      );
                    })}
                </div>
                {extras.length > 0 && (
                  <p className="text-sm text-ink-muted mt-2.5">
                    <strong className="text-ink">{cities} cities</strong>: {[city.trim(), ...extras.map((p) => p.name)].join(", ")}. The cost on the right is for all of them.{" "}
                    <button type="button" className="font-semibold text-accent-text underline" onClick={() => setMore([])}>
                      Only {city.trim()}
                    </button>
                  </p>
                )}
                <input type="hidden" name="moreCities" value={JSON.stringify(extras.map((p) => ({ name: p.name, region: p.region, lat: p.lat, lon: p.lon })))} />
              </div>
            )}

            {repeat && (
              <div className="mt-4">
                <Callout tone="info" title={`You searched for ${what} in ${city.trim()} ${daysAgo(repeat.at)}`}>
                  {repeat.created != null ? `That search added ${repeat.created} business${repeat.created === 1 ? "" : "es"}. ` : ""}Searching again mostly finds the same ones. To get only new ones, tick “Only businesses you do not have yet” below, or pick another city.
                </Callout>
              </div>
            )}

            {city.trim() && (
              <p className="text-sm mt-4 flex items-start gap-2 text-ink-muted" aria-live="polite">
                <Icon name={center ? "check" : "info"} className={`w-4 h-4 mt-0.5 shrink-0 ${center ? "text-ok" : "text-warn"}`} />
                {center ? (
                  <span>
                    <strong className="text-ink">{[center.name, center.region ? regionName(center.region) : null, countryName].filter(Boolean).join(", ")}</strong> · about {fmtPop(center.population)} people.{" "}
                    {areaMode === "radius" ? `The search covers ${radiusKm || "?"} km around the centre.` : `The search covers the whole city: about ${center.radiusKm ?? 15} km around the centre.`}
                  </span>
                ) : (
                  <span>“{city.trim()}” is not picked from the list yet. Pick it so the search knows exactly where it is; a name the list does not know may find nothing.</span>
                )}
              </p>
            )}

            <div className="mt-5 pt-5 border-t border-line flex flex-wrap gap-x-6 gap-y-4 items-end">
              <div>
                <div className="label">Area</div>
                <div className="inline-flex rounded-[var(--radius-sm)] border border-line overflow-hidden" role="radiogroup" aria-label="Area">
                  <label className={`flex items-center gap-2 text-sm px-3 py-2 cursor-pointer ${areaMode === "area" ? "bg-accent-soft/60 text-ink" : "hover:bg-surface-2"}`}>
                    <input type="radio" name="areaMode" value="area" checked={areaMode === "area"} onChange={() => setAreaMode("area")} className="accent-[var(--accent)]" /> The whole city
                  </label>
                  <label className={`flex items-center gap-2 text-sm px-3 py-2 cursor-pointer border-l border-line ${areaMode === "radius" ? "bg-accent-soft/60 text-ink" : "hover:bg-surface-2"}`}>
                    <input type="radio" name="areaMode" value="radius" checked={areaMode === "radius"} onChange={() => { setAreaMode("radius"); if (center?.radiusKm) setRadiusKm(String(Math.max(2, Math.round(center.radiusKm / 2)))); }} className="accent-[var(--accent)]" /> Around the centre
                  </label>
                </div>
              </div>
              {areaMode === "radius" ? (
                <div>
                  <label className="label" htmlFor="radiusKm">
                    Distance from the centre
                  </label>
                  <div className="flex items-center gap-2">
                    <input id="radiusKm" className={`input w-24 ${errors.radiusKm ? "border-bad" : ""}`} type="number" name="radiusKm" min={1} max={100} value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
                    <span className="text-sm text-ink-muted">km</span>
                    {errors.radiusKm && <span className="text-xs text-bad">{errors.radiusKm}</span>}
                  </div>
                </div>
              ) : (
                <input type="hidden" name="radiusKm" value={radiusKm} />
              )}
            </div>
          </Part>

          <Part icon="list" tone="var(--warn)" title="How many, and which ones">
            <Field label={cities > 1 ? "Businesses to find in each city" : "Businesses to find"} error={errors.maxResults}>
              <div className="grid sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Businesses to find">
                {sizes.map((n) => {
                  const on = Number(maxResults) === n;
                  return (
                    <button key={n} type="button" role="radio" aria-checked={on} onClick={() => setMaxResults(String(n))} className={`text-left rounded-[var(--radius-sm)] border px-3.5 py-2.5 ${on ? "border-accent bg-accent-soft/60" : "border-line hover:bg-surface-2"}`}>
                      <span className="block text-base font-semibold tabular-nums">Up to {n}</span>
                      <span className="block text-xs text-ink-muted">
                        {n / cost.listingsPerPage} page{n === cost.listingsPerPage ? "" : "s"} · {creditsFor(n)} search credits{cities > 1 ? ` for ${cities} cities` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
              <input type="hidden" name="maxResults" value={maxResults} />
            </Field>
            <div className="mt-5 pt-5 border-t border-line">
              <div className="label">Leave out</div>
              <div className="grid md:grid-cols-2 gap-3">
                <Toggle name="excludeChains" label="Chains and franchises" defaultChecked={v.excludeChains} />
                <Toggle name="skipKnown" label="Businesses you already have" defaultChecked={v.skipKnown} />
                <Toggle name="requireWebsite" label="Businesses without a website" defaultChecked={v.requireWebsite} />
                <Toggle name="requirePhone" label="Businesses without a phone number" defaultChecked={v.requirePhone} />
              </div>
            </div>
            <div className="mt-5 pt-5 border-t border-line grid md:grid-cols-2 gap-4">
              <Field label="At least this many reviews" error={errors.minReviews}>
                <div className="flex flex-wrap items-center gap-2">
                  {[0, 5, 20, 50].map((n) => (
                    <button key={n} type="button" className={`chip ${Number(minReviews) === n ? "chip-active" : ""}`} aria-pressed={Number(minReviews) === n} onClick={() => setMinReviews(String(n))}>
                      {n === 0 ? "Any" : `${n}+`}
                    </button>
                  ))}
                  <input type="hidden" name="minReviews" value={minReviews} />
                </div>
              </Field>
              <Field label="Rated at least" error={errors.minRating}>
                <div className="flex flex-wrap items-center gap-2">
                  {[0, 3.5, 4, 4.5].map((n) => (
                    <button key={n} type="button" className={`chip ${Number(minRating) === n ? "chip-active" : ""}`} aria-pressed={Number(minRating) === n} onClick={() => setMinRating(String(n))}>
                      {n === 0 ? "Any" : `${n}★`}
                    </button>
                  ))}
                  <input type="hidden" name="minRating" value={minRating} />
                </div>
              </Field>
            </div>
          </Part>

          <Part icon="bolt" tone="var(--ok)" title="After the search">
            <input type="hidden" name="autoSave" value={autoSave ? "on" : "off"} />
            <input type="hidden" name="autoInvestigate" value={autoInvestigate ? "on" : "off"} />
            <div className="grid md:grid-cols-3 gap-2" role="radiogroup" aria-label="After the search">
              {(
                [
                  ["list", "Show me the list", "Nothing is saved. You look through what was found and keep the ones you want."],
                  ["save", "Save them", "They are saved as businesses and wait. Research starts when you say so."],
                  ["research", "Save and research", firecrawlEnabled ? "Each website is read and one idea is prepared. This is the part that costs money." : "Website reading is not set up, so they are saved and wait."],
                ] as const
              ).map(([key, title]) => {
                const on = after === key;
                return (
                  <button key={key} type="button" role="radio" aria-checked={on} onClick={() => setAfter(key)} className={`text-left rounded-[var(--radius-sm)] border px-3.5 py-3 ${on ? "border-accent bg-accent-soft/60" : "border-line hover:bg-surface-2"}`}>
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      {on && <Icon name="check" className="w-3.5 h-3.5 text-accent-text" />} {title}
                    </span>
                  </button>
                );
              })}
            </div>
            {research ? (
              <div className="mt-5 pt-5 border-t border-line grid md:grid-cols-2 gap-4">
                <Field label={cities > 1 ? "Research at most, in each city" : "Research at most"} htmlFor="autoInvestigateLimit" error={errors.autoInvestigateLimit}>
                  <div className="flex flex-wrap items-center gap-2">
                    {[5, 10, 20].filter((n) => n <= Number(maxResults || 0)).map((n) => (
                      <button key={n} type="button" className={`chip ${Number(researchLimit) === n ? "chip-active" : ""}`} aria-pressed={Number(researchLimit) === n} onClick={() => setResearchLimit(String(n))}>
                        {n}
                      </button>
                    ))}
                    <button type="button" className={`chip ${!researchLimit ? "chip-active" : ""}`} aria-pressed={!researchLimit} onClick={() => setResearchLimit("")}>
                      All
                    </button>
                    <input id="autoInvestigateLimit" className={`input w-24 ${errors.autoInvestigateLimit ? "border-bad" : ""}`} type="number" name="autoInvestigateLimit" value={researchLimit} onChange={(e) => setResearchLimit(e.target.value)} min={1} max={500} placeholder="all" />
                  </div>
                </Field>
                <Field label="Research only from score" htmlFor="minLeadScore" error={errors.minLeadScore}>
                  <input id="minLeadScore" className={`input w-24 ${errors.minLeadScore ? "border-bad" : ""}`} type="number" name="minLeadScore" defaultValue={v.minLeadScore} min={0} max={100} />
                </Field>
              </div>
            ) : (
              <>
                <input type="hidden" name="autoInvestigateLimit" value={researchLimit} />
                <input type="hidden" name="minLeadScore" value={v.minLeadScore} />
              </>
            )}
            {!aiEnabled && <p className="text-xs text-ink-muted mt-3">No AI model is set up: research still reads the website, but no email is written.</p>}
          </Part>

          <details className="surface group" open={moreHasError || Boolean(v.keywords || v.name) || undefined}>
            <summary className="flex items-center gap-2 px-5 py-3.5 cursor-pointer select-none text-base font-semibold">
              <Icon name="chevronRight" className="w-4 h-4 text-ink-faint transition-transform group-open:rotate-90" />
              More options
            </summary>
            <div className="grid md:grid-cols-2 gap-4 px-5 pb-5">
              <Field label="Name must contain" htmlFor="keywords" optional error={errors.keywords}>
                <input id="keywords" className="input" name="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
              </Field>
              <Field label="Name of this search" htmlFor="searchName" optional error={errors.name}>
                <input id="searchName" className="input" name="name" defaultValue={v.name} />
              </Field>
            </div>
          </details>
        </div>

        <aside className="xl:sticky xl:top-5 min-w-0 space-y-5">
          <section className="surface fact" style={{ "--c": "var(--accent)" } as React.CSSProperties} aria-label="Your search">
            <div className="p-5">
              <h2 className="text-base font-semibold">Your search</h2>
              {/* The four choices in one glance: what is set shows its value, what is missing says so. */}
              <dl className="mt-3 space-y-2.5 text-sm" aria-label="Your choices">
                <SummaryRow icon="search" label="What" value={what || null} missing="Choose a kind of business" bad={Boolean(errors.customCategory || errors.industry)} />
                <SummaryRow icon="globe" label="Where" value={city.trim() ? (cities > 1 ? `${city.trim()} and ${extras.length} more ${extras.length === 1 ? "city" : "cities"}` : `${place}${areaMode === "radius" ? `, ${radiusKm || "?"} km around the centre` : ""}`) : null} missing="Choose a city" bad={Boolean(errors.city)} />
                <SummaryRow icon="list" label="How many" value={`Up to ${maxResults || "?"}${cities > 1 ? " in each city" : ""}`} />
                <SummaryRow icon="bolt" label="Then" value={after === "list" ? "Show me the list" : after === "save" ? "Save them" : `Save and research${researchLimit && Number(researchLimit) < Number(maxResults) ? ` the best ${researchLimit}` : " all"}`} />
              </dl>

              <h3 className="text-sm font-semibold mt-5 pt-4 border-t border-line">Expected cost</h3>
              {!what && <p className="text-sm text-ink-muted mt-1.5" aria-label="Expected cost">Shown once you choose a kind of business.</p>}
              <dl className={`text-sm mt-1 divide-y divide-line ${what ? "" : "hidden"}`} aria-label={what ? "Expected cost" : undefined}>
                <CostRow
                  label={cities > 1 ? `Finding them, ${cities} searches` : "Finding them"}
                  value={`${est.searchCredits} search credits`}
                  note={reused ? `probably 0: the pages read ${daysAgo(repeat!.at)} are reused · ${cost.searchCreditsLeft.toLocaleString()} left` : `of your ${cost.searchCreditsLeft.toLocaleString()} left (they do not renew)`}
                  bad={!est.enoughSearchCredits}
                />
                {research ? (
                  <>
                    <CostRow label={`Research, up to ${est.researched}`} value={cost.researchUsd ? `up to ${fmtUsd(est.researchUsd)}` : "no AI cost"} note={cost.pageCreditsPerResearch ? `about ${est.pageCredits} website credits · ${cost.pageCreditsLeft.toLocaleString()} left this month` : undefined} bad={!est.enoughPageCredits} />
                    {cost.autoDraft && <CostRow label="Emails for those that fit" value={`up to ${fmtUsd(est.emailUsd)}`} />}
                  </>
                ) : (
                  <CostRow label="Research" value="not started" note={cost.researchUsd ? `about ${fmtUsd(cost.researchUsd)} per business when you start it` : undefined} />
                )}
                <div className="pt-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="font-semibold">{est.totalUsd > 0 ? "Likely" : "Total"}</dt>
                    <dd className="font-serif text-[1.6rem] leading-none font-semibold tabular-nums whitespace-nowrap">{est.totalUsd > 0 ? `about ${fmtUsd(est.likelyUsd)}` : "$0"}</dd>
                  </div>
                  {est.totalUsd > 0 && (
                    <div className="flex items-baseline justify-between gap-3 mt-1.5 text-ink-muted">
                      <dt>At most</dt>
                      <dd className="tabular-nums whitespace-nowrap">{fmtUsd(est.totalUsd)}</dd>
                    </div>
                  )}
                </div>
              </dl>
              {!est.enoughSearchCredits && <p className="text-xs text-bad mt-2">Not enough search credits for this search.</p>}
              {research && !est.enoughPageCredits && <p className="text-xs text-bad mt-2">Not enough website credits this month to research all of them; the rest will wait.</p>}
              {what && est.totalUsd > 0 && (
                <p className="text-xs text-ink-muted mt-3">
                  Per business: about {fmtUsd(cost.researchUsd)} to research{cost.autoDraft ? `, ${fmtUsd(cost.emailUsd)} to write the email` : ""}
                  {cost.measuredFrom ? ` (your last ${cost.measuredFrom})` : ""}.
                </p>
              )}

              <div className="mt-5 space-y-2">
                <button className="btn btn-primary btn-lg w-full justify-center" disabled={pending} aria-busy={pending}>
                  {pending ? <Icon name="refresh" className="animate-spin" /> : <Icon name="search" />} {pending ? "Starting…" : "Start search"}
                </button>
                <Link href="/searches" className="btn btn-ghost w-full justify-center">
                  Cancel
                </Link>
                {errorCount > 0 && <p className="text-xs text-bad text-center">{errorCount} thing{errorCount === 1 ? "" : "s"} to fix above.</p>}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </form>
  );
}

/** One line of the summary: an icon, what it is, and the choice made, or what is still to choose. */
function SummaryRow({ icon, label, value, missing, bad }: { icon: React.ComponentProps<typeof Icon>["name"]; label: string; value: string | null; missing?: string; bad?: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon name={icon} className={`w-4 h-4 mt-0.5 shrink-0 ${value ? "text-accent-text" : "text-ink-faint"}`} />
      <dt className="w-[4.6rem] shrink-0 text-ink-muted">{label}</dt>
      <dd className={`min-w-0 flex-1 ${value ? "font-semibold text-ink" : bad ? "text-bad" : "text-ink-faint"}`}>{value ?? missing}</dd>
    </div>
  );
}

/** Whether a kind of business has been chosen yet. */
function what0(preset: PlaybookOption | null, custom: string): boolean {
  return Boolean(preset || custom.trim());
}

function CostRow({ label, value, note, bad }: { label: string; value: string; note?: string; bad?: boolean }) {
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-ink-muted">{label}</dt>
        <dd className={`font-semibold tabular-nums whitespace-nowrap ${bad ? "text-bad" : ""}`}>{value}</dd>
      </div>
      {note && <div className={`text-xs mt-0.5 text-right ${bad ? "text-bad" : "text-ink-faint"}`}>{note}</div>}
    </div>
  );
}
