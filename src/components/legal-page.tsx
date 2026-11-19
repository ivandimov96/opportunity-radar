/** The frame of a legal page: the top bar of the front page, a title, the date, the sections, and links to the other documents. */
import Link from "next/link";
import { Logo } from "./logo";

export interface LegalSection {
  title: string;
  body: (string | string[])[];
}

const DOCS = [
  { href: "/privacy", label: "Privacy policy" },
  { href: "/terms", label: "Terms of service" },
  { href: "/acceptable-use", label: "Acceptable use" },
];

export function LegalPage({ title, lead, updated, sections }: { title: string; lead: string; updated: string; sections: LegalSection[] }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2.5 font-serif text-lg font-semibold text-ink hover:no-underline whitespace-nowrap">
            <Logo /> Opportunity Radar
          </Link>
          <Link href="/login" className="ml-auto btn btn-ghost">
            Sign in
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-5 py-12 md:py-16">
        <h1 className="text-[2.2rem] md:text-[2.8rem] leading-tight">{title}</h1>
        <p className="text-sm text-ink-faint mt-2">Last updated: {updated}</p>
        <p className="text-lg text-ink-muted mt-5">{lead}</p>
        <nav className="surface mt-8 p-5" aria-label="On this page">
          <ol className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-[0.95rem] list-decimal list-inside text-ink-muted">
            {sections.map((s, i) => (
              <li key={s.title}>
                <a href={`#s${i + 1}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>
        {sections.map((s, i) => (
          <section key={s.title} id={`s${i + 1}`} className="mt-10 scroll-mt-6">
            <h2 className="font-serif text-[1.45rem] leading-snug">
              {i + 1}. {s.title}
            </h2>
            {s.body.map((b, j) =>
              Array.isArray(b) ? (
                <ul key={j} className="mt-3 space-y-2 list-disc pl-5 text-[0.98rem] text-ink-muted">
                  {b.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p key={j} className="mt-3 text-[0.98rem] text-ink-muted">
                  {b}
                </p>
              ),
            )}
          </section>
        ))}
      </main>
      <footer className="border-t border-line">
        <div className="max-w-3xl mx-auto px-5 py-7 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {DOCS.map((d) => (
            <Link key={d.href} href={d.href}>
              {d.label}
            </Link>
          ))}
          <Link href="/" className="ml-auto">
            Back to the front page
          </Link>
        </div>
      </footer>
    </div>
  );
}
