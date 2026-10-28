"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icons";

const groups: { title: string; items: { href: string; label: string; icon: IconName; hint: string }[] }[] = [
  {
    title: "Workflow",
    items: [
      { href: "/", label: "Overview", icon: "home", hint: "What needs attention" },
      { href: "/searches", label: "Discover", icon: "search", hint: "Find businesses" },
      { href: "/businesses", label: "Businesses", icon: "building", hint: "Research & opportunities" },
      { href: "/pipeline", label: "Pipeline", icon: "kanban", hint: "Conversations & outcomes" },
      { href: "/patterns", label: "Patterns", icon: "layers", hint: "Recurring opportunities" },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/import", label: "Import CSV", icon: "upload", hint: "Bring your own list" },
      { href: "/system", label: "System", icon: "bolt", hint: "Jobs & source health" },
      { href: "/settings", label: "Settings", icon: "settings", hint: "Integrations & limits" },
    ],
  },
];

export function AppShell({ aiEnabled, serverless = false, children }: { aiEnabled: boolean; serverless?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="px-4 py-4 flex items-center gap-2.5 border-b border-line">
        <span className="w-8 h-8 rounded-lg bg-accent text-accent-fg grid place-items-center shrink-0">
          <Icon name="target" className="w-4.5 h-4.5" />
        </span>
        <div className="min-w-0">
          <Link href="/" className="font-semibold text-ink hover:no-underline block leading-tight whitespace-nowrap">
            Opportunity Radar
          </Link>
          <div className="text-[11px] text-ink-faint leading-tight">Evidence-first prospecting</div>
        </div>
        <button className="ml-auto lg:hidden btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close menu">
          <Icon name="x" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-5">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="px-3 text-[10px] font-semibold uppercase tracking-wider text-ink-faint mb-1.5">{g.title}</div>
            {g.items.map((it) => {
              const active = isActive(it.href);
              return (
                <Link key={it.href} href={it.href} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:no-underline transition-colors ${active ? "bg-accent-soft text-accent-text font-medium" : "text-ink-muted hover:bg-surface-3 hover:text-ink"}`}>
                  <Icon name={it.icon} className="w-4 h-4 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block leading-tight">{it.label}</span>
                    <span className={`block text-[10px] leading-tight ${active ? "text-accent-text/70" : "text-ink-faint"}`}>{it.hint}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="p-3 border-t border-line">
        <Link href="/searches/new" className="btn btn-primary w-full">
          <Icon name="plus" /> New search
        </Link>
        <Link href="/settings" className="mt-3 flex items-center gap-2 text-[11px] text-ink-muted hover:no-underline">
          <span className={`w-2 h-2 rounded-full ${aiEnabled ? "bg-ok" : "bg-warn"}`} />
          {aiEnabled ? "AI stages live" : "AI stages need an API key"}
        </Link>
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
          <div className="bg-demo-soft text-demo text-xs px-4 py-2 text-center border-b border-demo/20">
            <strong>Preview deployment without persistent storage.</strong> Each server instance keeps its own temporary database, so changes may not survive the next request. Demo data is re-seeded automatically.{" "}
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
