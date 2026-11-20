"use client";
/**
 * "Add a mailbox", in two steps a person can follow without knowing what SMTP is:
 *  1. Where is your email? One tile per provider.
 *  2. What that provider needs. Microsoft: its own sign-in button (and only
 *     there). Everyone else: where to make an app password, then the address
 *     and that password. Your own mail server: its names as well.
 * The password goes to the server once, is checked by signing in, and is stored
 * encrypted; it is never shown again.
 */
import { useState } from "react";
import { connectMailboxAction } from "@/app/actions";

interface Provider {
  key: string;
  name: string;
  /** What the tile says under the name. */
  hint: string;
  /** The provider's own logo (public/mail/), or none for the two without one: those get an envelope. */
  logo?: string;
  /** The page where an app password is made. */
  href?: string;
  link?: string;
  /** Before the link works. */
  first?: string;
}

/** In the order people most often have them; the list ends with "something else". */
const PROVIDERS: Provider[] = [
  { key: "gmail", name: "Gmail", hint: "Gmail and Google Workspace addresses", logo: "/mail/gmail.svg", href: "https://myaccount.google.com/apppasswords", link: "Create a Google app password", first: "2-Step Verification must be on in your Google Account." },
  { key: "outlook", name: "Microsoft", hint: "Outlook, Hotmail, Live and Microsoft 365 addresses", logo: "/mail/microsoft.svg", href: "https://account.live.com/proofs/AppPassword", link: "Create a Microsoft app password", first: "Two-step verification must be on in your Microsoft account." },
  { key: "yahoo", name: "Yahoo", hint: "", logo: "/mail/yahoo.svg", href: "https://login.yahoo.com/account/security", link: "Open Yahoo account security", first: "Choose “Generate app password” there." },
  { key: "icloud", name: "iCloud", hint: "iCloud, me.com and mac.com addresses", logo: "/mail/icloud.svg", href: "https://account.apple.com/account/manage", link: "Open your Apple Account", first: "Under Sign-In and Security, choose App-Specific Passwords." },
  { key: "zoho", name: "Zoho", hint: "", logo: "/mail/zoho.svg", href: "https://accounts.zoho.com/home#security/app_password", link: "Open Zoho security", first: "IMAP access must be on in Zoho Mail settings." },
  { key: "custom", name: "Other", hint: "any other address, with your mail host's server names" },
];

function MicrosoftLogo() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/mail/microsoft.svg" alt="" width={18} height={18} />;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-6 h-6 rounded-full bg-accent-soft text-accent text-xs font-semibold grid place-items-center shrink-0 mt-0.5">{n}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

