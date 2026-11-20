"use client";
/**
 * One rule for the whole workspace: what you do on a page leaves you where you
 * were on it. Choosing a filter, typing a search and pressing Enter, sorting,
 * ticking a row off, picking from a dropdown: the page answers and stays put,
 * instead of jumping back to its top.
 *
 * It listens on the whole document, so no page has to do anything for it:
 *  - a link to the same page (only the filters in the address change) and a
 *    search form are followed without scrolling;
 *  - a form that saves something (it comes back to the same page) has its
 *    place held until the answer is on screen;
 *  - a link marked `data-scroll="top"` (the page buttons under a list) goes to
 *    the top of that list instead, where the new rows begin.
 * Going to another page is left alone: that starts at the top, as it should.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

let stopCurrent: (() => void) | null = null;

/**
 * Holds the window at `y` while the page answers: the content may be swapped for a
 * loading outline and back, and each swap would otherwise move the window. It lets go
 * as soon as the new content has settled, the person scrolls, or another page opens.
 */
export function holdScroll(y: number = window.scrollY) {
  stopCurrent?.();
  if (window.location.hash) return; // a #section in the address decides the place itself
  const path = window.location.pathname;
  const deadline = Date.now() + 10000;
  let settleAt = 0;
  let frame = 0;
  const main = document.querySelector("main") ?? document.body;
  const observer = new MutationObserver(() => {
    settleAt = Date.now() + 700;
  });
  const stop = () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    for (const ev of USER_EVENTS) window.removeEventListener(ev, stop, true);
    if (stopCurrent === stop) stopCurrent = null;
  };
  const tick = () => {
    const now = Date.now();
    if (window.location.pathname !== path || window.location.hash || now > deadline || (settleAt && now > settleAt)) return stop();
    const reachable = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const want = Math.min(y, reachable);
    if (Math.abs(window.scrollY - want) > 1) window.scrollTo(0, want);
    frame = requestAnimationFrame(tick);
  };
  stopCurrent = stop;
  // The click or key press that started this is over by now: the next one is the person taking over.
  setTimeout(() => {
    if (stopCurrent !== stop) return;
    for (const ev of USER_EVENTS) window.addEventListener(ev, stop, { capture: true, passive: true });
    observer.observe(main, { childList: true, subtree: true });
  }, 0);
  frame = requestAnimationFrame(tick);
}

const USER_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

export function KeepScroll() {
  const router = useRouter();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname || url.hash) return;
      e.preventDefault();
      if (a.dataset.scroll === "top") {
        // The page buttons under a list: show the start of the list, where the new rows are.
        const list = a.closest(".surface, section");
        holdScroll(list ? Math.max(0, list.getBoundingClientRect().top + window.scrollY - 16) : 0);
      } else holdScroll();
      router.push(url.pathname + url.search, { scroll: false });
    };
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || e.defaultPrevented) return;
      if (form.method !== "get") {
        holdScroll(); // saves something and comes back to this page
        return;
      }
      const url = new URL(form.action, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
      e.preventDefault();
      const p = new URLSearchParams();
      for (const [k, v] of new FormData(form, e.submitter)) if (typeof v === "string" && v !== "") p.append(k, v);
      const q = p.toString();
      holdScroll();
      router.push(url.pathname + (q ? `?${q}` : ""), { scroll: false });
    };
    // In the capture phase, before the framework's own handling of links and forms.
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      stopCurrent?.();
    };
  }, [router]);
  return null;
}
