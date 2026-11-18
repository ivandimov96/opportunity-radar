"use client";
/**
 * Subject and body of one email, with a live word count and a note when there
 * are unsaved changes. The subject field carries a "Suggest" button on its
 * right edge: it asks for other subjects for the email as written and lists
 * them under the field; clicking one puts it in the field (saved with the
 * email, like any other edit).
 */
import { useEffect, useState } from "react";
import { Icon } from "./icons";

export function EmailFields({ subject, body, readOnly = false, minWords, maxWords, suggestAction, suggestions = [], canSuggest = true }: { subject: string; body: string; readOnly?: boolean; minWords: number; maxWords: number; /** Server action behind the "Suggest" button; without it the button is not shown. */ suggestAction?: (fd: FormData) => void | Promise<void>; suggestions?: string[]; canSuggest?: boolean }) {
  const [s, setS] = useState(subject);
  const [b, setB] = useState(body);
  // What is stored changed (saved, rewritten, another email opened): show that.
  useEffect(() => setS(subject), [subject]);
  useEffect(() => setB(body), [body]);
  const words = b.trim() ? b.trim().split(/\s+/).length : 0;
  const dirty = s !== subject || b !== body;
  const off = words < minWords || words > maxWords;
  const suggest = !readOnly && suggestAction;
  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor="email-subject">
          Subject
        </label>
        <div className="relative">
          <input id="email-subject" className={`input ${suggest ? "pr-28" : ""}`} name="subject" value={s} onChange={(e) => setS(e.target.value)} readOnly={readOnly} maxLength={200} />
          {suggest && (
            <button type="submit" formAction={suggestAction} disabled={!canSuggest} title={canSuggest ? "Suggest other subjects for this email (one small AI call, about a cent)" : "Needs a model key (ANTHROPIC_API_KEY)"} className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium text-accent-text bg-accent-soft hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed">
              <Icon name="sparkles" className="w-3.5 h-3.5" /> Suggest
            </button>
          )}
        </div>
        {suggest && suggestions.length > 0 && (
          <div className="mt-2" aria-label="Suggested subjects">
            <div className="text-[11px] text-ink-faint mb-1">Other subjects. Click one to put it in the field, then save.</div>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((option) => (
                <button key={option} type="button" onClick={() => setS(option)} aria-pressed={s === option} className={`chip h-auto min-h-7 py-1 text-left whitespace-normal ${s === option ? "chip-active" : ""}`}>
                  {option}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div>
        <div className="flex items-end justify-between">
          <label className="label" htmlFor="email-body">
            Email
          </label>
          <span className={`text-[11px] tabular-nums mb-1 ${off ? "text-warn" : "text-ink-faint"}`}>
            {words} words{off ? ` (aim for ${minWords}-${maxWords})` : ""}
            {dirty && !readOnly ? " · not saved yet" : ""}
          </span>
        </div>
        <textarea id="email-body" className="textarea font-[inherit] leading-relaxed" name="body" rows={Math.min(22, Math.max(10, b.split("\n").length + 4))} value={b} onChange={(e) => setB(e.target.value)} readOnly={readOnly} />
      </div>
    </div>
  );
}
