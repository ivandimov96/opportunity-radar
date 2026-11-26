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
import { distanceChoices, distanceText, nearestChoiceKm } from "@/lib/distance";

interface Place {
  country: string;
  region: string;
  /** A town to work outward from, and how far; absent for a whole region or country. */
  city?: string;
  radiusKm?: number;
}
/** A place while it is being edited: `near` = around a town (which may not be chosen yet). */
type Row = Place & { near: boolean };
const USUAL_KM = 25;
interface Town {
  name: string;
  region: string | null;
  population: number;
}

/** A town of one country, picked from the bundled list of places as the person types. */
function TownInput({ country, value, label, onPick }: { country: string; value: string; label: string; onPick: (t: Town | null) => void }) {
  const [text, setText] = useState(value);
  const [items, setItems] = useState<Town[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const look = (q: string) => {
    if (!country) return;
    const my = ++seq.current;
    fetch(`/api/places?country=${encodeURIComponent(country)}&q=${encodeURIComponent(q)}&limit=6`)
      .then((r) => r.json())
      .then((d: { places: Town[] }) => my === seq.current && setItems(d.places ?? []))
      .catch(() => my === seq.current && setItems([]));
  };
  return (
    <div className="relative">
      <input
        className="input"
        value={text}
        disabled={!country}
        placeholder={country ? "Your town or city" : "Choose a country first"}
        aria-label={label}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          onPick(null);
          setOpen(true);
          look(e.target.value);
        }}
        onFocus={() => {
          setOpen(true);
          if (!items.length) look(text);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (open && items[0]) {
              setText(items[0].name);
              onPick(items[0]);
              setOpen(false);
            }
          }
        }}
      />
      {open && items.length > 0 && (
        <ul role="listbox" className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-[var(--radius-sm)] border border-line bg-surface shadow-lg text-sm">
          {items.map((t) => (
            <li
              key={`${t.name}-${t.region}`}
              role="option"
              aria-selected={false}
              className="px-3 py-2 cursor-pointer hover:bg-accent-soft"
              onMouseDown={(e) => {
                e.preventDefault();
                setText(t.name);
                onPick(t);
                setOpen(false);
              }}
            >
              {t.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
  // Never an empty list: a first place stands ready to be filled in (it is saved only once it says where).
  const [places, setPlaces] = useState<Row[]>(initial.places.length ? initial.places.map((p) => ({ ...p, near: Boolean(p.city) })) : [{ country: "", region: "", near: true }]);
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
  // A place is saved once it says where: a country (and region), or a town that was picked from the list.
  const complete = (p: Row) => Boolean(p.country) && (!p.near || Boolean(p.city));
  const placesText = places
    .filter(complete)
    .map((p) => (p.near ? [p.country, p.region, p.city, nearestChoiceKm(p.radiusKm ?? USUAL_KM, p.country)].join(" | ") : [p.country, p.region].filter(Boolean).join(" | ")))
    .join("\n");
  const snapshot = JSON.stringify([kindsText, placesText, sizes, needsWebsite, needsPhone, exclude]);

  // The page's Save bar listens for changes in its form; choices made with buttons are announced to it here.
  const root = useRef<HTMLDivElement>(null);
  const first = useRef(snapshot);
  useEffect(() => {
    if (snapshot !== first.current) root.current?.querySelector("input[type=hidden]")?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [snapshot]);

  const namedPlaces = places.filter(complete);
  const countryLabel = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
  const regionLabel = (p: Row) => (regions[p.country] ?? []).find((x) => x.code === p.region)?.name ?? p.region;
  const setPlace = (i: number, patch: Partial<Row>) => setPlaces((cur) => cur.map((p, j) => (j === i ? { ...p, ...patch } : p)));
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
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-ink">Where are they?</span>
          {!namedPlaces.length && <span className="rounded-full bg-warn-soft text-warn text-[0.7rem] font-semibold px-1.5 leading-5">Required</span>}
        </div>
        <p className="text-xs text-ink-muted mb-2.5">Around your own town if you work locally, or a whole region or country if distance does not matter.</p>
        {places.length > 0 && (
          <ul className="space-y-2.5 mb-2.5">
            {places.map((p, i) => {
              const list = regions[p.country] ?? [];
              return (
                <li key={i} className="rounded-xl border border-line bg-surface-2/60 p-4">
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <div className="inline-flex rounded-[var(--radius-sm)] border border-line overflow-hidden text-sm" role="radiogroup" aria-label={`Kind of place ${i + 1}`}>
                      <button type="button" role="radio" aria-checked={p.near} className={`px-3 h-9 font-medium ${p.near ? "bg-accent-soft text-accent-text" : "text-ink-muted hover:bg-surface-2"}`} onClick={() => setPlace(i, { near: true, region: "" })}>
                        Around a town
                      </button>
                      <button type="button" role="radio" aria-checked={!p.near} className={`px-3 h-9 font-medium border-l border-line ${!p.near ? "bg-accent-soft text-accent-text" : "text-ink-muted hover:bg-surface-2"}`} onClick={() => setPlace(i, { near: false, city: undefined, radiusKm: undefined, region: "" })}>
                        A region or country
                      </button>
                    </div>
                    {places.length > 1 && (
                      <button type="button" className="btn btn-sm btn-ghost px-2 text-ink-faint hover:text-bad" onClick={() => setPlaces((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remove place ${i + 1}`} title="Remove">
                        <Icon name="x" />
                      </button>
                    )}
                  </div>
                  <div className={`grid gap-2 ${p.near ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" : "sm:grid-cols-2"}`}>
                    <select className="select" value={p.country} onChange={(e) => setPlace(i, { country: e.target.value, region: "", city: undefined, radiusKm: p.near ? nearestChoiceKm(p.radiusKm ?? USUAL_KM, e.target.value) : undefined })} aria-label={`Country, place ${i + 1}`}>
                      <option value="">Choose a country</option>
                      {countries.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {p.near ? (
                      <>
                        {/* Remade when the country changes, so the town of another country does not stay in the box. */}
                        <TownInput key={p.country} country={p.country} value={p.city ?? ""} label={`Town, place ${i + 1}`} onPick={(t) => setPlace(i, t ? { city: t.name, region: (t.region ?? "").toUpperCase(), radiusKm: nearestChoiceKm(p.radiusKm ?? USUAL_KM, p.country) } : { city: undefined })} />
                        {/* Miles where the country counts in miles; what is saved is always kilometres. */}
                        <select className="select" value={nearestChoiceKm(p.radiusKm ?? USUAL_KM, p.country)} onChange={(e) => setPlace(i, { radiusKm: Number(e.target.value) })} aria-label={`Distance, place ${i + 1}`}>
                          {distanceChoices(p.country).map((c) => (
                            <option key={c.km} value={c.km}>
                              within {c.label}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
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
                    )}
                  </div>
                  {/* What this place means for the searches, in one line. */}
                  <p className="text-xs text-ink-muted mt-2">
                    {!p.country
                      ? "Choose the country first."
                      : p.near
                        ? p.city
                          ? `Searches start in ${p.city} and move outward to the towns within ${distanceText(nearestChoiceKm(p.radiusKm ?? USUAL_KM, p.country), p.country)}, nearest first.`
                          : "Type the town and pick it from the list."
                        : `Searches work through the cities of ${p.region ? regionLabel(p) : countryLabel(p.country)}, largest first.`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className="btn btn-sm btn-ghost text-accent-text" onClick={() => setPlaces((cur) => [...cur, { country: cur.at(-1)?.country ?? "", region: "", near: true }])}>
          <Icon name="plus" /> Add another place
        </button>
      </div>

      <div>
        <div className="text-sm font-medium text-ink">Which of them are worth writing to?</div>
        <p className="text-xs text-ink-muted mt-0.5 mb-2.5">All optional. Each answer keeps businesses that would not buy out of your searches.</p>
        {/* One card, one line per question: the question on the left, its answers on the right, all answered the same way. */}
        <div className="rounded-xl border border-line bg-surface-2/60 divide-y divide-line">
          <fieldset className="grid sm:grid-cols-[9.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 p-4">
            <legend className="sr-only">Size</legend>
            <div aria-hidden="true">
              <div className="text-sm font-medium text-ink">Size</div>
              <div className="text-xs text-ink-muted mt-0.5">Any size if none is chosen</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SIZES.map(([key, label]) => {
                const on = sizes.includes(key);
                return (
                  <button key={key} type="button" aria-pressed={on} className={`chip ${on ? "chip-active" : ""}`} onClick={() => setSizes(on ? sizes.filter((x) => x !== key) : [...sizes, key])}>
                    {on && <Icon name="check" className="w-3 h-3" />} {label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset className="grid sm:grid-cols-[9.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 p-4">
            <legend className="sr-only">They must have</legend>
            <div aria-hidden="true">
              <div className="text-sm font-medium text-ink">They must have</div>
              <div className="text-xs text-ink-muted mt-0.5">Others are left out</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["targetNeedsWebsite", "A website", needsWebsite, setNeedsWebsite],
                  ["targetNeedsPhone", "A phone number", needsPhone, setNeedsPhone],
                ] as const
              ).map(([name, label, on, set]) => (
                <span key={name}>
                  {/* Saved like the checkbox it replaces: "on" when chosen. */}
                  <input type="hidden" name={name} value={on ? "on" : ""} />
                  <button type="button" aria-pressed={on} className={`chip ${on ? "chip-active" : ""}`} onClick={() => set(!on)}>
                    {on && <Icon name="check" className="w-3 h-3" />} {label}
                  </button>
                </span>
              ))}
            </div>
          </fieldset>
          <div className="grid sm:grid-cols-[9.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 p-4">
            <div>
              <label htmlFor="excludeKindsInput" className="block text-sm font-medium text-ink">
                Leave out
              </label>
              <div className="text-xs text-ink-muted mt-0.5">Kinds of business never to find</div>
            </div>
            <Tags id="excludeKindsInput" values={exclude} onChange={setExclude} placeholder="For example franchises, car dealers" />
          </div>
        </div>
      </div>
    </div>
  );
}
