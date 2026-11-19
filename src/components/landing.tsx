/**
 * The public front page, shown at "/" to anyone who is not signed in.
 *
 * Everything on it is true of the product as it is built: how many pages it
 * reads, how long its emails are, that nothing is sent without approval. There
 * are no made-up companies, customer quotes, results or prices.
 *
 * Layout: every section has the same width and spacing and the same kind of
 * heading; sections alternate between the page background and a lighter band.
 *
 * Motion: the radar in the top section turns for as long as the page is open;
 * each section below rises into place once when it is scrolled to; the letter
 * and the board play one short sequence each. All of it stands still for
 * people who ask for less motion.
 */
import Link from "next/link";
import { Icon, type IconName } from "./icons";
import { Logo } from "./logo";
import { RadarArt } from "./radar-art";
import { Reveal } from "./reveal";

const STEPS: { icon: IconName; title: string; body: string }[] = [
  { icon: "search", title: "Find", body: "Name a kind of business and a city. You get the companies there that have a website and a public email address. Known chains are left out." },
  { icon: "note", title: "Research", body: "Each company's own website is read: what they do, who they serve, how a customer gets a quote or a booking. Every fact keeps the sentence it came from." },
  { icon: "mail", title: "Write", body: "One short email per company, with one idea that fits how they work. You read it, change what you like, and approve it." },
  { icon: "kanban", title: "Follow", body: "You press send. Replies are picked up from your inbox, a follow-up is drafted when nobody answers, and every conversation moves across one board." },
];

const LETTER: { part: string; text: string }[] = [
  { part: "The company, by its own name", text: "Hi [company] team," },
  { part: "One thing noticed on their website", text: "[One sentence about something specific their own website says.]" },
  { part: "Who you are, and one idea", text: "[Your name, what you do, and one thing that could get easier for them.]" },
  { part: "One easy question", text: "Could I send you a short mock-up of how that might look?" },
];

const GUARDS: { icon: IconName; title: string; body: string }[] = [
  { icon: "check", title: "Only what was read", body: "A statement about a company is allowed only when it can be traced to a sentence on that company's website. A second, independent check reads every email before you see it." },
  { icon: "eye", title: "You approve every email", body: "Nothing goes out on its own. Each email waits for you, and you can edit it, ask for another version, or leave the company out." },
  { icon: "mail", title: "From your own mailbox", body: "Emails leave from your address, a few at a time with a pause between them, inside the hours you choose." },
  { icon: "x", title: "No means no", body: "Every email says how to opt out. Anyone who asks, and any address that bounces, is never written to again." },
  { icon: "building", title: "The right name", body: "Each email greets the company by the name its own website uses, never by a person's name guessed from a page." },
  { icon: "clock", title: "Nothing is forgotten", body: "When a company does not answer, one short follow-up is drafted for your approval after the number of days you set." },
];

/** The tones of the page, always in this order, so the first, second, third … of anything listed side by side each has its own. Six, because the longest list has six items; no two next to each other look alike. */
const TONES = ["var(--accent)", "var(--violet)", "var(--warn)", "var(--ok)", "var(--teal)", "var(--rose)"];
const tone = (i: number) => ({ "--c": TONES[i % TONES.length] }) as React.CSSProperties;

/** The stages of the board in the demonstration, each with its own colour (the same tones the app uses). */
const STAGES: { name: string; color: string }[] = [
  { name: "Qualified", color: "var(--text-faint)" },
  { name: "Contacted", color: "var(--accent)" },
  { name: "Replied", color: "var(--info)" },
  { name: "Meeting", color: "var(--warn)" },
  { name: "Won", color: "var(--ok)" },
];

/** Who buys this: people who sell a service to other businesses and have to find their own clients. */
const AUDIENCE: { icon: IconName; title: string; body: string }[] = [
  { icon: "bolt", title: "Freelancers and developers", body: "You are good at the work and short on time to find it. Spend less time looking for work and more time doing it." },
  { icon: "building", title: "Agencies and studios", body: "Keep a steady flow of first conversations without hiring someone to research companies and write emails all day." },
  { icon: "flag", title: "Consultants", body: "Open with something specific about the company you are writing to, so the first reply is about their business, not about who you are." },
];

/** What finding clients by hand looks like, next to what it looks like here. */
const BEFORE = ["Hours on maps and websites to find companies worth writing to.", "The same template pasted to everyone, and ignored by everyone.", "Follow-ups forgotten, replies lost in the inbox.", "A spreadsheet nobody keeps up to date."];
const AFTER = ["A list of companies in the city and trade you choose, each one already researched.", "One short email per company, built on what its own website says.", "Follow-ups drafted for you, replies picked up from your inbox.", "One board that shows where every conversation stands."];

