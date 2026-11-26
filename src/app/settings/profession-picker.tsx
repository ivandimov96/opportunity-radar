"use client";
/**
 * A head start on "what do you sell?", in three ticks instead of an empty box:
 *   1. what kind of business you are,
 *   2. what you actually do (the services of that trade, a few ticked to begin with),
 *   3. what your customers value most.
 * The two descriptions below are written from those ticks, so they say what THIS seller does and not what
 * the trade does in general. They stay ordinary text boxes: the person can change any word.
 *
 * What they typed themselves is never overwritten: a box follows the ticks only while it still holds the
 * text the ticks wrote (or nothing). Once edited by hand, a button offers to write it from the ticks again.
 *
 * The kind chosen travels with the form (`profession`), so the next step can start with the kinds of
 * business that seller usually writes to.
 */
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { MAX_BENEFITS, MAX_SERVICES, PROFESSIONS, START_BENEFITS, START_SERVICES, offerText, resultText, type Profession } from "@/lib/professions";

// By name, not by id: the form around these fields may carry the same id as one of them.
const field = (name: string) => document.querySelector<HTMLTextAreaElement | HTMLSelectElement>(`textarea[name="${name}"], select[name="${name}"]`);
const write = (name: string, text: string) => {
  const el = field(name);
  if (!el) return;
  el.value = text;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

function Ticks({ label, hint, all, chosen, max, onChange }: { label: string; hint: string; all: string[]; chosen: string[]; max: number; onChange: (next: string[]) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">{label}</legend>
      <p className="text-xs text-ink-muted mt-0.5 mb-2">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {all.map((item) => {
          const on = chosen.includes(item);
          const full = !on && chosen.length >= max;
          return (
            <button
              key={item}
              type="button"
              className={`chip ${on ? "chip-active" : ""} ${full ? "opacity-50" : ""}`}
              aria-pressed={on}
              disabled={full}
              // Kept in the order of the list, so the sentence reads the same whichever was ticked first.
              onClick={() => onChange(all.filter((x) => (x === item ? !on : chosen.includes(x))))}
            >
              {on && <Icon name="check" className="w-3 h-3" />} {item}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ProfessionPicker() {
  const [picked, setPicked] = useState<Profession | null>(null);
  const [other, setOther] = useState(false);
  const [services, setServices] = useState<string[]>([]);
  const [benefits, setBenefits] = useState<string[]>([]);
  /** What the ticks last wrote into each box: a box that still holds it (or nothing) follows the ticks. */
  const wrote = useRef({ offer: "", offerResult: "" });
  const [byHand, setByHand] = useState({ offer: false, offerResult: false });

  const follows = (name: "offer" | "offerResult") => {
    const now = field(name)?.value.trim() ?? "";
    return !now || now === wrote.current[name];
  };
  const put = (name: "offer" | "offerResult", text: string, force = false) => {
    if (!force && !follows(name)) {
      setByHand((cur) => ({ ...cur, [name]: true }));
      return;
    }
    write(name, text);
    wrote.current[name] = text;
    setByHand((cur) => ({ ...cur, [name]: false }));
  };

  // The boxes are rewritten whenever the ticks change.
  useEffect(() => {
    if (picked) put("offer", offerText(picked, services));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, services]);
  useEffect(() => {
    if (picked) put("offerResult", resultText(benefits));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, benefits]);

  const pick = (p: Profession | null) => {
    setOther(!p);
    setPicked(p);
    setServices(p ? p.services.slice(0, START_SERVICES) : []);
    setBenefits(p ? p.benefits.slice(0, START_BENEFITS) : []);
    const step = field("firstStep");
    if (step && p) step.value = p.firstStep;
    if (!p) {
      // "Something else": what the ticks wrote is taken out again; their own words stay.
      if (follows("offer")) write("offer", "");
      if (follows("offerResult")) write("offerResult", "");
      wrote.current = { offer: "", offerResult: "" };
      field("offer")?.focus();
    }
  };

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="text-sm font-medium text-ink mb-2">What kind of business are you?</legend>
        <div className="flex flex-wrap gap-1.5">
          {PROFESSIONS.map((p) => {
            const on = picked?.key === p.key;
            return (
              <button key={p.key} type="button" className={`chip ${on ? "chip-active" : ""}`} aria-pressed={on} onClick={() => pick(p)}>
                {on && <Icon name="check" className="w-3 h-3" />} {p.label}
              </button>
            );
          })}
          <button type="button" className={`chip ${other ? "chip-active" : ""}`} aria-pressed={other} onClick={() => pick(null)}>
            Something else
          </button>
        </div>
        {!picked && <p className="text-xs text-ink-muted mt-2">{other ? "Describe it in your own words below." : "Pick one and the description below is written from a few ticks. Or write it yourself."}</p>}
      </fieldset>

      {picked && (
        <div className="rounded-xl border border-line bg-surface-2/60 p-4 space-y-5">
          <Ticks label="What do you do?" hint={`Tick what applies, up to ${MAX_SERVICES}. Your description is written from it.`} all={picked.services} chosen={services} max={MAX_SERVICES} onChange={setServices} />
          <Ticks label="What do your customers value most?" hint={`Up to ${MAX_BENEFITS}.`} all={picked.benefits} chosen={benefits} max={MAX_BENEFITS} onChange={setBenefits} />
          {(byHand.offer || byHand.offerResult) && (
            <p className="text-xs text-ink-muted">
              You changed the text below yourself, so the ticks no longer rewrite it.{" "}
              <button
                type="button"
                className="font-semibold text-accent-text underline"
                onClick={() => {
                  put("offer", offerText(picked, services), true);
                  put("offerResult", resultText(benefits), true);
                }}
              >
                Write it from my ticks again
              </button>
            </p>
          )}
        </div>
      )}
      <input type="hidden" name="profession" value={picked?.key ?? ""} />
    </div>
  );
}