export function MailboxForm({ microsoftReady = false, allowFake = false, from }: { /** The server has its Microsoft app registered, so the sign-in button works. */ microsoftReady?: boolean; allowFake?: boolean; /** Shown inside the first-run setup: connecting leads back to it. */ from?: "setup" }) {
  // Gmail is what most people have, so its steps are open from the start.
  const [key, setKey] = useState<string | null>("gmail");
  // Microsoft: its own sign-in first; the app password is the fallback a person has to ask for.
  const [withPassword, setWithPassword] = useState(false);
  const provider = PROVIDERS.find((p) => p.key === key) ?? null;
  const microsoft = key === "outlook";
  const custom = key === "custom";
  const fake = key === "fake";
  const showFields = Boolean(key) && (!microsoft || withPassword || !microsoftReady);

  return (
    <div className="space-y-5">
      <div>
        <div className="label mb-2">Where is your email?</div>
        {/* Two rows of three equal tiles: logo on a white square (the same in light and dark), the name under it. */}
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Mail provider">
          {PROVIDERS.map((p) => {
            const on = p.key === key;
            return (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={on}
                title={p.hint || undefined}
                onClick={() => {
                  setKey(p.key);
                  setWithPassword(false);
                }}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border h-[5.5rem] px-1 transition-colors ${on ? "border-[var(--accent)] bg-accent-soft/50 ring-1 ring-[var(--accent)]" : "border-line hover:bg-surface-2"}`}
              >
                <span className="w-10 h-10 rounded-lg bg-white border border-black/5 grid place-items-center shrink-0" aria-hidden="true">
                  {p.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.logo} alt="" className="max-w-7 max-h-6 w-auto h-auto" />
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="m3 7 9 6 9-6" />
                    </svg>
                  )}
                </span>
                <span className="text-sm font-medium leading-none">{p.name}</span>
              </button>
            );
          })}
        </div>
        {allowFake && (
          <button type="button" className="text-xs text-ink-faint mt-2 underline" onClick={() => setKey("fake")}>
            Use a test mailbox (nothing leaves this computer)
          </button>
        )}
      </div>

      {microsoft && (
        <div className="rounded-lg border border-line bg-surface-2 px-4 py-4">
          {microsoftReady ? (
            <>
              {/* A plain link on purpose: it leaves the app for Microsoft's own sign-in page and comes back with the mailbox connected. */}
              <a href={from ? `/auth/microsoft/mailbox?from=${from}` : "/auth/microsoft/mailbox"} className="btn btn-lg bg-surface hover:no-underline">
                <MicrosoftLogo /> Sign in with Microsoft
              </a>
              <p className="text-sm text-ink-muted mt-2.5">You sign in on Microsoft's own page and allow sending and reading mail. No password is typed here, and you can withdraw the access at Microsoft at any time.</p>
              {!withPassword && (
                <button type="button" className="text-xs text-ink-muted underline mt-3" onClick={() => setWithPassword(true)}>
                  Use an app password instead
                </button>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              <span className="inline-flex items-center gap-2 font-medium text-ink">
                <MicrosoftLogo /> Sign in with Microsoft
              </span>{" "}
              is not switched on yet. Until it is, add the mailbox with an app password below. Microsoft has turned app passwords off for many accounts, so this may be refused.
            </p>
          )}
        </div>
      )}

      {showFields && (
        <form action={connectMailboxAction} className="space-y-5">
          <input type="hidden" name="provider" value={key ?? ""} />
          {from && <input type="hidden" name="from" value={from} />}
          {provider?.href && (
            <Step n={1} title="Make an app password">
              <p className="text-sm text-ink-muted">An app password is a separate password made for one app, so your normal password is never asked for here. {provider.first}</p>
              <a href={provider.href} target="_blank" rel="noreferrer" className="btn btn-sm mt-2.5 hover:no-underline">
                {provider.link} ↗
              </a>
              {microsoft && (
                <a href="https://mysignins.microsoft.com/security-info" target="_blank" rel="noreferrer" className="text-xs ml-3">
                  Work or school account ↗
                </a>
              )}
            </Step>
          )}
          <Step n={provider?.href ? 2 : 1} title={fake ? "The test address" : custom ? "Your mailbox" : "Type your address and paste the app password"}>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Email address</span>
                <input className="input mt-1" type="email" name="address" required placeholder="you@yourcompany.com" autoComplete="email" />
              </label>
              {!fake && (
                <label className="block">
                  <span className="label">{custom ? "Mailbox password" : "App password"}</span>
                  <input className="input mt-1" type="password" name="password" required autoComplete="new-password" spellCheck={false} placeholder={custom ? "" : "xxxx xxxx xxxx xxxx"} />
                </label>
              )}
            </div>
          </Step>
          {custom && (
            <Step n={2} title="Your mail server">
              <p className="text-sm text-ink-muted mb-3">Your email host lists these under “mail client settings” or “IMAP / SMTP”.</p>
              <div className="grid sm:grid-cols-[1fr_7rem] gap-3">
                <label className="block">
                  <span className="label">Outgoing server (SMTP)</span>
                  <input className="input mt-1" name="smtpHost" required placeholder="smtp.yourcompany.com" spellCheck={false} />
                </label>
                <label className="block">
                  <span className="label">Port</span>
                  <select className="select mt-1" name="smtpPort" defaultValue="465">
                    <option value="465">465</option>
                    <option value="587">587</option>
                  </select>
                </label>
                <label className="block">
                  <span className="label">Incoming server (IMAP)</span>
                  <input className="input mt-1" name="imapHost" required placeholder="imap.yourcompany.com" spellCheck={false} />
                </label>
                <label className="block">
                  <span className="label">Port</span>
                  <input className="input mt-1" name="imapPort" defaultValue="993" inputMode="numeric" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="label">Sign-in name, only if it is not your email address</span>
                  <input className="input mt-1 sm:max-w-sm" name="user" autoComplete="off" spellCheck={false} />
                </label>
              </div>
            </Step>
          )}
          <div className="flex items-center gap-3 flex-wrap pl-9">
            <button className="btn btn-primary">Add mailbox</button>
            <span className="text-xs text-ink-muted">We sign in once to check it. Nothing is saved if that fails, and no email is sent.</span>
          </div>
        </form>
      )}
    </div>
  );
}