/** The questions people ask before signing up, answered plainly. */
const FAQ: { q: string; a: string }[] = [
  { q: "Does it send emails on its own?", a: "No. It writes; you read, change what you like, approve and press send. Nothing ever leaves without you." },
  { q: "Which address do the emails come from?", a: "Your own. You connect your mailbox, and emails go out from it a few at a time, so they arrive as ordinary mail from a real person. Replies come back to the same inbox." },
  { q: "How is this different from a mass-mailing tool?", a: "A mass mailer sends one template to thousands. This writes one email to one company, about that company, and lets you send a handful a day that you would be glad to put your name under." },
  { q: "What if the research gets something wrong?", a: "Every statement in an email is checked against the sentence on the company's website it came from, and you see that evidence next to the email before you approve it. What cannot be shown is left out." },
  { q: "What does it cost?", a: "Creating an account is free. Prices are not public yet; you will see them before you are ever asked to pay." },
];

/**
 * One section of the page. Every section has the same width, the same space
 * above and below, and rises into place once when it is scrolled to; a "band"
 * section has the lighter background, and the sections alternate.
 */
function Section({ id, band = false, line = false, children }: { id?: string; band?: boolean; line?: boolean; children: React.ReactNode }) {
  return (
    <section id={id} className={`scroll-mt-20 ${band ? "border-y border-line bg-surface" : line ? "border-t border-line" : ""}`}>
      <Reveal className="max-w-6xl mx-auto px-5 py-12 md:py-24">{children}</Reveal>
    </section>
  );
}

/** The heading of a section: always the same size, the same width and the same distance to what follows. */
function Head({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="reveal-item max-w-2xl mb-7 md:mb-12">
      <h2 className="font-serif text-[1.7rem] md:text-[2.5rem] leading-[1.15]">{title}</h2>
      {lead && <p className="text-base md:text-lg text-ink-muted mt-3 md:mt-4">{lead}</p>}
    </div>
  );
}

/** A card with an icon, a title and a few lines, in its own tone: used wherever the page lists things side by side. */
function Tile({ icon, title, body, index }: { icon: IconName; title: string; body: string; index: number }) {
  return (
    <div className="reveal-item fact rounded-[var(--radius)] border border-line bg-bg p-5 md:p-6 h-full flex gap-4 md:block" style={tone(index)}>
      <span className="fact-icon w-11 h-11 rounded-full grid place-items-center shrink-0">
        <Icon name={icon} className="w-5 h-5" />
      </span>
      <div className="min-w-0">
        <h3 className="text-lg font-semibold md:mt-4">{title}</h3>
        <p className="text-[0.95rem] text-ink-muted mt-1 md:mt-1.5">{body}</p>
      </div>
    </div>
  );
}

function Mark({ ok }: { ok: boolean }) {
  return (
    <span className={`w-6 h-6 rounded-full grid place-items-center shrink-0 mt-0.5 ${ok ? "bg-ok-soft text-ok" : "bg-surface-3 text-ink-faint"}`}>
      <Icon name={ok ? "check" : "x"} className="w-3.5 h-3.5" />
    </span>
  );
}

