"use client";
/**
 * App shell: a fixed sidebar on wide screens (brand, five destinations with a
 * count of what is waiting in each, one line of setup status) and a top bar
 * with a slide-in drawer on narrow screens.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icons";

export interface NavCounts {
  /** Businesses the research could not decide on. */
  businesses: number;
  /** Emails waiting for a decision: to review, failed a check, or not sent. */
  outreach: number;
  /** Replies nobody has answered yet. */
  pipeline: number;
}
/** One thing that still has to be set up before the whole flow works, and where to do it. */
export interface SetupGap {
  label: string;
  href: string;
}

const items: { href: string; label: string; icon: IconName; hint: string; also?: string[]; count?: keyof NavCounts; countHint?: string }[] = [
  { href: "/", label: "Dashboard", icon: "home", hint: "What is waiting for you and where everything stands" },
  { href: "/businesses", label: "Businesses", icon: "building", hint: "Everything found and researched", also: ["/searches", "/import"], count: "businesses", countHint: "to judge yourself" },
  { href: "/outreach", label: "Outreach", icon: "mail", hint: "Review, approve and send emails", count: "outreach", countHint: "waiting for you" },
  { href: "/pipeline", label: "Pipeline", icon: "kanban", hint: "Where each conversation stands", count: "pipeline", countHint: "to answer" },
  { href: "/settings", label: "Settings", icon: "settings", hint: "Sender, mailbox, limits and automation", also: ["/system"] },
];

export function AppShell({ counts, setup = [], serverless = false, children }: { counts?: NavCounts; setup?: SetupGap[]; serverless?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const isActive = (href: string, also: string[] = []) => (href === "/" ? path === "/" : [href, ...also].some((h) => path.startsWith(h)));

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-lg bg-accent text-accent-fg grid place-items-center shrink-0">
          <Icon name="target" className="w-4.5 h-4.5" />
        </span>
        <Link href="/" className="font-semibold text-ink hover:no-underline leading-tight whitespace-nowrap min-w-0 truncate">
          Opportunity Radar
        </Link>
        <button className="ml-auto lg:hidden btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close menu">
          <Icon name="x" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {items.map((it) => {
          const active = isActive(it.href, it.also);
          const n = it.count ? (counts?.[it.count] ?? 0) : 0;
          return (
            <Link key={it.href} href={it.href} title={it.hint} aria-current={active ? "page" : undefined} className={`relative flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-[13.5px] hover:no-underline transition-colors ${active ? "bg-accent-soft text-accent-text font-medium" : "text-ink-muted hover:bg-surface-3 hover:text-ink"}`}>
              {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-accent" aria-hidden />}
              <Icon name={it.icon} className={`w-4 h-4 shrink-0 ${active ? "text-accent" : "text-ink-faint"}`} />
              <span className="truncate">{it.label}</span>
              {n > 0 && (
                <span className="ml-auto rounded-full bg-accent text-accent-fg text-[11px] font-semibold leading-none px-1.5 py-1 tabular-nums" title={`${n} ${it.countHint}`} aria-hidden>
                  {n}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t border-line text-xs">
        {setup.length === 0 ? (
          <span className="flex items-center gap-2 text-ink-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-ok shrink-0" />
            Everything is connected
          </span>
        ) : (
          <Link href={setup[0].href} className="flex items-start gap-2 text-ink-muted hover:text-ink hover:no-underline" title={setup.map((g) => g.label).join(", ")}>
            <span className="w-1.5 h-1.5 rounded-full bg-warn shrink-0 mt-1.5" />
            <span className="min-w-0">
              <span className="block text-warn font-medium">{setup.length} thing{setup.length === 1 ? "" : "s"} to set up</span>
              <span className="block truncate">{setup.map((g) => g.label).join(", ")}</span>
            </span>
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden lg:block w-60 shrink-0 border-r border-line bg-surface sticky top-0 h-screen">{sidebar}</aside>
      <header className="lg:hidden sticky top-0 z-30 bg-surface border-b border-line flex items-center gap-2 px-3 h-14">
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label="Open menu">
          <Icon name="menu" className="w-5 h-5" />
        </button>
        <Link href="/" className="font-semibold text-ink hover:no-underline">
          Opportunity Radar
        </Link>
        <Link href="/searches/new" className="ml-auto btn btn-primary btn-sm">
          <Icon name="plus" /> Search
        </Link>
      </header>
      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-surface shadow-md">{sidebar}</aside>
        </div>
      )}
      <main className="flex-1 min-w-0">
        {serverless && (
          <div className="bg-warn-soft text-warn text-xs px-4 py-2 text-center border-b border-warn/20">
            <strong>Preview deployment without persistent storage.</strong> Each server instance keeps its own temporary database, so changes may not survive the next request. Connect a Turso database to keep data.{" "}
            <Link href="/settings" className="underline">
              Details
            </Link>
          </div>
        )}
        <div className="px-4 py-5 md:px-8 md:py-7 max-w-[1440px] mx-auto">{children}</div>
      </main>
    </div>
  );
}
