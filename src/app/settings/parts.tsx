/**
 * The building blocks of every Settings page, so they all read the same way:
 *
 *  - `SettingsForm`: a page. One form, and one Save bar that appears at the bottom once something is changed.
 *  - `Group`: one card about one thing. A page is a stack of them.
 *  - `Row`: one setting. Its name and a one-line explanation on the left, the control on the right.
 *  - `Toggle`: an on/off setting as a switch.
 *  - `Choice`: one of a few ways to work, each explained, as a card to pick.
 *
 * Nothing here knows about a particular setting: the page says what goes where.
 */
import type { ReactNode } from "react";
import { resetSettingsAction, saveSettingsAction } from "@/app/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { SaveBar } from "./save-bar";

/**
 * The form of one Settings page: every card inside it is saved by the one Save bar at its bottom.
 * `group` lets a text anywhere on the page follow a control with plain CSS (`group-has-[...]`), so what a
 * choice means is shown the moment it is made, before anything is saved.
 */
export function SettingsForm({ children, className = "", resettable = false }: { children: ReactNode; className?: string; /** The page offers "Reset to defaults" for its cards. */ resettable?: boolean }) {
  return (
    <form action={saveSettingsAction} className={`group space-y-5 ${className}`}>
      {children}
      {resettable && (
        <div className="flex items-center justify-between gap-3 flex-wrap px-1">
          <span className="text-xs text-ink-faint">Changed something you did not mean to?</span>
          <ConfirmButton formAction={resetSettingsAction} formNoValidate confirmLabel="Reset" className="btn btn-sm btn-ghost text-ink-muted" message="Reset this page to its defaults? Every setting on this page goes back to how the app comes, at once. Other pages are not touched.">
            Reset to defaults
          </ConfirmButton>
        </div>
      )}
      <SaveBar />
    </form>
  );
}

/**
 * One card about one thing: a heading and rows. `section` names the fields it owns; the page's Save
 * saves the fields of every card that sits in its form. Without a section the card only shows things.
 */
