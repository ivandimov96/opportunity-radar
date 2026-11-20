"use client";
/**
 * The one Save of a Settings page. It sits at the bottom of the page's form and stays in view:
 * not there while nothing was changed; the moment a setting is touched it appears and offers
 * Save and Discard. One press saves every card of the page.
 */
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

export function SaveBar() {
  const bar = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  useEffect(() => {
    const form = bar.current?.closest("form");
    if (!form) return;
    const touched = () => setDirty(true);
    // A list built with buttons (add a kind, remove a place) changes without typing: a press of one counts too.
    const pressed = (e: Event) => {
      const button = (e.target as Element).closest?.("button[type=button]");
      if (button && !bar.current?.contains(button)) setDirty(true);
    };
    form.addEventListener("input", touched);
    form.addEventListener("change", touched);
    form.addEventListener("click", pressed);
    return () => {
      form.removeEventListener("input", touched);
      form.removeEventListener("change", touched);
      form.removeEventListener("click", pressed);
    };
  }, []);

  // A save that has come back: what is on the page is what is stored again.
  useEffect(() => {
    if (wasPending.current && !pending) setDirty(false);
    wasPending.current = pending;
  }, [pending]);

  const discard = () => {
    const form = bar.current?.closest("form");
    form?.reset();
    setDirty(false);
    // A form whose lists live outside its fields is put back by loading the page again.
    if (form?.dataset.discard === "reload") window.location.reload();
  };

  // Nothing changed, nothing to show: the bar appears with the first change and leaves once it is saved or discarded.
  const shown = dirty || pending;
  return (
    <div ref={bar} className={shown ? "sticky bottom-4 z-10 flex items-center justify-between gap-3 flex-wrap rounded-xl border border-[var(--accent)] bg-surface px-4 py-3 shadow-[var(--shadow-md)]" : "hidden"} role="status">
      <span className="flex items-center gap-2.5 text-sm min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0 bg-[var(--warn)]" aria-hidden="true" />
        <span className="font-medium">{pending ? "Saving…" : "You have unsaved changes"}</span>
      </span>
      <div className="flex items-center gap-2 shrink-0">
        {!pending && (
          <button type="button" className="btn btn-ghost" onClick={discard}>
            Discard
          </button>
        )}
        <button className="btn btn-primary" disabled={pending}>
          Save changes
        </button>
      </div>
    </div>
  );
}
