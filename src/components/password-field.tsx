"use client";
/** A password field with a "Show" button, so a typo can be seen before the form is sent. */
import { useState } from "react";

export function PasswordField({ id = "password", autoComplete, minLength, autoFocus }: { id?: string; autoComplete: string; minLength?: number; autoFocus?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input className="input pr-16" id={id} name="password" type={shown ? "text" : "password"} autoComplete={autoComplete} required minLength={minLength} autoFocus={autoFocus} />
      <button type="button" onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-label={shown ? "Hide the password" : "Show the password"} className="absolute right-1 top-1/2 -translate-y-1/2 h-9 px-3 rounded-md text-xs font-semibold text-ink-muted hover:bg-surface-3 hover:text-ink">
        {shown ? "Hide" : "Show"}
      </button>
    </div>
  );
}