export function Landing() {
  return (
    <div className="min-h-screen overflow-x-clip">
      {/* The bar on top stays in view, so signing up is always one click away. */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 md:px-5 h-16 flex items-center gap-3 md:gap-6">
          <Link href="/" className="flex items-center gap-2.5 font-serif text-lg font-semibold text-ink hover:no-underline whitespace-nowrap" aria-label="Opportunity Radar">
            <Logo /> <span className="max-[430px]:hidden">Opportunity Radar</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold" aria-label="On this page">
            <Link href="#how" className="py-2 text-ink-muted hover:text-ink hover:no-underline">
              How it works
            </Link>
            <Link href="#trust" className="py-2 text-ink-muted hover:text-ink hover:no-underline">
              Safeguards
            </Link>
            <Link href="#questions" className="py-2 text-ink-muted hover:text-ink hover:no-underline">
              Questions
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="btn btn-ghost max-sm:px-2.5">
              Sign in
            </Link>
            <Link href="/signup" className="btn btn-primary max-sm:px-3">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* What it is, for whom, and what to do next. */}
        <section className="hero max-w-6xl mx-auto px-5 py-10 md:py-24 grid gap-8 md:gap-10 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] items-center">
          <div className="min-w-0">
            <p className="rise text-sm font-semibold text-accent-text">For freelancers, agencies and consultants who find their own clients</p>
            <h1 className="rise text-[2.2rem] md:text-[3.5rem] leading-[1.08] mt-3" style={{ animationDelay: "0.08s" }}>
              Find your next clients. Send the first email with confidence.
            </h1>
            <p className="rise text-lg text-ink-muted mt-5 max-w-xl" style={{ animationDelay: "0.16s" }}>
              Pick a trade and a city. Opportunity Radar finds the companies there, studies each one, and drafts a short, personal email with one idea that fits them. You approve it and send it from your own mailbox.
            </p>
            <div className="rise flex flex-wrap gap-3 mt-8" style={{ animationDelay: "0.24s" }}>
              <Link href="/signup" className="btn btn-primary btn-lg max-sm:w-full">
                Get started free <Icon name="arrowRight" />
              </Link>
              <Link href="#how" className="btn btn-lg max-sm:w-full">
                See how it works
              </Link>
            </div>
          </div>
          <div className="rise flex justify-center" style={{ animationDelay: "0.2s" }}>
            <RadarArt className="w-[min(26rem,62vw)]" />
          </div>
        </section>

        {/* What it replaces. A line separates it from the top section, which has the same background. */}
        <Section line>
          <Head title="Finding clients should not take longer than the work itself." lead="Most outreach fails for one of two reasons: it takes too long to do properly, or it is done quickly and reads like spam." />
          <div className="grid gap-5 md:grid-cols-2">
            <div className="reveal-item fact rounded-[var(--radius)] border border-line bg-surface p-6 md:p-7" style={{ "--c": "var(--bad)" } as React.CSSProperties}>
              <h3 className="flex items-center gap-2.5 text-lg font-semibold text-ink-muted">
                <span className="fact-icon w-9 h-9 rounded-full grid place-items-center">
                  <Icon name="clock" className="w-[1.1rem] h-[1.1rem]" />
                </span>
                By hand
              </h3>
              <ul className="mt-5 space-y-3.5">
                {BEFORE.map((t) => (
                  <li key={t} className="flex items-start gap-3 text-[0.98rem] text-ink-muted">
                    <Mark ok={false} />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="reveal-item fact rounded-[var(--radius)] border border-line bg-surface p-6 md:p-7" style={{ "--c": "var(--ok)" } as React.CSSProperties}>
              <h3 className="flex items-center gap-2.5 text-lg font-semibold text-ink">
                <span className="fact-icon w-9 h-9 rounded-full grid place-items-center">
                  <Icon name="bolt" className="w-[1.1rem] h-[1.1rem]" />
                </span>
                With Opportunity Radar
              </h3>
              <ul className="mt-5 space-y-3.5">
                {AFTER.map((t) => (
                  <li key={t} className="flex items-start gap-3 text-[0.98rem] text-ink">
                    <Mark ok />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        {/* How it works: four steps, in order, joined by a line that draws itself. */}
        <Section id="how" band>
          <Head title="From a city name to a conversation, in four steps." />
          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((st, i) => (
              <li key={st.title} className="reveal-item fact relative rounded-[var(--radius)] border border-line bg-bg p-6" style={tone(i)}>
                <div className="flex items-center justify-between">
                  <span className="fact-icon w-11 h-11 rounded-full grid place-items-center">
                    <Icon name={st.icon} className="w-5 h-5" />
                  </span>
                  <span className="font-serif text-[2.6rem] leading-none font-semibold text-ink-faint/40 tabular-nums" aria-hidden>
                    {i + 1}
                  </span>
                </div>
                <h3 className="text-xl font-semibold mt-4">{st.title}</h3>
                <p className="text-[0.95rem] text-ink-muted mt-2">{st.body}</p>
                {i < STEPS.length - 1 && (
                  <span className="hidden lg:grid absolute -right-[0.95rem] top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full place-items-center bg-surface border border-line text-ink-faint" aria-hidden>
                    <Icon name="chevronRight" className="w-3.5 h-3.5" />
                  </span>
                )}
              </li>
            ))}
          </ol>
        </Section>

        {/* The email itself: its four parts are written in one after another. */}
        <Section>
          <div className="grid gap-10 grid-cols-[minmax(0,1fr)] lg:grid-cols-2 items-center">
            <div className="min-w-0">
              <Head title="An email written for one company, not for a list." lead="Short enough to read on a phone, specific enough that it could only have been written to that company, and it ends with a question that takes one word to answer." />
              <ul className="reveal-item space-y-3 -mt-2">
                {LETTER.map((l, i) => (
                  <li key={l.part} className="flex items-center gap-3 text-[0.98rem] text-ink">
                    <span className="fact-icon w-7 h-7 rounded-full grid place-items-center text-xs font-bold shrink-0" style={tone(i)}>
                      {i + 1}
                    </span>
                    {l.part}
                  </li>
                ))}
              </ul>
            </div>
            <div className="reveal-item min-w-0">
              <div className="letter rounded-[var(--radius)] border border-line bg-surface p-6 md:p-8">
                {LETTER.map((l, i) => (
                  <p key={l.part} className="letter-line letter-text" style={{ animationDelay: `${0.5 + i * 0.9}s`, ...tone(i) }}>
                    {l.text}
                  </p>
                ))}
                <p className="text-xs text-ink-faint mt-5">The shape of every first email. The words in brackets come from the research, never from a template.</p>
              </div>
            </div>
          </div>
        </Section>

        {/* What keeps it honest. */}
        <Section id="trust" band>
          <Head title="Your name is on every email. We protect it." lead="Six rules the product follows every time, whether or not anyone is watching." />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {GUARDS.map((g, i) => (
              <Tile key={g.title} index={i} {...g} />
            ))}
          </div>
        </Section>

        {/* The board: one card travels from the first stage to the last. */}
        <Section>
          <Head title="Never lose track of a conversation again." lead="A company moves forward on its own when its email goes out and when it replies. After that you drag it to where things stand." />
          <div className="reveal-item board-demo" aria-hidden>
            <div className="board-cols">
              {STAGES.map((st, i) => (
                <div key={st.name} className="board-col" style={{ animationDelay: `${i * 2.2}s`, "--c": st.color } as React.CSSProperties}>
                  <div className="board-col-title">
                    <span className="board-col-dot" />
                    {st.name}
                  </div>
                </div>
              ))}
            </div>
            {/* The card that travels: it lifts, crosses to the next stage and lands, and turns green when it is won. */}
            <div className="board-card">
              <span className="board-card-mark">
                <Icon name="check" className="w-3.5 h-3.5" />
              </span>
              <span className="board-card-lines">
                <i />
                <i />
              </span>
            </div>
          </div>
        </Section>

        {/* Who it is for. */}
        <Section band>
          <Head title="Made for people who sell a service to other businesses." />
          <div className="grid gap-5 md:grid-cols-3">
            {AUDIENCE.map((a, i) => (
              <Tile key={a.title} index={i} {...a} />
            ))}
          </div>
        </Section>

        {/* Questions before signing up: the heading on the left, the answers on the right. */}
        <Section id="questions">
          <div className="grid gap-x-12 gap-y-2 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <Head title="Questions people ask first." lead="Short, plain answers to what people want to know before they sign up." />
            <div className="reveal-item border-b border-line min-w-0">
              {FAQ.map((f) => (
                <details key={f.q} className="faq border-t border-line">
                  <summary className="flex items-center gap-3 py-4 px-2 -mx-2 rounded-[var(--radius-sm)] cursor-pointer select-none text-[1.05rem] font-semibold hover:bg-surface hover:text-accent-text">
                    <Icon name="chevronRight" className="chevron w-4 h-4 shrink-0 text-ink-faint transition-transform" />
                    {f.q}
                  </summary>
                  <p className="pb-5 pl-7 text-[0.98rem] text-ink-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </Section>

        {/* How to start. */}
        <section className="max-w-6xl mx-auto px-5 pb-16 md:pb-24">
          <Reveal>
            <div className="reveal-item relative overflow-hidden rounded-[var(--radius)] border border-accent/60 bg-surface px-5 py-9 md:px-14 md:py-16 grid gap-8 grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_auto] items-center">
              <div className="min-w-0">
                <h2 className="font-serif text-[1.7rem] md:text-[2.7rem] leading-[1.12]">Start the conversations that turn into clients.</h2>
                <p className="text-lg text-ink-muted mt-4 max-w-xl">Create your free account today. We are opening workspaces a few at a time and will write to you the moment yours is ready.</p>
                <div className="flex flex-wrap gap-3 mt-7">
                  <Link href="/signup" className="btn btn-primary btn-lg max-sm:w-full">
                    Get started free <Icon name="arrowRight" />
                  </Link>
                  <Link href="/login" className="btn btn-lg max-sm:w-full">
                    Sign in
                  </Link>
                </div>
              </div>
              <RadarArt className="w-40 md:w-52 max-md:hidden" />
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="max-w-6xl mx-auto px-5 py-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-ink-muted">
          <span className="flex items-center gap-2.5 font-serif text-base font-semibold text-ink">
            <Logo size="w-7 h-7" /> Opportunity Radar
          </span>
          <span>Outreach you would be glad to receive yourself.</span>
          <span className="md:ml-auto flex flex-wrap gap-x-5 [&>a]:py-2">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/acceptable-use">Acceptable use</Link>
            <Link href="/login">Sign in</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
