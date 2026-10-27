import Link from "next/link";
import type { ReactNode } from "react";

export function Badge({ tone = "neutral", children, title }: { tone?: "neutral" | "ok" | "warn" | "bad" | "accent" | "demo"; children: ReactNode; title?: string }) {
  const cls = {
    neutral: "bg-canvas text-ink-muted border-line",
    ok: "bg-ok-soft text-ok border-ok/20",
    warn: "bg-warn-soft text-warn border-warn/20",
    bad: "bg-bad-soft text-bad border-bad/20",
    accent: "bg-accent-soft text-accent border-accent/20",
    demo: "bg-demo-soft text-demo border-demo/20",
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: Parameters<typeof Badge>[0]["tone"]; label: string }> = {
    not_started: { tone: "neutral", label: "Not started" },
    queued: { tone: "accent", label: "Queued" },
    running: { tone: "accent", label: "Running" },
    done: { tone: "ok", label: "Done" },
    failed: { tone: "bad", label: "Failed" },
    no_website: { tone: "warn", label: "No website" },
    insufficient_evidence: { tone: "warn", label: "Insufficient evidence" },
    cancelled: { tone: "neutral", label: "Cancelled" },
  };
  const m = map[status] ?? { tone: "neutral" as const, label: status };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  const body = (
    <div className="card p-4">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-xs text-ink-faint mt-1">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="hover:no-underline">
      {body}
    </Link>
  ) : (
    body
  );
}

export function ScoreBar({ value, label, tone = "accent" }: { value: number; label: string; tone?: "accent" | "ok" | "warn" }) {
  const color = { accent: "bg-accent", ok: "bg-ok", warn: "bg-warn" }[tone];
  return (
    <div className="min-w-[120px]">
      <div className="flex justify-between text-[11px] text-ink-muted">
        <span>{label}</span>
        <span className="font-semibold text-ink">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-line mt-1 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-sm text-ink-muted py-8 text-center">{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl font-semibold leading-tight">{title}</h1>
        {subtitle && <div className="text-sm text-ink-muted mt-1">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function DemoBanner({ children }: { children?: ReactNode }) {
  return (
    <div className="rounded-md border border-demo/30 bg-demo-soft text-demo text-xs px-3 py-2 mb-4">
      <strong>Demo data.</strong> {children ?? "This record is synthetic and does not describe a real company."}
    </div>
  );
}

export function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
