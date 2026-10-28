"use client";
/**
 * The search form: every input, its validation state and the live summary of
 * what the search will collect. Server-validated (src/lib/search-input.ts);
 * on error the form re-renders with the submitted values and inline messages.
 */
import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { createSearch, type CreateSearchState } from "@/app/actions";
import { Callout, Card, Icon } from "@/components/ui";
import type { RawSearchValues } from "@/lib/search-input";
import { US_STATES } from "@/lib/geo/us-states";
import { CitySelect } from "./city-select";

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
  available: boolean;
  reason?: string;
}

function Field({ label, hint, error, children, optional }: { label: string; hint?: string; error?: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <div>
      <label className="label">
        {label} {optional && <span className="normal-case font-normal text-ink-faint">(optional)</span>}
      </label>
      {children}
      {error ? <p className="text-xs text-bad mt-1">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

function Toggle({ name, label, hint, defaultChecked }: { name: string; label: string; hint?: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-line p-3 cursor-pointer hover:bg-surface-2">
      <input type="hidden" name={name} value="off" />
      <input type="checkbox" name={name} value="on" defaultChecked={defaultChecked} className="mt-1 accent-[var(--accent)]" />
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-ink-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function SearchForm(props: { playbooks: PlaybookOption[]; providers: ProviderOption[]; aiEnabled: boolean; webSearchEnabled: boolean; defaults: RawSearchValues }) {
  const [state, action, pending] = useActionState<CreateSearchState, FormData>(createSearch, null);
  // Remount the fields whenever the server returns a new state so every input (and the local
  // selection state) re-initializes from the submitted values; React otherwise resets the form.
  const key = state ? JSON.stringify(state.values) : "initial";
  return <SearchFields key={key} {...props} state={state} action={action} pending={pending} />;
}

function SearchFields({ playbooks, providers, aiEnabled, webSearchEnabled, defaults, state, action, pending }: { playbooks: PlaybookOption[]; providers: ProviderOption[]; aiEnabled: boolean; webSearchEnabled: boolean; defaults: RawSearchValues; state: CreateSearchState; action: (fd: FormData) => void; pending: boolean }) {
  const v = state?.values ?? defaults;
  const errors = state?.errors ?? {};
  const [industry, setIndustry] = useState(v.industry);
  const [segments, setSegments] = useState<string[]>(v.segments);
  const [areaMode, setAreaMode] = useState<"area" | "radius">(v.areaMode);
  const [country, setCountry] = useState(v.country === "US" || !v.country ? "US" : "OTHER");
  const [region, setRegion] = useState(v.region.toUpperCase());
  const isTexas = country === "US" && region === "TX";
  const [autoInvestigate, setAutoInvestigate] = useState(v.autoInvestigate);
  const [providersSel, setProvidersSel] = useState<string[]>(v.providers.length ? v.providers : ["osm"]);
  const playbook = useMemo(() => playbooks.find((p) => p.key === industry) ?? playbooks[0], [playbooks, industry]);
  const usableKey = (k: string) => {
    const p = providers.find((x) => x.key === k);
    return Boolean(p?.available) && (k !== "tx_permits" || isTexas);
  };
  const effectiveProviders = providersSel.filter(usableKey);
  const demoOnly = effectiveProviders.length === 1 && effectiveProviders[0] === "demo";
  const errorCount = Object.keys(errors).length;

  const toggleSegment = (k: string) => setSegments((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const toggleProvider = (k: string) => setProvidersSel((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  return (
    <form action={action} noValidate>
      <div className="grid gap-5 xl:grid-cols-2">
        {errorCount > 0 && (
          <div className="xl:col-span-2">
            <Callout tone="bad" title={`${errorCount} thing${errorCount === 1 ? "" : "s"} to fix`}>
              {errors.form ?? "Check the highlighted fields below."}
            </Callout>
          </div>
        )}

        <Card className="xl:col-span-2" title="1 · What kind of business" description="The business type sets what we look for on the map, which workflows and tools we check, and which opportunity patterns apply.">
          <div className="grid md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-3">
            {playbooks.map((p) => (
              <label key={p.key} className={`flex items-start gap-3 rounded-[var(--radius-sm)] border p-3 cursor-pointer hover:bg-surface-2 ${industry === p.key ? "border-accent bg-accent-soft/40" : "border-line"}`}>
                <input type="radio" name="industry" value={p.key} checked={industry === p.key} onChange={() => { setIndustry(p.key); setSegments([]); }} className="mt-1 accent-[var(--accent)]" />
                <span className="text-sm min-w-0">
                  <span className="font-medium">{p.label}</span>
                  <span className="block text-xs text-ink-muted">{p.description}</span>
                  {!p.osmSupported && <span className="block text-[11px] text-warn mt-1">No OpenStreetMap selectors: needs Google Places or a CSV import.</span>}
                </span>
              </label>
            ))}
          </div>
          {errors.industry && <p className="text-xs text-bad mt-2">{errors.industry}</p>}

          {playbook.segments.length > 0 && (
            <div className="mt-4">
              <div className="label">Narrow to sub-types <span className="normal-case font-normal text-ink-faint">(none selected = all)</span></div>
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
              <p className="hint">{segments.length ? playbook.segments.filter((s) => segments.includes(s.key)).map((s) => s.description).join(" ") : "All sub-types are searched."}</p>
              {errors.segments && <p className="text-xs text-bad mt-1">{errors.segments}</p>}
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4 mt-4 xl:max-w-3xl">
            <Field label="Business name contains" optional hint="Case-insensitive filter on the business name, e.g. “transmission”." error={errors.keywords}>
              <input className="input" name="keywords" defaultValue={v.keywords} placeholder="e.g. transmission" />
            </Field>
            <Field label="Google query override" optional hint="Replaces the sub-type queries when Google Places is a source." error={errors.categoryQuery}>
              <input className="input" name="categoryQuery" defaultValue={v.categoryQuery} placeholder="e.g. diesel repair" />
            </Field>
          </div>
        </Card>

        <Card title="2 · Where" description="Pick the state, then start typing the city: suggestions come from a bundled list of 16,000 US places (no lookup service needed). Search the whole city area, or a radius around its center.">
          <div className="grid grid-cols-1 sm:grid-cols-[150px_1fr_1fr] gap-4">
            <Field label="Country" error={errors.country}>
              <select className="select" value={country} onChange={(e) => { setCountry(e.target.value); setRegion(""); }}>
                <option value="US">United States</option>
                <option value="OTHER">Other country</option>
              </select>
              {country === "US" ? <input type="hidden" name="country" value="US" /> : <input className="input mt-2" name="country" defaultValue={v.country === "US" ? "" : v.country} maxLength={2} placeholder="ISO code, e.g. CA" />}
            </Field>
            {country === "US" ? (
              <Field label="State" error={errors.region}>
                <select className={`select ${errors.region ? "border-bad" : ""}`} name="region" value={region} onChange={(e) => setRegion(e.target.value)}>
                  <option value="">Choose a state…</option>
                  {US_STATES.map((st) => (
                    <option key={st.code} value={st.code}>
                      {st.name} ({st.code})
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Region / state" optional error={errors.region}>
                <input className="input" name="region" defaultValue={v.region} placeholder="e.g. Ontario" />
              </Field>
            )}
            <Field label="City" error={errors.city} hint={demoOnly ? "Not needed for demo data." : country === "US" && !region ? "Choose a state first." : undefined}>
              {country === "US" ? <CitySelect state={region || null} defaultValue={v.city} hasError={Boolean(errors.city)} disabled={!region} /> : <input className={`input ${errors.city ? "border-bad" : ""}`} name="city" defaultValue={v.city} placeholder="City" autoComplete="off" />}
            </Field>
          </div>
          <div className="mt-4 grid sm:grid-cols-[auto_auto_1fr] gap-3 items-center">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="areaMode" value="area" defaultChecked={v.areaMode === "area"} onChange={() => setAreaMode("area")} className="accent-[var(--accent)]" /> Whole city / region area
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="areaMode" value="radius" defaultChecked={v.areaMode === "radius"} onChange={() => setAreaMode("radius")} className="accent-[var(--accent)]" /> Radius around the center
            </label>
            <div className={`flex items-center gap-2 ${areaMode === "radius" ? "" : "opacity-50"}`}>
              <input className={`input w-24 ${errors.radiusKm ? "border-bad" : ""}`} type="number" name="radiusKm" min={1} max={100} defaultValue={v.radiusKm} disabled={areaMode !== "radius"} />
              <span className="text-sm text-ink-muted">km</span>
              {errors.radiusKm && <span className="text-xs text-bad">{errors.radiusKm}</span>}
            </div>
          </div>
        </Card>

        <Card title="3 · Sources" description="Each source returns candidates; they are normalized and merged into one deduplicated list.">
          <div className="space-y-3">
            {providers.map((p) => {
              const usable = p.available && (p.key !== "tx_permits" || isTexas);
              const checked = providersSel.includes(p.key) && usable;
              return (
              <label key={p.key} className={`flex items-start gap-3 rounded-[var(--radius-sm)] border border-line p-3 cursor-pointer hover:bg-surface-2 ${usable ? "" : "opacity-60 cursor-not-allowed"}`}>
                <input type="checkbox" name="providers" value={p.key} checked={checked} onChange={() => toggleProvider(p.key)} disabled={!usable} className="mt-1 accent-[var(--accent)]" />
                <span className="text-sm">
                  <span className="font-medium">{p.label}</span>
                  <span className="block text-xs text-ink-muted">
                    {p.key === "overture" && (p.available ? "Bulk open data read straight from the public release (no key): names, categories, websites, phones, emails, brand and open/closed status. The most complete source; results for an area are cached." : `Unavailable here — ${p.reason}.`)}
                    {p.key === "osm" && "Free, no credentials. Data © OpenStreetMap contributors. Secondary net: catches places Overture misses; many entries lack a website (the website finder handles those)."}
                    {p.key === "google_places" && (p.available ? "Enabled. Only place IDs are stored indefinitely per Google's policies." : `Needs a key — ${p.reason}.`)}
                    {p.key === "tx_permits" && (isTexas ? "Free public registry of every active Texas business by industry code and city: names, addresses and permit dates, no phone or website (the website finder tries)." : "Texas only: choose Texas as the state to use the Comptroller's permit registry.")}
                    {p.key === "demo" && "Synthetic businesses to demonstrate the workflow. Never real companies."}
                  </span>
                </span>
              </label>
              );
            })}
            {errors.providers && <p className="text-xs text-bad">{errors.providers}</p>}
          </div>
        </Card>

        <Card title="4 · Filters" description="Applied while discovering. Skipped candidates are counted so you can see what a filter cost.">
          <div className="grid md:grid-cols-2 gap-3">
            <Toggle name="excludeChains" label="Exclude chains & franchises" hint="Known brands (Firestone, Caliber, dealerships…) and store-locator pages are skipped." defaultChecked={v.excludeChains} />
            <Toggle name="requirePhone" label="Must have a phone number" hint="Keeps only reachable businesses; also makes website verification stricter." defaultChecked={v.requirePhone} />
            <Toggle name="requireWebsite" label="Must already have a website" hint="Off by default: the investigation tries to locate a website for those without one." defaultChecked={v.requireWebsite} />
            <Toggle name="skipKnown" label="Skip businesses already in Radar" hint="New businesses only; known ones are still merged, just not listed as results." defaultChecked={v.skipKnown} />
          </div>
          <div className="grid md:grid-cols-3 gap-4 mt-4">
            <Field label="Maximum results" error={errors.maxResults} hint="Candidates with a website are listed first by the map source.">
              <input className={`input ${errors.maxResults ? "border-bad" : ""}`} type="number" name="maxResults" defaultValue={v.maxResults} min={1} max={500} />
            </Field>
          </div>
        </Card>

        <Card title="5 · Investigation" description="What happens to each result after discovery.">
          <div onChange={(e) => { const t = e.target as HTMLInputElement; if (t.name === "autoInvestigate" && t.type === "checkbox") setAutoInvestigate(t.checked); }}>
            <Toggle name="autoInvestigate" label="Investigate results automatically" hint="Best leads first: locate website if missing, crawl, off-site records, facts, hypotheses, verdict." defaultChecked={v.autoInvestigate} />
          </div>
          <div className={`grid md:grid-cols-3 gap-4 mt-4 ${autoInvestigate ? "" : "opacity-60"}`}>
            <Field label="Minimum lead score" error={errors.minLeadScore} hint="0–100. Independents with site, phone and address score ~90+; listing-only records ~40.">
              <input className={`input ${errors.minLeadScore ? "border-bad" : ""}`} type="number" name="minLeadScore" defaultValue={v.minLeadScore} min={0} max={100} />
            </Field>
            <Field label="Investigate at most" optional error={errors.autoInvestigateLimit} hint="Leave empty for all qualifying results.">
              <input className={`input ${errors.autoInvestigateLimit ? "border-bad" : ""}`} type="number" name="autoInvestigateLimit" defaultValue={v.autoInvestigateLimit} min={1} max={500} placeholder="all" />
            </Field>
            <Field label="Search name" optional hint="Generated from type and place when empty." error={errors.name}>
              <input className="input" name="name" defaultValue={v.name} placeholder="e.g. Body shops · Austin · Oct" />
            </Field>
          </div>
          {!aiEnabled && <p className="text-xs text-ink-muted mt-3">Without an Anthropic API key, verdicts come from deterministic rules over verified facts; the model stage adds subtler hypotheses and drafts.</p>}
          {!webSearchEnabled && <p className="text-xs text-ink-muted mt-1">No web search key: websites for listing-only businesses are found by verified domain guesses only. Set BRAVE_SEARCH_API_KEY to search the web too.</p>}
        </Card>

        <p className="text-xs text-ink-muted xl:col-span-2">
          {playbook.label}
          {segments.length ? ` · ${segments.length} of ${playbook.segments.length} sub-types` : ""} · {country === "US" ? (region ? US_STATES.find((st) => st.code === region)?.name ?? region : "no state yet") : "outside the US"} · {areaMode === "radius" ? "radius" : "whole area"} · {effectiveProviders.map((k) => providers.find((p) => p.key === k)?.label ?? k).join(", ") || "no source"} · {autoInvestigate ? "best leads investigated automatically" : "manual investigation"}
        </p>
        <div className="flex items-center gap-3 xl:col-span-2">
          <button className="btn btn-primary btn-lg" disabled={pending} aria-busy={pending}>
            {pending ? <Icon name="refresh" className="animate-spin" /> : <Icon name="play" />} {pending ? "Starting…" : "Start discovery"}
          </button>
          <Link href="/searches" className="btn btn-ghost">
            Cancel
          </Link>
          {pending && <span className="text-xs text-ink-muted">Validating and queueing the discovery job.</span>}
        </div>
      </div>

    </form>
  );
}
