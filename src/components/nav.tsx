"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Overview" },
  { href: "/searches", label: "Searches" },
  { href: "/businesses", label: "Businesses" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/patterns", label: "Patterns" },
  { href: "/import", label: "Import" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ aiEnabled }: { aiEnabled: boolean }) {
  const path = usePathname();
  return (
    <aside className="w-52 shrink-0 border-r border-line bg-panel min-h-screen flex flex-col">
      <div className="px-4 py-4 border-b border-line">
        <Link href="/" className="font-semibold text-ink hover:no-underline">
          Opportunity Radar
        </Link>
        <div className="text-[11px] text-ink-faint mt-0.5">Software opportunity intelligence</div>
      </div>
      <nav className="p-2 flex-1">
        {items.map((it) => {
          const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
          return (
            <Link key={it.href} href={it.href} className={`block rounded-md px-3 py-1.5 text-sm hover:no-underline ${active ? "bg-accent-soft text-accent font-medium" : "text-ink-muted hover:bg-canvas hover:text-ink"}`}>
              {it.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-line text-[11px] text-ink-muted">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-full ${aiEnabled ? "bg-ok" : "bg-warn"}`} />
          {aiEnabled ? "AI stages live" : "AI stages need API key"}
        </div>
        <Link href="/settings" className="text-ink-faint">
          Integration status
        </Link>
      </div>
    </aside>
  );
}
