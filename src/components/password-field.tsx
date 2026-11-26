"use client";
/**
 * A password field with a "Show" button, so a typo can be seen before the form is sent. With `rules`, a
 * short list under it says what a new password needs and ticks each point off as it is typed.
 */
import { useState } from "react";

const RULES: [string, (p: string) => boolean][] = [
  ["At least 8 characters", (p) => p.length >= 8],
  ["A letter", (p) => /[A-Za-z]/.test(p)],
  ["A number", (p) => /\d/.test(p)],
];

export function PasswordField({ id = "password", name = "password", autoComplete, minLength, autoFocus, rules = false }: { id?: string; name?: string; autoComplete: string; minLength?: number; autoFocus?: boolean; /** Show what a new password needs, ticked off as it is typed. */ rules?: boolean }) {
  const [shown, setShown] = useState(false);
  const [value, setValue] = useState("");
  return (
    <div>
      <div className="relative">
        <input className="input pr-16" id={id} name={name} type={shown ? "text" : "password"} autoComplete={autoComplete} required minLength={minLength} autoFocus={autoFocus} value={value} onChange={(e) => setValue(e.target.value)} aria-describedby={rules ? `${id}-rules` : undefined} />
        <button type="button" onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-label={shown ? "Hide the password" : "Show the password"} className="absolute right-1 top-1/2 -translate-y-1/2 h-8 px-2.5 rounded-[var(--radius-sm)] text-xs font-semibold text-ink-muted hover:text-ink hover:bg-surface-2">
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {rules && (
        <ul id={`${id}-rules`} className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
          {RULES.map(([label, ok]) => {
            const met = ok(value);
            return (
              <li key={label} className={`flex items-center gap-1.5 ${met ? "text-ok" : "text-ink-faint"}`}>
                <span aria-hidden="true" className={`inline-block w-1.5 h-1.5 rounded-full ${met ? "bg-[var(--ok)]" : "bg-[var(--border)]"}`} />
                {label}
                <span className="sr-only">{met ? ": done" : ": still needed"}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
