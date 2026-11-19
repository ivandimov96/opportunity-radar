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
import { estimateSearchCost, fmtUsd, type SearchCostBasis } from "@/lib/search-cost";
import { CitySelect, type Suggestion } from "./city-select";

export interface PlaybookOption {
  key: string;
  label: string;
  description: string;
  segments: { key: string; label: string; description: string }[];
}
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

function Field({ label, hint, error, children, optional, htmlFor }: { label: string; hint?: React.ReactNode; error?: string; children: React.ReactNode; optional?: boolean; htmlFor?: string }) {
  return (
    <div className="min-w-0">
      <label className="label" htmlFor={htmlFor}>
        {label} {optional && <span className="font-normal text-ink-faint">(optional)</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-bad mt-1" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
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

export function SearchForm(props: { playbooks: PlaybookOption[]; source: SourceState; countries: Country[]; initialRegions: Region[]; cost: SearchCostBasis; aiEnabled: boolean; firecrawlEnabled: boolean; defaults: RawSearchValues }) {
  const [state, action, pending] = useActionState<CreateSearchState, FormData>(createSearch, null);
  // Remount the fields whenever the server returns a new state so every input re-initializes from the submitted values.
  const key = state ? JSON.stringify(state.values) : "initial";
  return <SearchFields key={key} {...props} state={state} action={action} pending={pending} />;
}

function SearchFields({ playbooks, source, countries, initialRegions, cost, aiEnabled, firecrawlEnabled, defaults, state, action, pending }: { playbooks: PlaybookOption[]; source: SourceState; countries: Country[]; initialRegions: Region[]; cost: SearchCostBasis; aiEnabled: boolean; firecrawlEnabled: boolean; defaults: RawSearchValues; state: CreateSearchState; action: (fd: FormData) => void; pending: boolean }) {
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
  const [, setCenter] = useState<Suggestion | null>(null);
  const [autoInvestigate, setAutoInvestigate] = useState(v.autoInvestigate);
  const [autoSave, setAutoSave] = useState(v.autoSave);
  const [maxResults, setMaxResults] = useState(v.maxResults);
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
  const toggleSegment = (k: string) => setSegments((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  const queries = preset ? Math.max(1, segments.length) : customCategory.trim() ? 1 : 0;
  const perSearch = Math.max(1, queries) * cost.maxPages * cost.listingsPerPage;
  const research = autoSave && autoInvestigate;
  const est = estimateSearchCost(cost, { queries, maxResults: Number(maxResults), research, researchLimit: researchLimit ? Number(researchLimit) : null });
  const sizes = [...new Set([cost.listingsPerPage, cost.listingsPerPage * 2, perSearch])].filter((n) => n <= perSearch);
  const what = preset ? preset.label.toLowerCase() : customCategory.trim();
  const place = [city, region ? regionName(region) : null, countryName].filter(Boolean).join(", ");
  const moreHasError = Boolean(errors.keywords || errors.name || errors.minLeadScore);
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

          <Part icon="search" tone="var(--accent)" title="What kind of business">
            <Field label="Kind of business" htmlFor="businessType" hint="Any kind, in the words a customer would use to find one on a map." error={errors.customCategory ?? errors.industry}>
              <div className="relative">
                <Icon name="search" className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                <input id="businessType" className={`input !h-12 !pl-11 !text-[1.05rem] ${errors.customCategory || errors.industry ? "border-bad" : ""}`} value={typeText} onChange={(e) => typeChanged(e.target.value)} placeholder="e.g. sign makers, accountants, dog groomers" autoComplete="off" maxLength={80} />
              </div>
            </Field>
            {suggestion && (
              <p className="text-sm text-ink-muted mt-2">
                There is a ready-made type for this:{" "}
                <button type="button" className="font-semibold text-accent-text underline" onClick={() => pickPreset(suggestion.key)}>
                  {suggestion.label}
                </button>
                . It lets you pick sub-categories.
              </p>
            )}
            <div className="mt-4">
              <div className="label">Ready-made types</div>
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => {
                  const on = industry === p.key;
                  return (
                    <button key={p.key} type="button" onClick={() => (on ? typeChanged("") : pickPreset(p.key))} className={`chip ${on ? "chip-active" : ""}`} title={p.description} aria-pressed={on}>
                      {on && <Icon name="check" className="w-3 h-3" />} {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {preset && preset.segments.length > 0 && (
              <div className="mt-5 pt-5 border-t border-line">
                <div className="label">
                  Sub-categories <span className="font-normal text-ink-faint">(none chosen = all of them in one search)</span>
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
                <select id="country" className={`select ${errors.country ? "border-bad" : ""}`} name="country" value={country} onChange={(e) => { setCountry(e.target.value); setRegion(""); setCity(""); }}>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={country === "US" ? "State" : "Region"} htmlFor="region" optional={country !== "US"} error={errors.region} hint={regions.length ? undefined : "No regions listed for this country."}>
                <select id="region" className={`select ${errors.region ? "border-bad" : ""}`} name="region" value={region} onChange={(e) => { setRegion(e.target.value); setCity(""); }} disabled={!regions.length}>
                  <option value="">{country === "US" ? "Choose a state…" : "All regions"}</option>
                  {regions.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                      {country === "US" ? ` (${r.code})` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="City" error={errors.city} hint={country === "US" && !region ? "Choose a state first." : "One city per search."}>
                <CitySelect key={`${country}-${region}-${v.city}`} country={country} region={region || null} defaultValue={city} hasError={Boolean(errors.city)} disabled={country === "US" && !region} regionLabel={regionName} onPick={(s) => { setCenter(s); if (s) setCity(s.name); }} />
              </Field>
            </div>
            <div className="mt-5 pt-5 border-t border-line flex flex-wrap gap-x-6 gap-y-4 items-end">
              <div>
                <div className="label">Area</div>
                <div className="inline-flex rounded-[var(--radius-sm)] border border-line overflow-hidden" role="radiogroup" aria-label="Area">
                  <label className={`flex items-center gap-2 text-sm px-3 py-2 cursor-pointer ${areaMode === "area" ? "bg-accent-soft/60 text-ink" : "hover:bg-surface-2"}`}>
                    <input type="radio" name="areaMode" value="area" checked={areaMode === "area"} onChange={() => setAreaMode("area")} className="accent-[var(--accent)]" /> The whole city
                  </label>
                  <label className={`flex items-center gap-2 text-sm px-3 py-2 cursor-pointer border-l border-line ${areaMode === "radius" ? "bg-accent-soft/60 text-ink" : "hover:bg-surface-2"}`}>
                    <input type="radio" name="areaMode" value="radius" checked={areaMode === "radius"} onChange={() => setAreaMode("radius")} className="accent-[var(--accent)]" /> Around the centre
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
            <Field label="Businesses to find" htmlFor="maxResults" error={errors.maxResults} hint={`One search returns up to ${perSearch} listings. The most complete ones (website, phone, address) come first.`}>
              <div className="flex flex-wrap items-center gap-2">
                {sizes.map((n) => (
                  <button key={n} type="button" className={`chip ${Number(maxResults) === n ? "chip-active" : ""}`} aria-pressed={Number(maxResults) === n} onClick={() => setMaxResults(String(n))}>
                    {n}
                  </button>
                ))}
                <input id="maxResults" className={`input w-24 ${errors.maxResults ? "border-bad" : ""}`} type="number" name="maxResults" value={maxResults} onChange={(e) => setMaxResults(e.target.value)} min={1} max={500} />
              </div>
            </Field>
            <div className="grid md:grid-cols-2 gap-3 mt-5 pt-5 border-t border-line">
              <Toggle name="excludeChains" label="Leave out chains and franchises" hint="Known brands and branch pages are set aside and counted." defaultChecked={v.excludeChains} />
              <Toggle name="skipKnown" label="Only businesses you do not have yet" hint="Ones already saved are not listed again." defaultChecked={v.skipKnown} />
              <Toggle name="requireWebsite" label="Must have a website" hint="Off: research tries to find the website later." defaultChecked={v.requireWebsite} />
              <Toggle name="requirePhone" label="Must have a phone number" defaultChecked={v.requirePhone} />
            </div>
          </Part>

          <Part icon="bolt" tone="var(--ok)" title="After the search">
            <div className="grid md:grid-cols-2 gap-3">
              <Toggle name="autoSave" label="Save what is found" hint="Off: you look through the list first and save the ones you want." defaultChecked={v.autoSave} onChange={setAutoSave} />
              <Toggle name="autoInvestigate" label="Research them straight away" hint={firecrawlEnabled ? "Reads each website and prepares one idea. This is the part that costs money." : "Website reading is not set up, so the businesses are saved and wait."} defaultChecked={v.autoInvestigate} onChange={setAutoInvestigate} />
            </div>
            {research ? (
              <div className="mt-5 pt-5 border-t border-line">
                <Field label="Research at most" htmlFor="autoInvestigateLimit" error={errors.autoInvestigateLimit} hint="Best ones first. Empty = all of them. The rest wait until you start them.">
                  <div className="flex items-center gap-2">
                    <input id="autoInvestigateLimit" className={`input w-24 ${errors.autoInvestigateLimit ? "border-bad" : ""}`} type="number" name="autoInvestigateLimit" value={researchLimit} onChange={(e) => setResearchLimit(e.target.value)} min={1} max={500} placeholder="all" />
                    <span className="text-sm text-ink-muted">businesses</span>
                  </div>
                </Field>
              </div>
            ) : (
              <input type="hidden" name="autoInvestigateLimit" value={researchLimit} />
            )}
            {!aiEnabled && <p className="text-xs text-ink-muted mt-3">No AI model is set up: research still reads the website, but no email is written.</p>}
          </Part>

          <details className="surface group" open={moreHasError || Boolean(v.keywords || v.name) || undefined}>
            <summary className="flex items-center gap-2 px-5 py-3.5 cursor-pointer select-none text-base font-semibold">
              <Icon name="chevronRight" className="w-4 h-4 text-ink-faint transition-transform group-open:rotate-90" />
              More options
            </summary>
            <div className="grid md:grid-cols-3 gap-4 px-5 pb-5">
              <Field label="Name must contain" htmlFor="keywords" optional hint="Keeps only businesses with this word in their name." error={errors.keywords}>
                <input id="keywords" className="input" name="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
              </Field>
              <Field label="Name of this search" htmlFor="searchName" optional hint="Made from the kind and the city when empty." error={errors.name}>
                <input id="searchName" className="input" name="name" defaultValue={v.name} />
              </Field>
              <Field label="Research only from score" htmlFor="minLeadScore" error={errors.minLeadScore} hint="0 to 100. A listing with website, phone and address scores about 90.">
                <input id="minLeadScore" className={`input ${errors.minLeadScore ? "border-bad" : ""}`} type="number" name="minLeadScore" defaultValue={v.minLeadScore} min={0} max={100} />
              </Field>
            </div>
          </details>
        </div>

        <aside className="xl:sticky xl:top-5 min-w-0 space-y-5">
          <section className="surface fact" style={{ "--c": "var(--accent)" } as React.CSSProperties} aria-label="This search">
            <div className="p-5">
              <h2 className="text-base font-semibold">This search</h2>
              <p className="text-[0.95rem] mt-1.5">
                {what && city ? (
                  <>
                    Up to <strong>{est.listings || "?"}</strong> {what} in <strong>{place}</strong>
                    {areaMode === "radius" ? `, within ${radiusKm || "?"} km of the centre` : ""}.
                  </>
                ) : (
                  <span className={errorCount ? "text-bad" : "text-ink-muted"}>{!what ? "Say what kind of business to look for." : "Choose a city to see what this search covers."}</span>
                )}
              </p>

              <h3 className="text-sm font-semibold mt-5">Expected cost</h3>
              <dl className="text-sm mt-1 divide-y divide-line" aria-label="Expected cost">
                <CostRow label="Finding them" value={`${est.searchCredits} search credits`} note={`${cost.searchCreditsLeft.toLocaleString()} left`} bad={!est.enoughSearchCredits} />
                {research ? (
                  <>
                    <CostRow label={`Research, up to ${est.researched}`} value={cost.researchUsd ? `up to ${fmtUsd(est.researchUsd)}` : "no AI cost"} note={cost.pageCreditsPerResearch ? `about ${est.pageCredits} website credits · ${cost.pageCreditsLeft.toLocaleString()} left this month` : undefined} bad={!est.enoughPageCredits} />
                    {cost.autoDraft && <CostRow label="Emails for those that fit" value={`up to ${fmtUsd(est.emailUsd)}`} />}
                  </>
                ) : (
                  <CostRow label="Research" value="not started" note={cost.researchUsd ? `about ${fmtUsd(cost.researchUsd)} per business when you start it` : undefined} />
                )}
                <div className="flex items-baseline justify-between gap-3 pt-3">
                  <dt className="font-semibold">Total</dt>
                  <dd className="font-serif text-[1.6rem] leading-none font-semibold tabular-nums whitespace-nowrap">{est.totalUsd > 0 ? `up to ${fmtUsd(est.totalUsd)}` : "$0"}</dd>
                </div>
              </dl>
              {!est.enoughSearchCredits && <p className="text-xs text-bad mt-2">Not enough search credits for this search.</p>}
              {research && !est.enoughPageCredits && <p className="text-xs text-bad mt-2">Not enough website credits this month to research all of them; the rest will wait.</p>}
              <p className="text-xs text-ink-muted mt-3">
                {cost.researchUsd
                  ? `${cost.measuredFrom ? `From your last ${cost.measuredFrom} researched businesses` : "Typical figures"}: about ${fmtUsd(cost.researchUsd)} to research one${cost.autoDraft ? ` and ${fmtUsd(cost.emailUsd)} to write its email` : ""}. `
                  : ""}
                Usually less: a business with no public email is dropped early, and only the ones that fit get an email.
              </p>

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
