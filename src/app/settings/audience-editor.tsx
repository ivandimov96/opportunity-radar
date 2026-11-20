"use client";
/**
 * "Who you sell to": the kinds of business, the places, the size, what a business must have and what to
 * leave out. Everything here is what a search is made of.
 *
 * Nothing is saved from here: the values sit in hidden fields of the page's form and go with its one Save.
 */
import { useEffect, useRef, useState } from "react";
import { KIND_MAX_CHARS, MAX_KINDS, tidyKind } from "@/lib/profile-rules";
import { Icon } from "@/components/icons";
import { BUSINESS_KIND_GROUPS, matchBusinessKinds } from "@/lib/business-kinds";

interface Place {
  country: string;
  region: string;
}
type Regions = { code: string; name: string }[];

const SIZES = [
  ["solo", "One person"],
  ["small", "Small, 2 to 10 people"],
  ["medium", "Medium, 11 to 50"],
  ["large", "Larger"],
] as const;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A list of short entries a person builds: type and press Enter, or pick a suggestion; each entry is a chip with a remove button. */
function Tags({ id, values, onChange, placeholder, suggest }: { id: string; values: string[]; onChange: (next: string[]) => void; placeholder: string; suggest?: boolean }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    // Only what reads as a kind of business is taken, and only so many of them.
    const v = tidyKind(raw);
    if (v && values.length < MAX_KINDS && !values.some((x) => same(x, v))) onChange([...values, v]);
    setText("");
  };
  const ideas = suggest ? matchBusinessKinds(text, 6).filter((k) => !values.some((x) => same(x, k.label))) : [];
  return (
    <div>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mb-2">
          {values.map((v) => (
            <li key={v} className="inline-flex items-center gap-1 rounded-full bg-accent-soft text-accent-text text-sm font-medium pl-3 pr-1 h-8">
              {v}
              <button type="button" className="w-6 h-6 rounded-full grid place-items-center hover:bg-black/10" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
                <Icon name="x" className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        className="input"
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        maxLength={KIND_MAX_CHARS}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter adds the entry; it must not save the whole page.
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={() => text.trim() && add(text)}
      />
      {ideas.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {ideas.map((k) => (
            <button key={k.label} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => add(k.label.toLowerCase())}>
              <Icon name="plus" className="w-3.5 h-3.5" /> {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AudienceEditor({ initial, countries }: { initial: { kinds: string[]; places: Place[]; sizes: string[]; needsWebsite: boolean; needsPhone: boolean; exclude: string[] }; countries: { code: string; name: string }[] }) {
  const [kinds, setKinds] = useState(initial.kinds);
  const [places, setPlaces] = useState<Place[]>(initial.places);
  const [sizes, setSizes] = useState<string[]>(initial.sizes);
  const [needsWebsite, setNeedsWebsite] = useState(initial.needsWebsite);
  const [needsPhone, setNeedsPhone] = useState(initial.needsPhone);
  const [exclude, setExclude] = useState(initial.exclude);
  const [group, setGroup] = useState(BUSINESS_KIND_GROUPS[0].key);
  const [regions, setRegions] = useState<Record<string, Regions>>({});

  // The regions of each country in use, fetched once per country.
  const wanted = [...new Set(places.map((p) => p.country).filter(Boolean))].join(",");
  useEffect(() => {
    for (const c of wanted.split(",").filter(Boolean)) {
      if (regions[c]) continue;
      fetch(`/api/regions?country=${encodeURIComponent(c)}`)
        .then((r) => r.json())
        .then((d: { regions: Regions }) => setRegions((cur) => ({ ...cur, [c]: d.regions ?? [] })))
        .catch(() => setRegions((cur) => ({ ...cur, [c]: [] })));
    }
    // `regions` is read, not watched: a fetched country never needs fetching again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  const kindsText = kinds.join("\n");
  const placesText = places
    .filter((p) => p.country)
    .map((p) => [p.country, p.region].filter(Boolean).join(" | "))
    .join("\n");
  const snapshot = JSON.stringify([kindsText, placesText, sizes, needsWebsite, needsPhone, exclude]);

  // The page's Save bar listens for changes in its form; choices made with buttons are announced to it here.
  const root = useRef<HTMLDivElement>(null);
  const first = useRef(snapshot);
  useEffect(() => {
    if (snapshot !== first.current) root.current?.querySelector("input[type=hidden]")?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [snapshot]);

  const namedPlaces = places.filter((p) => p.country);
  const setPlace = (i: number, patch: Partial<Place>) => setPlaces((cur) => cur.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const shownGroup = BUSINESS_KIND_GROUPS.find((g) => g.key === group) ?? BUSINESS_KIND_GROUPS[0];

  return (
    <div ref={root} className="space-y-6">
      <input type="hidden" name="targetKinds" value={kindsText} />
      <input type="hidden" name="targetPlaces" value={placesText} />
      <input type="hidden" name="targetSizes" value={sizes.join(",")} />
      <input type="hidden" name="excludeKinds" value={exclude.join("\n")} />

      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <label htmlFor="targetKindsInput" className="text-sm font-medium text-ink">
            Kinds of business
          </label>
          {!kinds.length && <span className="rounded-full bg-warn-soft text-warn text-[0.7rem] font-semibold px-1.5 leading-5">Required</span>}
        </div>
        <Tags id="targetKindsInput" values={kinds} onChange={setKinds} placeholder="Type a kind and press Enter, for example sign makers" suggest />
        <details className="mt-2.5">
          <summary className="disclosure text-xs text-ink-muted">Pick from a list of ideas</summary>
          <div className="mt-2.5">
            <div className="flex flex-wrap gap-1 mb-2.5" role="tablist" aria-label="Fields">
              {BUSINESS_KIND_GROUPS.map((g) => (
                <button key={g.key} type="button" role="tab" aria-selected={g.key === shownGroup.key} onClick={() => setGroup(g.key)} className={`px-2.5 h-8 rounded-[var(--radius-sm)] text-xs font-semibold ${g.key === shownGroup.key ? "bg-surface-3 text-ink" : "text-ink-muted hover:bg-surface-2"}`}>
                  {g.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {shownGroup.kinds.map((k) => {
                const label = k.label.toLowerCase();
                const on = kinds.some((x) => same(x, label));
                return (
                  <button key={k.label} type="button" className={`chip ${on ? "chip-active" : ""}`} onClick={() => setKinds(on ? kinds.filter((x) => !same(x, label)) : [...kinds, label])}>
                    {k.label}
                  </button>
                );
              })}
            </div>
          </div>
        </details>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm font-medium text-ink">Where</span>
          {!namedPlaces.length && <span className="rounded-full bg-warn-soft text-warn text-[0.7rem] font-semibold px-1.5 leading-5">Required</span>}
        </div>
        {places.length > 0 && (
          <ul className="space-y-2 mb-2.5">
            {places.map((p, i) => {
              const list = regions[p.country] ?? [];
              return (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center">
                  <select className="select" value={p.country} onChange={(e) => setPlace(i, { country: e.target.value, region: "" })} aria-label={`Country, place ${i + 1}`}>
                    <option value="">Choose a country</option>
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select className="select" value={p.region} onChange={(e) => setPlace(i, { region: e.target.value })} disabled={!p.country} aria-label={`Region, place ${i + 1}`}>
                    <option value="">Whole country</option>
                    {/* A saved region shows at once, before the list of its country has arrived. */}
                    {p.region && !list.some((x) => x.code === p.region) && <option value={p.region}>{p.region}</option>}
                    {list.map((x) => (
                      <option key={x.code} value={x.code}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-sm btn-ghost px-2 text-ink-faint hover:text-bad" onClick={() => setPlaces((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remove place ${i + 1}`} title="Remove">
                    <Icon name="x" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className="btn btn-sm" onClick={() => setPlaces((cur) => [...cur, { country: cur.at(-1)?.country ?? "", region: "" }])}>
          <Icon name="plus" /> Add a place
        </button>
      </div>

      <details open={Boolean(initial.sizes.length || initial.needsWebsite || initial.needsPhone || initial.exclude.length)}>
        <summary className="disclosure text-sm font-medium">Narrow it down (optional)</summary>
        <div className="space-y-6 mt-4">
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-6">
        <fieldset>
          <legend className="text-sm font-medium text-ink mb-1.5">
            Size of business <span className="text-xs font-normal text-ink-faint">optional</span>
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {SIZES.map(([key, label]) => {
              const on = sizes.includes(key);
              return (
                <button key={key} type="button" aria-pressed={on} className={`chip ${on ? "chip-active" : ""}`} onClick={() => setSizes(on ? sizes.filter((x) => x !== key) : [...sizes, key])}>
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-ink-muted mt-1.5">None chosen means any size.</p>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium text-ink mb-1.5">
            They must have <span className="text-xs font-normal text-ink-faint">optional</span>
          </legend>
          <div className="space-y-2">
            {(
              [
                ["targetNeedsWebsite", "A website", needsWebsite, setNeedsWebsite],
                ["targetNeedsPhone", "A phone number", needsPhone, setNeedsPhone],
              ] as const
            ).map(([name, label, on, set]) => (
              <label key={name} className="flex items-center gap-2.5 text-sm cursor-pointer">
                <input type="checkbox" name={name} checked={on} onChange={(e) => set(e.target.checked)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div>
        <label htmlFor="excludeKindsInput" className="block text-sm font-medium text-ink mb-1.5">
          Kinds of business to leave out <span className="text-xs font-normal text-ink-faint">optional</span>
        </label>
        <Tags id="excludeKindsInput" values={exclude} onChange={setExclude} placeholder="For example franchises, car dealers" />
      </div>
        </div>
      </details>

    </div>
  );
}
