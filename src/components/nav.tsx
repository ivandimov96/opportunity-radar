"use client";
/**
 * App shell: a fixed sidebar on wide screens (brand, two navigation groups,
 * status footer) and a top bar with a slide-in drawer on
 * narrow screens. Navigation items are single-line; the hint is the tooltip.
 */
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

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <span className="flex items-center gap-2 min-w-0" title={detail}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? "bg-ok" : "bg-warn"}`} />
      <span className="text-ink-muted truncate">{label}</span>
      <span className={`ml-auto text-[10px] uppercase tracking-wide shrink-0 ${ok ? "text-ok" : "text-warn"}`}>{ok ? "live" : "key"}</span>
    </span>
  );
}

export function AppShell({ aiEnabled, sourceEnabled = false, researchEnabled = false, serverless = false, children }: { aiEnabled: boolean; sourceEnabled?: boolean; researchEnabled?: boolean; serverless?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

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
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-6">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint mb-1.5">{g.title}</div>
            <div className="space-y-0.5">
              {g.items.map((it) => {
                const active = isActive(it.href);
                return (
                  <Link key={it.href} href={it.href} title={it.hint} aria-current={active ? "page" : undefined} className={`relative flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-[13.5px] hover:no-underline transition-colors ${active ? "bg-accent-soft text-accent-text font-medium" : "text-ink-muted hover:bg-surface-3 hover:text-ink"}`}>
                    {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-accent" aria-hidden />}
                    <Icon name={it.icon} className={`w-4 h-4 shrink-0 ${active ? "text-accent" : "text-ink-faint"}`} />
                    <span className="truncate">{it.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-line text-xs space-y-1.5">
        <StatusRow ok={sourceEnabled} label="Google Maps source" detail={sourceEnabled ? "SerpApi key set" : "Set SERPAPI_API_KEY in .env"} />
        <StatusRow ok={researchEnabled} label="Website research" detail={researchEnabled ? "Firecrawl key set" : "Set FIRECRAWL_API_KEY in .env"} />
        <StatusRow ok={aiEnabled} label="AI analysis" detail={aiEnabled ? "Model key set" : "Set a model key in .env; rules apply meanwhile"} />
        <Link href="/settings" className="block pt-1 text-[11px] text-ink-faint hover:text-ink hover:no-underline">
          Configuration → Settings
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