export function Group({ id, title, description, section, children, aside, className = "" }: { id?: string; title: ReactNode; description?: ReactNode; section?: string; children: ReactNode; /** Shown at the right of the heading: a switch that turns the whole card on or off. */ aside?: ReactNode; className?: string }) {
  return (
    <section id={id} className={`surface min-w-0 scroll-mt-4 ${className}`}>
      {section && <input type="hidden" name="section" value={section} />}
      <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-6">{title}</h2>
          {description && <p className="text-sm text-ink-muted mt-0.5">{description}</p>}
        </div>
        {aside && <div className="shrink-0 pt-0.5">{aside}</div>}
      </header>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

/**
 * One setting. `stack` puts the control under the text, for a control that needs the full width
 * (a long text, a list); otherwise the control sits on the right, in a column of its own.
 */
export function Row({ label, help, htmlFor, children, stack = false, end = false }: { label: ReactNode; help?: ReactNode; htmlFor?: string; children: ReactNode; stack?: boolean; /** The control sits at the right edge (a switch). */ end?: boolean }) {
  return (
    <div className={`px-5 py-4 ${stack ? "space-y-2.5" : "grid sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)] gap-x-6 gap-y-2.5 sm:items-center"}`}>
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {help && <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{help}</p>}
      </div>
      <div className={`min-w-0 ${end ? "sm:flex sm:justify-end" : ""}`}>{children}</div>
    </div>
  );
}

/**
 * A text field with its label on top: for the pages that are a form to fill in (who you are, what you offer),
 * where fields sit side by side. `wide` takes the whole line; `needed` marks a field that is still missing
 * and without which nothing can be sent.
 */
export function Field({ label, name, value, placeholder, hint, wide = false, needed = false, neededLabel = "Required", optional = false, required = false, minLength, maxLength, pattern, title, autoComplete, rows }: { label: string; name: string; value: string; placeholder?: string; hint?: ReactNode; wide?: boolean; needed?: boolean; /** What the missing field holds up. */ neededLabel?: string; optional?: boolean; /** The form cannot be sent without it. */ required?: boolean; /** The fewest and the most characters it takes. */ minLength?: number; maxLength?: number; /** The shape the whole value must have, and what to say when it does not. */ pattern?: string; title?: string; autoComplete?: string; /** A number of lines makes it a text area. */ rows?: number }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <div className="flex items-center gap-2 mb-1.5">
        <label htmlFor={name} className="text-sm font-medium text-ink">
          {label}
        </label>
        {needed && <span className="rounded-full bg-warn-soft text-warn text-[0.7rem] font-semibold px-1.5 leading-5">{neededLabel}</span>}
        {optional && <span className="text-xs text-ink-faint">optional</span>}
      </div>
      {rows ? <textarea className={`textarea ${needed ? "border-[var(--warn)]" : ""}`} id={name} name={name} rows={rows} defaultValue={value} placeholder={placeholder} required={required} minLength={minLength} maxLength={maxLength} title={title} /> : <input className={`input ${needed ? "border-[var(--warn)]" : ""}`} id={name} name={name} defaultValue={value} placeholder={placeholder} autoComplete={autoComplete} required={required} minLength={minLength} maxLength={maxLength} pattern={pattern} title={title} />}
      {hint && <p className="text-xs text-ink-muted mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  );
}

/** The fields of a form card, two to a line on a wide screen. */
export function Fields({ children }: { children: ReactNode }) {
  return <div className="grid sm:grid-cols-2 gap-x-5 gap-y-5 px-5 py-5">{children}</div>;
}

/** A plain block inside a card, for something that is not a setting (a note, a preview). */
export function Block({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}

/** An on/off setting. A real checkbox underneath, so it saves like one and works with the keyboard. */
export function Toggle({ name, on, label, id }: { name: string; on: boolean; /** Read out for the switch when it has no visible label beside it. */ label?: string; id?: string }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer select-none">
      <input type="checkbox" id={id ?? name} name={name} defaultChecked={on} aria-label={label} className="peer sr-only" />
      <span className="w-11 h-6 rounded-full bg-surface-3 border border-line transition-colors peer-checked:bg-[var(--accent)] peer-checked:border-[var(--accent)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)]" />
      <span className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
    </label>
  );
}

/** A number with what it counts written after it ("20 emails"). */
export function NumberInput({ name, value, unit, min, max, id }: { name: string; value: number; unit?: string; min?: number; max?: number; id?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input className="input w-24 tabular-nums" id={id ?? name} name={name} type="number" defaultValue={value} min={min} max={max} inputMode="numeric" />
      {unit && <span className="text-sm text-ink-muted">{unit}</span>}
    </div>
  );
}

/**
 * One of a few ways to work, as a tile: an icon, its name, what it means, and anything that belongs to it
 * (a number that only matters for this choice). Tiles stand side by side, so the choices are compared at a glance.
 */
export function ModeTile({ name, value, checked, icon, title, tag, children, extra }: { name: string; value: string; checked: boolean; icon: ReactNode; title: ReactNode; /** A word about who it is for ("Safest", "Most hands-off"). */ tag?: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <label className="relative flex flex-col gap-3 rounded-xl border border-line p-4 cursor-pointer transition-colors hover:bg-surface-2 has-[:checked]:border-[var(--accent)] has-[:checked]:bg-accent-soft/40 has-[:checked]:ring-1 has-[:checked]:ring-[var(--accent)]">
      <span className="flex items-center justify-between gap-2">
        <span className="w-9 h-9 rounded-lg bg-surface-3 text-ink-muted grid place-items-center [label:has(:checked)_&]:bg-[var(--accent)] [label:has(:checked)_&]:text-[var(--accent-fg)]">{icon}</span>
        <input type="radio" name={name} value={value} defaultChecked={checked} className="accent-[var(--accent)]" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        {tag && <span className="block text-[0.7rem] font-semibold uppercase tracking-wide text-ink-faint mt-0.5">{tag}</span>}
        <span className="block text-xs text-ink-muted mt-1.5 leading-relaxed">{children}</span>
      </span>
      {extra && <span className="mt-auto pt-1 block">{extra}</span>}
    </label>
  );
}

/** One of a few ways to work: a card to pick, with what it means underneath. */
export function Choice({ name, value, checked, title, children }: { name: string; value: string; checked: boolean; title: ReactNode; children?: ReactNode }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-line px-4 py-3 cursor-pointer transition-colors hover:bg-surface-2 has-[:checked]:border-[var(--accent)] has-[:checked]:bg-accent-soft/40 has-[:checked]:ring-1 has-[:checked]:ring-[var(--accent)]">
      <input type="radio" name={name} value={value} defaultChecked={checked} className="mt-1 accent-[var(--accent)]" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        {children && <span className="block text-xs text-ink-muted mt-0.5 leading-relaxed">{children}</span>}
      </span>
    </label>
  );
}
