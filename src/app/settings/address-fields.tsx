"use client";
/**
 * The postal address, asked for in parts: country (from the list), street, postal code (in that country's
 * own form) and town (suggested from the bundled list of places as it is typed). The browser checks each
 * part before the form is sent and the save action checks them again; underneath, the single line that ends
 * every email is shown as it will read.
 */
import { useRef, useState } from "react";
import { formatAddress, postalCodeRule, usesPostalCode } from "@/lib/address";

interface Town {
  name: string;
  region: string | null;
}
export interface AddressValue {
  street: string;
  postalCode: string;
  city: string;
  country: string;
  region: string;
}

const need = "rounded-full bg-warn-soft text-warn text-[0.7rem] font-semibold px-1.5 leading-5";

export function AddressFields({ initial, countries, onFile }: { initial: AddressValue; countries: { code: string; name: string }[]; /** An address saved before it was asked for in parts: kept until these fields replace it. */ onFile: string }) {
  const [a, setA] = useState(initial);
  const [towns, setTowns] = useState<Town[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const set = (patch: Partial<AddressValue>) => setA((cur) => ({ ...cur, ...patch }));
  const look = (q: string, country: string) => {
    if (!country) return;
    const my = ++seq.current;
    fetch(`/api/places?country=${encodeURIComponent(country)}&q=${encodeURIComponent(q)}&limit=6`)
      .then((r) => r.json())
      .then((d: { places: Town[] }) => my === seq.current && setTowns(d.places ?? []))
      .catch(() => my === seq.current && setTowns([]));
  };
  const rule = postalCodeRule(a.country);
  const postal = !a.country || usesPostalCode(a.country);
  const countryName = countries.find((c) => c.code === a.country)?.name ?? "";
  // Required while there is no address at all; an older one on file stays valid until these are filled in.
  const required = !onFile || Boolean(a.street || a.city || a.postalCode || a.country);
  const complete = Boolean(a.country && a.street.trim().length >= 4 && a.city.trim().length >= 2 && (!postal || a.postalCode.trim()));
  const label = "block text-sm font-medium text-ink";

  return (
    <fieldset className="sm:col-span-2">
      <legend className="flex items-center gap-2 mb-1.5">
        <span className={label}>Postal address</span>
        {required && !complete && <span className={need}>Required</span>}
      </legend>
      <div className="rounded-xl border border-line bg-surface-2/60 p-4">
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-4">
          <div>
            <label htmlFor="addressCountry" className={`${label} mb-1.5`}>
              Country
            </label>
            <select id="addressCountry" name="addressCountry" className="select" value={a.country} required={required} autoComplete="country" onChange={(e) => { set({ country: e.target.value, city: "", region: "" }); setTowns([]); }}>
              <option value="">Choose a country</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="addressStreet" className={`${label} mb-1.5`}>
              Street and number
            </label>
            <input id="addressStreet" name="addressStreet" className="input" value={a.street} required={required} minLength={4} maxLength={100} autoComplete="address-line1" placeholder="12 Mill Lane" title="The street and number, as on a letter" onChange={(e) => set({ street: e.target.value })} />
          </div>
          <div>
            <label htmlFor="addressPostalCode" className={`${label} mb-1.5`}>
              Postal code {!postal && <span className="text-xs font-normal text-ink-faint">not used here</span>}
            </label>
            <input id="addressPostalCode" name="addressPostalCode" className="input" value={a.postalCode} required={required && postal} maxLength={12} pattern={rule.pattern} autoComplete="postal-code" placeholder={rule.example} title={`A postal code as written in ${countryName || "that country"}${rule.example ? `, for example ${rule.example}` : ""}`} disabled={!a.country} onChange={(e) => set({ postalCode: e.target.value })} />
          </div>
          <div className="relative">
            <label htmlFor="addressCity" className={`${label} mb-1.5`}>
              Town or city
            </label>
            <input
              id="addressCity"
              name="addressCity"
              className="input"
              value={a.city}
              required={required}
              minLength={2}
              maxLength={80}
              pattern={"[\\p{L}][\\p{L}\\p{M} .'’\\-]*[\\p{L}.]"}
              title="The name of the town or city, in letters"
              autoComplete="off"
              disabled={!a.country}
              placeholder={a.country ? "Start typing and pick it" : "Choose a country first"}
              onChange={(e) => {
                set({ city: e.target.value, region: "" });
                setOpen(true);
                look(e.target.value, a.country);
              }}
              onFocus={() => {
                setOpen(true);
                if (!towns.length) look(a.city, a.country);
              }}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
            />
            <input type="hidden" name="addressRegion" value={a.region} />
            {open && towns.length > 0 && (
              <ul role="listbox" aria-label="Towns" className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-[var(--radius-sm)] border border-line bg-surface shadow-lg text-sm">
                {towns.map((t) => (
                  <li
                    key={`${t.name}-${t.region}`}
                    role="option"
                    aria-selected={false}
                    className="px-3 py-2 cursor-pointer hover:bg-accent-soft"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      set({ city: t.name, region: (t.region ?? "").toUpperCase() });
                      setOpen(false);
                    }}
                  >
                    {t.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <p className="text-xs text-ink-muted mt-3 leading-relaxed">
          {complete ? (
            <>
              Under your name in every email: <span className="text-ink font-medium">{formatAddress({ street: a.street.trim(), postalCode: a.postalCode.trim().toUpperCase(), city: a.city.trim(), country: a.country }, countryName)}</span>
            </>
          ) : onFile && !required ? (
            <>
              On file: <span className="text-ink font-medium">{onFile}</span>. Fill in the parts above to replace it.
            </>
          ) : (
            "It appears under your name in every email. Business email must carry a real postal address in many countries."
          )}
        </p>
      </div>
    </fieldset>
  );
}
