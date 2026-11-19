"use client";
/**
 * One rule for every form of the app: the button that was pressed shows a
 * spinner and cannot be pressed twice until the page has answered. It listens
 * for submits on the whole document, so no form has to do anything for it.
 * The mark is cleared when the page content changes (the answer arrived) or,
 * as a last resort, after twenty seconds.
 */
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const clear = () => document.querySelectorAll("[data-loading]").forEach((el) => el.removeAttribute("data-loading"));

export function PendingForms() {
  const path = usePathname();
  const search = useSearchParams();
  // A new address means the answer arrived.
  useEffect(clear, [path, search]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      const button = (e.submitter as HTMLElement | null) ?? form?.querySelector<HTMLElement>("button:not([type=button])");
      if (!button) return;
      // A search form that reloads the page the ordinary way needs no mark: the browser shows its own.
      if (form?.method === "get") return;
      button.setAttribute("data-loading", "true");
      clearTimeout(timer);
      timer = setTimeout(clear, 20000);
      observer?.disconnect();
      const main = document.querySelector("main");
      if (main) {
        // Fresh content from the server replaces what is in the page: that is the answer.
        observer = new MutationObserver(() => {
          observer?.disconnect();
          setTimeout(clear, 150);
        });
        setTimeout(() => observer?.observe(main, { childList: true, subtree: true, characterData: true }), 50);
      }
    };
    // In the capture phase: the framework handles the submit itself and marks it as handled before it would reach us otherwise.
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      clearTimeout(timer);
      observer?.disconnect();
    };
  }, []);
  return null;
}
