"use client";
/**
 * City typeahead over the bundled worldwide place list (/api/places, filtered by
 * country and region; GeoNames data, no lookup service, diacritics-insensitive).
 * Keyboard: ↑/↓ to move, Enter to pick, Esc to close. Picking a suggestion also
 * fills hidden lat/lon fields so a radius search has its center without geocoding.
 */
import { useEffect, useId, useRef, useState } from "react";

export interface Suggestion {
  name: string;
  country: string;
  region: string | null;
  population: number;
  lat: number;
  lon: number;
}

const fmtPop = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function CitySelect({ country, region, defaultValue, hasError, disabled, onPick, regionLabel }: { country: string; region: string | null; defaultValue: string; hasError?: boolean; disabled?: boolean; onPick?: (s: Suggestion | null) => void; regionLabel?: (code: string | null) => string }) {
  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const fetchItems = (q: string) => {
    if (!country) return;
    const my = ++seq.current;
    setLoading(true);
    const params = new URLSearchParams({ country, q });
    if (region) params.set("region", region);
    fetch(`/api/places?${params}`)
      .then((r) => r.json())
      .then((d: { places: Suggestion[] }) => {
        if (my !== seq.current) return;
        setItems(d.places);
        setActive(d.places.length ? 0 : -1);
      })
      .catch(() => {})
      .finally(() => my === seq.current && setLoading(false));
  };

  useEffect(() => {
    // Country or region changed: the typed city may no longer apply; keep the text, drop the coordinates.
    setCenter(null);
    setItems([]);
    onPick?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, region]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const change = (v: string) => {
    setValue(v);
    setCenter(null);
    onPick?.(null);
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchItems(v), 120);
  };
  const pick = (s: Suggestion) => {
    setValue(s.name);
    setCenter({ lat: s.lat, lon: s.lon });
    setOpen(false);
    onPick?.(s);
  };

  return (
    <div ref={box} className="relative">
      <input
        className={`input ${hasError ? "border-bad" : ""}`}
        name="city"
        value={value}
        disabled={disabled}
        placeholder={country ? "Start typing a city" : "Choose a country first"}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => change(e.target.value)}
        onFocus={() => {
          setOpen(true);
          if (!items.length) fetchItems(value);
        }}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % items.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + items.length) % items.length);
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      <input type="hidden" name="centerLat" value={center?.lat ?? ""} />
      <input type="hidden" name="centerLon" value={center?.lon ?? ""} />
      {open && country && (items.length > 0 || loading) && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-[var(--radius-sm)] border border-line bg-surface shadow-lg text-sm">
          {items.map((s, i) => (
            <li key={`${s.name}-${s.region}-${s.country}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(s); }} onMouseEnter={() => setActive(i)} className={`flex items-center justify-between gap-3 px-3 py-2 cursor-pointer ${i === active ? "bg-accent-soft" : ""}`}>
              <span>
                {s.name}
                <span className="text-ink-faint">{s.region ? `, ${regionLabel ? regionLabel(s.region) : s.region}` : ""}</span>
              </span>
              <span className="text-xs text-ink-faint tabular-nums">{fmtPop(s.population)}</span>
            </li>
          ))}
          {loading && !items.length && <li className="px-3 py-2 text-xs text-ink-faint">Searching…</li>}
        </ul>
      )}
    </div>
  );
}
