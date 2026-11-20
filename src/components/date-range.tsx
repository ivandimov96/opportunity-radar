"use client";
/**
 * One dropdown for the period ("Last 7 days", "This month", ...), used on the
 * Dashboard and the Businesses list. Picking a choice applies it at once;
 * "Custom dates…" shows two day fields and an Apply button. An optional second
 * dropdown says which date the period refers to (found, researched, ...).
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_RANGE, RANGE_OPTIONS, type RangeKey } from "@/lib/date-range";
import { Icon } from "./icons";
import { holdScroll } from "./keep-scroll";

export function DateRangePicker({ basePath, params = {}, value, from, to, fields, field }: { basePath: string; params?: Record<string, string>; value: RangeKey; from: string | null; to: string | null; fields?: readonly { key: string; label: string }[]; field?: string }) {
  const router = useRouter();
  const [custom, setCustom] = useState(value === "custom");
  const [start, setStart] = useState(value === "custom" ? (from ?? "") : "");
  const [end, setEnd] = useState(value === "custom" ? (to ?? "") : "");
  // The page decides the period: when it changes (a link, Reset, the back button), the control follows.
  useEffect(() => {
    setCustom(value === "custom");
    setStart(value === "custom" ? (from ?? "") : "");
    setEnd(value === "custom" ? (to ?? "") : "");
  }, [value, from, to]);

  const go = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const k of ["range", "from", "to", "page"]) p.delete(k);
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v);
    else p.delete(k);
    const q = p.toString();
    holdScroll();
    router.push(`${basePath}${q ? `?${q}` : ""}`, { scroll: false });
  };
  const pick = (key: RangeKey) => {
    if (key === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    go({ range: key === DEFAULT_RANGE ? null : key });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Icon name="clock" className="w-3.5 h-3.5 text-ink-faint" />
      {fields && fields.length > 1 && (
        <select className="select w-auto h-8 py-0 text-xs" aria-label="Which date" value={field ?? fields[0].key} onChange={(e) => go({ range: value === DEFAULT_RANGE ? null : value, from: value === "custom" ? from : null, to: value === "custom" ? to : null, dateField: e.target.value === fields[0].key ? null : e.target.value })}>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
      )}
      <select className="select w-auto h-8 py-0 text-xs font-medium" aria-label="Date range" value={custom ? "custom" : value} onChange={(e) => pick(e.target.value as RangeKey)}>
        {RANGE_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      {custom && (
        <span className="flex flex-wrap items-center gap-1.5">
          <input className="input w-auto h-8 py-0 text-xs" type="date" value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} aria-label="From date" />
          <span className="text-ink-faint">to</span>
          <input className="input w-auto h-8 py-0 text-xs" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} aria-label="To date" />
          <button type="button" className="btn btn-sm" disabled={!start && !end} onClick={() => go({ range: "custom", from: start || null, to: end || null })}>
            Apply
          </button>
        </span>
      )}
    </div>
  );
}
