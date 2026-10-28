import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export type Tone = "neutral" | "ok" | "warn" | "bad" | "accent" | "demo" | "info";

const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-muted",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  accent: "bg-accent-soft text-accent-text",
  demo: "bg-demo-soft text-demo",
  info: "bg-info-soft text-info",
};
const dotClass: Record<Tone, string> = { neutral: "bg-ink-faint", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", accent: "bg-accent", demo: "bg-demo", info: "bg-info" };

export function Badge({ tone = "neutral", children, title, dot, className = "" }: { tone?: Tone; children: ReactNode; title?: string; dot?: boolean; className?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap ${toneClass[tone]} ${className}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotClass[tone]}`} />}
      {children}
    </span>
  );
}

const STATUS: Record<string, { tone: Tone; label: string; pulse?: boolean }> = {
  new: { tone: "neutral", label: "Not investigated" },
  queued: { tone: "info", label: "Queued", pulse: true },
  investigating: { tone: "accent", label: "Investigating", pulse: true },
  running: { tone: "accent", label: "Running", pulse: true },
  profiled: { tone: "ok", label: "Investigated" },
  done: { tone: "ok", label: "Done" },
  failed: { tone: "bad", label: "Failed" },
  no_website: { tone: "warn", label: "No website" },
  opportunity: { tone: "ok", label: "Opportunity" },
  no_opportunity: { tone: "warn", label: "No opportunity" },
  needs_ai: { tone: "warn", label: "AI pending" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  draft: { tone: "accent", label: "Draft" },
  approved: { tone: "ok", label: "Approved" },
  archived: { tone: "neutral", label: "Archived" },
  insufficient_evidence: { tone: "warn", label: "Insufficient evidence" },
};
export function StatusPill({ status, label }: { status: string; label?: string }) {
  const m = STATUS[status] ?? { tone: "neutral" as Tone, label: status.replace(/_/g, " ") };
  return (
    <Badge tone={m.tone} dot className={m.pulse ? "pulse" : ""}>
      {label ?? m.label}
    </Badge>
  );
}

export function Card({ title, description, children, actions, className = "", padded = true, id }: { title?: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; padded?: boolean; id?: string }) {
  return (
    <section id={id} className={`surface min-w-0 ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 py-3.5 border-b border-line">
          <div className="min-w-0">
            <h2 className="text-[0.9rem] font-semibold leading-5">{title}</h2>
            {description && <p className="text-xs text-ink-muted mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, href, icon, tone = "neutral" }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; icon?: IconName; tone?: Tone }) {
  const body = (
    <div className="surface p-4 h-full flex items-start gap-3 transition-shadow hover:shadow-md">
      {icon && (
        <span className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${toneClass[tone]}`}>
          <Icon name={icon} className="w-4.5 h-4.5" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="text-2xl font-semibold leading-tight mt-0.5 tabular-nums">{value}</div>
        {hint && <div className="text-xs text-ink-faint mt-0.5 truncate">{hint}</div>}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:no-underline">
      {body}
    </Link>
  ) : (
    body
  );
}

export function scoreTone(value: number): Tone {
  return value >= 70 ? "ok" : value >= 40 ? "accent" : "warn";
}

/** Circular score indicator. */
export function ScoreRing({ value, label, size = 56, tone, sub }: { value: number; label?: string; size?: number; tone?: Tone; sub?: string }) {
  const t = tone ?? scoreTone(value);
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const color = { ok: "var(--ok)", accent: "var(--accent)", warn: "var(--warn)", bad: "var(--bad)", neutral: "var(--text-faint)", demo: "var(--demo)", info: "var(--info)" }[t];
  return (
    <div className="inline-flex flex-col items-center gap-1" title={label ? `${label}: ${value}/100` : `${value}/100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.3} fontWeight={600} fill="var(--text)">
          {value}
        </text>
      </svg>
      {label && (
        <div className="text-[10px] uppercase tracking-wide text-ink-muted font-medium leading-none">
          {label}
          {sub && <span className="block normal-case tracking-normal text-ink-faint mt-0.5">{sub}</span>}
        </div>
      )}
    </div>
  );
}

export function ScoreBar({ value, label, tone }: { value: number; label?: string; tone?: Tone }) {
  const t = tone ?? scoreTone(value);
  return (
    <div className="min-w-[96px]">
      {label && (
        <div className="flex justify-between text-[10px] uppercase tracking-wide text-ink-muted font-medium">
          <span>{label}</span>
          <span className="text-ink tabular-nums">{value}</span>
        </div>
      )}
      <div className="h-1.5 rounded-full bg-surface-3 mt-1 overflow-hidden">
        <div className={`h-full rounded-full ${dotClass[t]}`} style={{ width: `${Math.max(3, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

export type StepState = "done" | "active" | "todo" | "failed" | "skipped";
export interface Step {
  key: string;
  label: string;
  state: StepState;
  hint?: string;
  href?: string;
}

/** Horizontal workflow stepper. `compact` renders dots only (for table rows). */
export function Stepper({ steps, compact = false }: { steps: Step[]; compact?: boolean }) {
  const cls: Record<StepState, string> = {
    done: "bg-ok text-white border-ok",
    active: "bg-accent text-accent-fg border-accent pulse",
    todo: "bg-surface border-line-strong text-ink-faint",
    failed: "bg-bad text-white border-bad",
    skipped: "bg-surface-3 border-line text-ink-faint",
  };
  if (compact) {
    return (
      <div className="flex items-center gap-1" title={steps.map((s) => `${s.label}: ${s.state}`).join(" · ")}>
        {steps.map((s) => (
          <span key={s.key} className={`w-2 h-2 rounded-full border ${cls[s.state]} ${s.state === "active" ? "" : ""}`} />
        ))}
      </div>
    );
  }
  return (
    <ol className="grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => {
        const node = (
          <span className={`relative z-10 w-7 h-7 rounded-full border-2 grid place-items-center text-[11px] font-semibold shrink-0 ${cls[s.state]}`}>
            {s.state === "done" ? <Icon name="check" className="w-3.5 h-3.5" /> : s.state === "failed" ? <Icon name="x" className="w-3.5 h-3.5" /> : i + 1}
          </span>
        );
        return (
          <li key={s.key} className="relative flex flex-col items-center text-center min-w-0 px-1">
            {/* Connector from the previous circle's centre to this one; the circles sit above it. */}
            {i > 0 && <span className={`absolute top-[13px] h-0.5 left-[-50%] right-1/2 ${steps[i - 1].state === "done" ? "bg-ok" : "bg-line"}`} aria-hidden />}
            {s.href ? <Link href={s.href} className="hover:no-underline">{node}</Link> : node}
            <div className={`mt-1.5 text-xs font-medium leading-tight ${s.state === "todo" || s.state === "skipped" ? "text-ink-faint" : "text-ink"}`}>{s.label}</div>
            {s.hint && <div className="text-[11px] text-ink-faint leading-tight mt-0.5">{s.hint}</div>}
          </li>
        );
      })}
    </ol>
  );
}

export function EmptyState({ icon = "info", title, description, action, compact = false }: { icon?: IconName; title: string; description?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? "py-6" : "py-12"} px-4`}>
      <span className="w-10 h-10 rounded-full bg-surface-3 text-ink-muted grid place-items-center mb-3">
        <Icon name={icon} className="w-5 h-5" />
      </span>
      <div className="text-sm font-semibold">{title}</div>
      {description && <div className="text-xs text-ink-muted mt-1 max-w-md">{description}</div>}
      {action && <div className="mt-4 flex gap-2 flex-wrap justify-center">{action}</div>}
    </div>
  );
}

export function Callout({ tone = "info", title, children, icon, action }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: IconName; action?: ReactNode }) {
  const border: Record<Tone, string> = { neutral: "border-line", ok: "border-ok/30", warn: "border-warn/30", bad: "border-bad/30", accent: "border-accent/30", demo: "border-demo/30", info: "border-info/30" };
  return (
    <div className={`rounded-[var(--radius)] border ${border[tone]} ${toneClass[tone]} px-4 py-3 flex gap-3 items-start`}>
      <Icon name={icon ?? (tone === "bad" || tone === "warn" ? "alert" : tone === "ok" ? "check" : "info")} className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 text-sm">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={`${title ? "mt-0.5" : ""} text-[0.8125rem] opacity-90`}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions, crumbs }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { href?: string; label: string }[] }) {
  return (
    <div className="mb-5">
      {crumbs && (
        <nav className="flex items-center gap-1 text-xs text-ink-faint mb-2">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {c.href ? (
                <Link href={c.href} className="text-ink-muted hover:text-ink">
                  {c.label}
                </Link>
              ) : (
                <span className="text-ink-muted">{c.label}</span>
              )}
              {i < crumbs.length - 1 && <Icon name="chevronRight" className="w-3 h-3" />}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <div className="text-[11px] font-semibold uppercase tracking-wider text-accent-text mb-1">{eyebrow}</div>}
          <h1 className="text-xl md:text-2xl font-semibold leading-tight">{title}</h1>
          {subtitle && <div className="text-sm text-ink-muted mt-1 max-w-3xl">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
    </div>
  );
}

export function Tabs({ items }: { items: { href: string; label: string; count?: number | null; active: boolean }[] }) {
  return (
    <nav className="flex gap-1 border-b border-line mb-5 overflow-x-auto scrollbar-thin -mx-1 px-1">
      {items.map((t) => (
        <Link key={t.href} href={t.href} className={`px-3 py-2.5 text-sm whitespace-nowrap hover:no-underline border-b-2 -mb-px transition-colors ${t.active ? "border-accent text-ink font-semibold" : "border-transparent text-ink-muted hover:text-ink hover:border-line-strong"}`}>
          {t.label}
          {t.count != null && <span className={`ml-1.5 text-[11px] rounded-full px-1.5 py-0.5 ${t.active ? "bg-accent-soft text-accent-text" : "bg-surface-3 text-ink-faint"}`}>{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function KeyValue({ rows }: { rows: { k: ReactNode; v: ReactNode }[] }) {
  return (
    <dl className="text-sm divide-y divide-line">
      {rows.map((r, i) => (
        <div key={i} className="flex justify-between gap-3 py-1.5">
          <dt className="text-ink-muted shrink-0">{r.k}</dt>
          <dd className="text-right min-w-0 truncate">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Flash({ msg, tone = "ok" }: { msg?: string; tone?: Tone }) {
  if (!msg) return null;
  return (
    <div className="mb-4">
      <Callout tone={tone}>{msg}</Callout>
    </div>
  );
}

export function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function fmtRelative(iso?: string | null) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [60_000, "s"],
    [3_600_000, "m"],
    [86_400_000, "h"],
    [604_800_000, "d"],
  ];
  for (let i = 0; i < units.length; i++) {
    if (abs < units[i][0]) {
      const base = i === 0 ? 1000 : units[i - 1][0];
      const n = Math.max(1, Math.round(abs / base));
      return diff >= 0 ? `${n}${units[i][1]} ago` : `in ${n}${units[i][1]}`;
    }
  }
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export { Icon };
