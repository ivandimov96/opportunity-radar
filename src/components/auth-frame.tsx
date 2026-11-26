/**
 * The frame shared by the sign-in, sign-up and welcome pages. On a wide screen
 * it has two halves: the product on the left (the radar, and three things that
 * are true of it), the form on the right. On a phone only the form is shown.
 */
import Link from "next/link";
import { Icon } from "./icons";
import { Logo } from "./logo";
import { RadarArt } from "./radar-art";

const TRUE_THINGS = ["Every email says only what was read on the company's own website.", "Nothing is sent without your say: you approve each email, or you switch on automatic sending yourself.", "Replies come back to your own mailbox and onto one board."];

export function AuthFrame({ title, lead, children, footer }: { title: string; lead?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="hidden lg:flex flex-col justify-between bg-surface border-r border-line p-10 xl:p-14 overflow-hidden">
        <Link href="/" className="flex items-center gap-2.5 font-serif text-xl font-semibold text-ink hover:no-underline">
          <Logo size="w-10 h-10" /> Opportunity Radar
        </Link>
        <div className="flex justify-center py-8">
          <RadarArt className="w-[min(22rem,70%)]" />
        </div>
        <ul className="space-y-3 max-w-md">
          {TRUE_THINGS.map((t) => (
            <li key={t} className="flex items-start gap-3 text-[0.95rem] text-ink-muted">
              <span className="w-6 h-6 rounded-full bg-ok-soft text-ok grid place-items-center shrink-0 mt-0.5">
                <Icon name="check" className="w-3.5 h-3.5" />
              </span>
              {t}
            </li>
          ))}
        </ul>
      </aside>
      <main className="flex flex-col items-center justify-start sm:justify-center px-5 pt-8 pb-10 sm:py-10">
        <Link href="/" className="lg:hidden flex items-center gap-2.5 font-serif text-xl font-semibold text-ink hover:no-underline mb-8">
          <Logo size="w-10 h-10" /> Opportunity Radar
        </Link>
        <div className="w-full max-w-[26rem] rise">
          <h1 className="text-[1.7rem] sm:text-[1.9rem] leading-tight">{title}</h1>
          {lead && <p className="text-[0.98rem] text-ink-muted mt-1.5">{lead}</p>}
          <div className="mt-7">{children}</div>
          {footer && <p className="text-sm text-ink-muted mt-6 text-center">{footer}</p>}
        </div>
      </main>
    </div>
  );
}

/** What went wrong, above a form. */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-bad bg-bad-soft border border-bad/30 rounded-[var(--radius-sm)] px-3 py-2.5 mb-4">
      {message}
    </p>
  );
}

/**
 * The ways to sign in without a password, then a line that says the form below is the other way.
 * Only what is set up on this server is offered, so nobody presses a button that leads to an error.
 */
export function SignInButtons({ verb }: { verb: "Continue" | "Sign up" }) {
  const google = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const microsoft = Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
  if (!google && !microsoft) return null;
  return (
    <>
      <div className="space-y-2.5">
        {google && (
          <a href="/auth/google" className="btn btn-lg w-full">
            <svg viewBox="0 0 24 24" className="w-[1.15rem] h-[1.15rem]" aria-hidden>
              <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.4-4.7 3.4-8z" />
              <path fill="#34A853" d="M12 23c3 0 5.500-1 7.300-2.700l-3.500-2.700c-1 .700-2.300 1.100-3.800 1.100-2.900 0-5.300-1.900-6.200-4.600H2.200v2.800A11 11 0 0 0 12 23z" />
              <path fill="#FBBC05" d="M5.800 14.100a6.600 6.600 0 0 1 0-4.200V7.100H2.200a11 11 0 0 0 0 9.800l3.600-2.800z" />
              <path fill="#EA4335" d="M12 5.400c1.600 0 3.100.6 4.200 1.600l3.100-3.100A11 11 0 0 0 2.200 7.100l3.600 2.800c.9-2.600 3.300-4.500 6.200-4.500z" />
            </svg>
            {verb} with Google
          </a>
        )}
        {microsoft && (
          <a href="/auth/microsoft" className="btn btn-lg w-full">
            <svg viewBox="0 0 24 24" className="w-[1.05rem] h-[1.05rem]" aria-hidden>
              <path fill="#F25022" d="M2 2h9.500v9.500H2z" />
              <path fill="#7FBA00" d="M12.500 2H22v9.500h-9.500z" />
              <path fill="#00A4EF" d="M2 12.500h9.500V22H2z" />
              <path fill="#FFB900" d="M12.500 12.500H22V22h-9.500z" />
            </svg>
            {verb} with Microsoft
          </a>
        )}
      </div>
      <div className="flex items-center gap-3 my-5 text-xs text-ink-faint" role="separator">
        <span className="h-px flex-1 bg-line" /> or with your email <span className="h-px flex-1 bg-line" />
      </div>
    </>
  );
}
