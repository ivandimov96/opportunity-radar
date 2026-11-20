"use client";
/**
 * App shell: a fixed sidebar on wide screens (the name, five destinations with
 * a count of what is waiting in each, and one line saying whether everything
 * is connected) and a top bar
 * with a slide-in drawer on narrow screens.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icons";
import { Logo } from "./logo";
import { logoutAction } from "@/app/auth-actions";

export interface NavCounts {
  /** Planned next actions that are due today or overdue. */
  todo: number;
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
  { href: "/todo", label: "To do", icon: "check", hint: "Every planned next action, soonest first", count: "todo", countHint: "due today or overdue" },
  { href: "/businesses", label: "Businesses", icon: "building", hint: "Everything found and researched", also: ["/searches", "/import"], count: "businesses", countHint: "to judge yourself" },
  { href: "/outreach", label: "Outreach", icon: "mail", hint: "Review, approve and send emails", count: "outreach", countHint: "waiting for you" },
  { href: "/pipeline", label: "Pipeline", icon: "kanban", hint: "Where each conversation stands", count: "pipeline", countHint: "to answer" },
  { href: "/settings", label: "Settings", icon: "settings", hint: "Sender, mailbox, limits and automation", also: ["/system"] },
];

export function AppShell({ user, counts, setup = [], serverless = false, children }: { user?: { name: string; email: string }; counts?: NavCounts; setup?: SetupGap[]; serverless?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const isActive = (href: string, also: string[] = []) => (href === "/" ? path === "/" : [href, ...also].some((h) => path.startsWith(h)));

  const sidebar = (
    <div className="flex flex-col h-full">
      {/* Who this is. */}
      <div className="px-4 pt-5 pb-4 flex items-center gap-2.5">
        <Logo />
        <Link href="/" className="font-serif text-[1.02rem] font-semibold text-ink hover:no-underline leading-tight whitespace-nowrap min-w-0 truncate">
          Opportunity Radar
        </Link>
        <button className="ml-auto lg:hidden btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close menu">
          <Icon name="x" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pt-3 border-t border-line space-y-1">
        {items.map((it) => {
          const active = isActive(it.href, it.also);
          const n = it.count ? (counts?.[it.count] ?? 0) : 0;
          return (
            <Link key={it.href} href={it.href} title={it.hint} aria-current={active ? "page" : undefined} className={`flex items-center gap-3 rounded-lg px-3 h-11 text-[0.95rem] hover:no-underline transition-colors ${active ? "bg-accent text-accent-fg font-semibold" : "text-ink-muted font-medium hover:bg-surface-3 hover:text-ink"}`}>
              <Icon name={it.icon} className={`w-[1.15rem] h-[1.15rem] shrink-0 ${active ? "" : "text-ink-faint"}`} />
              <span className="truncate">{it.label}</span>
              {n > 0 && (
                <span className={`ml-auto rounded-full text-xs font-bold leading-none px-2 py-1 tabular-nums ${active ? "bg-accent-fg/20 text-accent-fg" : "bg-accent text-accent-fg"}`} title={`${n} ${it.countHint}`} aria-hidden>
                  {n}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {/* Whether everything it needs is connected, and where to fix it when it is not. */}
      <div className="p-3 border-t border-line space-y-1">
        {user && (
          <form action={logoutAction} className="flex items-center gap-2.5 px-3 py-2">
            <span className="w-8 h-8 rounded-full bg-accent-soft text-accent-text grid place-items-center text-sm font-bold shrink-0" aria-hidden>
              {(user.name || user.email).trim().charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink truncate">{user.name || "Your account"}</span>
              <span className="block text-xs text-ink-faint truncate">{user.email}</span>
            </span>
            <button className="btn btn-ghost btn-sm shrink-0" title="Sign out">
              Sign out
            </button>
          </form>
        )}
        {setup.length === 0 ? (
          <Link href="/settings?tab=system" className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-ink-muted hover:bg-surface-3 hover:text-ink hover:no-underline">
            <span className="w-2 h-2 rounded-full bg-ok shrink-0" />
            Everything is connected
          </Link>
        ) : (
          <Link href={setup[0].href} className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm bg-warn-soft hover:no-underline" title={setup.map((g) => g.label).join(", ")}>
            <span className="w-2 h-2 rounded-full bg-warn shrink-0 mt-1.5" />
            <span className="min-w-0">
              <span className="block text-warn font-semibold">
                {setup.length} thing{setup.length === 1 ? "" : "s"} to set up
              </span>
              <span className="block truncate text-ink-muted">{setup.map((g) => g.label).join(", ")}</span>
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
        <Link href="/" className="flex items-center gap-2 font-serif text-[1.05rem] font-semibold text-ink hover:no-underline">
          <Logo size="w-7 h-7" />
          Opportunity Radar
        </Link>
        <Link href="/searches/new" className="ml-auto btn btn-primary btn-sm">
          <Icon name="search" /> Find
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
