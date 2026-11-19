import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
import { Badge, Callout, Card, Flash, Icon, KeyValue, PageHeader, Tabs, type Tone } from "@/components/ui";
import { usageSummary } from "@/lib/ai/usage";
import { getConfig, integrationStatus, MAIL_PRESETS } from "@/lib/config";
import { listSuppressions } from "@/lib/email/suppression";
import { listRemoved } from "@/lib/pipeline/removed";
import { verdictLabel } from "@/lib/pipeline/stages";
import { workerStatus } from "@/lib/jobs/worker";
import { signatureBlock } from "@/lib/outreach/drafts";
import { creditsUsedThisMonth } from "@/lib/research/stored";
import { usageTotal } from "@/lib/discovery/usage";
import { getSettings, getState, missingSenderDetails, monthlyAiBudgetUsd } from "@/lib/settings";
import { SETTINGS_TABS, settingsHref, type SettingsTab } from "@/lib/settings-nav";
import { addSuppressionAction, allowBusinessAgainAction, removeSuppressionAction, saveSettingsAction, sendTestEmailAction, syncMailboxAction, testMailboxAction } from "@/app/actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; tab?: string; rq?: string; rp?: string }> }) {
  const sp = await searchParams;
  const tab: SettingsTab = SETTINGS_TABS.some((t) => t.key === sp.tab) ? (sp.tab as SettingsTab) : "sender";
  const cfg = getConfig();
  const [s, usage, aiLimit, credits, serperUsed, suppressions, lastSync] = await Promise.all([getSettings(), usageSummary(), monthlyAiBudgetUsd(), creditsUsedThisMonth(), usageTotal("serper"), listSuppressions(200), getState<{ at: string; replies: number; bounces: number; fetched: number }>("mail.lastSync")]);
  const removed = tab === "do-not-contact" ? await listRemoved() : [];
  /** The removed list can grow long: it has its own search and pages. */
  const REMOVED_PER_PAGE = 20;
  const removedQuery = (sp.rq ?? "").trim().slice(0, 80);
  const removedNeedle = removedQuery.toLowerCase();
  const removedShown = removedNeedle ? removed.filter((r) => [r.name, r.city, r.websiteDomain].some((v) => (v ?? "").toLowerCase().includes(removedNeedle))) : removed;
  const removedPages = Math.max(1, Math.ceil(removedShown.length / REMOVED_PER_PAGE));
  const removedPage = Math.min(removedPages, Math.max(1, Number(sp.rp) || 1));
  const removedHref = (page: number) => `/settings?tab=do-not-contact${removedQuery ? `&rq=${encodeURIComponent(removedQuery)}` : ""}${page > 1 ? `&rp=${page}` : ""}#removed`;
  const integ = integrationStatus();
  const worker = workerStatus();
  const missing = missingSenderDetails(s);
  const tone = (st: string): Tone => (st === "live" ? "ok" : st === "missing_credentials" ? "warn" : "neutral");
  const Bar = ({ used, limit, unit }: { used: number; limit: number; unit: string }) => {
    const pct = Math.min(100, (used / Math.max(limit, 0.0001)) * 100);
    return (
      <div>
        <div className="flex justify-between text-sm">
          <span>
            <strong className="tabular-nums">{unit === "$" ? `$${used.toFixed(2)}` : used.toLocaleString()}</strong> <span className="text-ink-muted">used</span>
          </span>
          <span className="text-ink-muted">of {unit === "$" ? `$${limit}` : `${limit.toLocaleString()} ${unit}`}</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-3 mt-1.5 overflow-hidden">
          <div className={`h-full rounded-full ${pct > 85 ? "bg-bad" : pct > 60 ? "bg-warn" : "bg-ok"}`} style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
      </div>
    );
  };
  const Field = ({ label, name, value, hint, type = "text", placeholder, wide }: { label: string; name: string; value: string | number; hint?: string; type?: string; placeholder?: string; wide?: boolean }) => (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <input className="input" id={name} name={name} type={type} defaultValue={value} placeholder={placeholder} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );

  const tabBadge: Partial<Record<SettingsTab, number>> = { sender: missing.length, mailbox: cfg.mail.enabled ? 0 : 1, system: [integ.googleMaps, integ.websiteResearch, integ.ai].filter((i) => i.status !== "live").length };

  return (
    <>
      <PageHeader title="Settings" subtitle="Who the emails come from, how many go out, and what runs on its own." />
      <Flash msg={sp.ok} />
      <Flash msg={sp.error} tone="bad" />
      <Tabs items={SETTINGS_TABS.map((t) => ({ href: `/settings?tab=${t.key}`, label: t.label, count: tabBadge[t.key] || null, active: tab === t.key }))} />

      {tab === "sender" && (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
          <Card id="sender" className="scroll-mt-4" title="You, the sender" description="Appended to every email by the system. The writer never invents who you are.">
            {missing.length > 0 && (
              <div className="mb-4">
                <Callout tone="warn" title="Needed before anything can be sent">
                  Still missing: {missing.join(", ")}.
                </Callout>
              </div>
            )}
            <form action={saveSettingsAction} className="grid sm:grid-cols-2 gap-4">
              <input type="hidden" name="section" value="sender" />
              <Field label="Your name" name="senderName" value={s.senderName} placeholder="Ivan Dimov" />
              <Field label="Your title" name="senderTitle" value={s.senderTitle} placeholder="Founder" />
              <Field label="Company (optional)" name="senderCompany" value={s.senderCompany} placeholder="Leave empty to write under your own name" />
              <Field label="Website (optional)" name="senderWebsite" value={s.senderWebsite} placeholder="yourcompany.com" />
              <Field wide label="Postal address" name="postalAddress" value={s.postalAddress} hint="A real postal address must appear in commercial email (US CAN-SPAM)." />
              <Field wide label="What you do, in a sentence or two" name="offer" value={s.offer} placeholder="I build custom software tools and automations that take repetitive work off people's hands." hint="The email writer uses this to describe you. Plain words." />
              <Field wide label="Booking link (optional)" name="bookingLink" value={s.bookingLink} placeholder="https://cal.com/you/intro" hint="The only link an email may contain." />
              <div className="sm:col-span-2">
                <label className="label" htmlFor="voiceSamples">
                  How you write (optional)
                </label>
                <textarea className="textarea" id="voiceSamples" name="voiceSamples" rows={5} defaultValue={s.voiceSamples} placeholder="Paste two or three emails you wrote yourself. The writer picks up your rhythm and word choice, not the content." />
              </div>
              <div className="sm:col-span-2">
                <button className="btn btn-primary">Save</button>
              </div>
            </form>
          </Card>
          <Card id="signature" title="Your signature" description="Added under every email, exactly like this.">
            <pre className="letter-text whitespace-pre-wrap text-ink">{signatureBlock(s)}</pre>
          </Card>
        </div>
      )}

      {tab === "mailbox" && (
        <div className="grid lg:grid-cols-2 gap-5 items-stretch">
          <Card id="mailbox" className="scroll-mt-4" title="Mailbox" description="Emails go out from your own address and replies are read from its inbox.">
            {cfg.mail.enabled ? (
              <>
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <Badge tone="ok" dot>
                    Connected
                  </Badge>
                  <strong>{cfg.mail.address}</strong>
                  <span className="text-ink-muted">{cfg.mail.provider === "fake" ? "in-memory test mailbox: nothing leaves this computer" : (MAIL_PRESETS[cfg.mail.provider ?? ""]?.label ?? `${cfg.mail.smtp?.host} / ${cfg.mail.imap?.host}`)}</span>
                </div>
                <p className="text-xs text-ink-muted mt-2">{lastSync ? `Inbox last read ${new Date(lastSync.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}: ${lastSync.replies} repl${lastSync.replies === 1 ? "y" : "ies"}, ${lastSync.bounces} bounce(s) in ${lastSync.fetched} new message(s).` : "The inbox is read every five minutes while sent emails are waiting for an answer."} Only messages that answer an email sent from here are kept.</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <form action={testMailboxAction}>
                    <button className="btn btn-sm">Check the connection</button>
                  </form>
                  <form action={sendTestEmailAction}>
                    <ConfirmButton confirmLabel="Send the test" className="btn btn-sm" message={`Send one test email to ${cfg.mail.address}?`}>
                      Send a test email to myself
                    </ConfirmButton>
                  </form>
                  <form action={syncMailboxAction}>
                    <input type="hidden" name="returnTo" value={settingsHref("mailbox")} />
                    <button className="btn btn-sm btn-ghost">Read the inbox now</button>
                  </form>
                </div>
              </>
            ) : (
              <>
                <Callout tone="info" title="Not connected">
                  {cfg.mail.reason}
                </Callout>
                <div className="text-sm mt-4 space-y-2">
                  <p>To connect, create an <strong>app password</strong> in your mailbox's security settings (not your normal password), add three lines to <code>.env</code> and restart:</p>
                  <pre className="text-xs rounded-lg bg-surface-2 border border-line px-3 py-2 overflow-x-auto">{`MAIL_PROVIDER=gmail        # ${Object.keys(MAIL_PRESETS).join(" | ")} | custom\nMAIL_USER=you@yourcompany.com\nMAIL_PASSWORD=the-app-password`}</pre>
                  <p className="text-xs text-ink-muted">Works with Gmail and Google Workspace, Yahoo, iCloud, Zoho, Fastmail and most hosting providers. For another provider use <code>MAIL_PROVIDER=custom</code> with <code>MAIL_SMTP_HOST</code> and <code>MAIL_IMAP_HOST</code>. Microsoft 365 often has app passwords switched off by its administrator. Until a mailbox is connected you can still copy an approved email and send it yourself.</p>
                </div>
              </>
            )}
          </Card>
          <Card id="sending" className="scroll-mt-4" title="Sending" description="“Send approved emails” queues them; these limits decide when each one actually leaves.">
            <form action={saveSettingsAction} className="grid sm:grid-cols-2 gap-4">
              <input type="hidden" name="section" value="sending" />
              <Field label="Emails per day, at most" name="dailySendCap" type="number" value={s.dailySendCap} hint="Keep it low from a personal mailbox: 20 is a sensible ceiling." />
              <Field label="Pause between emails (seconds)" name="sendSpacingSeconds" type="number" value={s.sendSpacingSeconds} />
              <Field label="Send from (hour, 0-23)" name="sendWindowStart" type="number" value={s.sendWindowStart} />
              <Field label="Send until (hour, 1-24)" name="sendWindowEnd" type="number" value={s.sendWindowEnd} hint="This computer's local time." />
              <Field label="Countries you may email" name="allowedCountries" value={s.allowedCountries.join(", ")} hint="Two-letter codes, comma separated. Empty = any. Rules for unsolicited business email differ by country; add one only after checking its rules." />
              <Field label="Follow up after (working days)" name="followUpDays" type="number" value={s.followUpDays} hint="One follow-up is drafted for your approval when nobody answers. 0 = never." />
              <div className="sm:col-span-2">
                <button className="btn btn-primary">Save</button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {tab === "automation" && (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
          <Card id="automation" className="scroll-mt-4" title="Automation and budgets" description="What runs without you. Sending is never automatic.">
            <form action={saveSettingsAction} className="grid sm:grid-cols-2 gap-4">
              <input type="hidden" name="section" value="automation" />
              <label className="flex items-start gap-2.5 text-sm sm:col-span-2">
                <input type="checkbox" name="autoResearch" defaultChecked={s.autoResearch} className="mt-0.5" />
                <span>
                  <strong>Research saved businesses on its own</strong>, best leads first
                  <span className="block text-xs text-ink-muted">Uses Firecrawl credits and the AI budget below. Pauses while enough emails wait for your review.</span>
                </span>
              </label>
              <Field label="Businesses researched per day, at most" name="researchPerDay" type="number" value={s.researchPerDay} />
              <Field label="Pause research when this many emails wait" name="readyBuffer" type="number" value={s.readyBuffer} />
              <label className="flex items-start gap-2.5 text-sm sm:col-span-2">
                <input type="checkbox" name="autoDraft" defaultChecked={s.autoDraft} className="mt-0.5" />
                <span>
                  <strong>Write the email as soon as a business qualifies</strong>
                  <span className="block text-xs text-ink-muted">It lands under Outreach for your review. Nothing is sent.</span>
                </span>
              </label>
              <Field label="AI budget per month (USD)" name="monthlyAiBudgetUsd" type="number" value={s.monthlyAiBudgetUsd ?? ""} placeholder={`${cfg.AI_SPEND_LIMIT_USD} (from .env)`} hint="Research and writing stop for the month when this is reached." />
              <div className="sm:col-span-2">
                <button className="btn btn-primary">Save</button>
              </div>
            </form>
          </Card>
          <Card id="usage" title="This month" description="Budgets reset on the first of the month.">
            <div className="space-y-4">
              <div>
                <div className="label">AI (research, writing, checks)</div>
                <Bar used={usage.month} limit={aiLimit} unit="$" />
              </div>
              <div>
                <div className="label">Website research (Firecrawl)</div>
                <Bar used={credits.credits} limit={cfg.FIRECRAWL_MONTHLY_CREDIT_BUDGET} unit="credits" />
              </div>
              <div>
                <div className="label">Finding businesses (Serper, does not renew)</div>
                <Bar used={serperUsed} limit={cfg.SERPER_CREDIT_BUDGET} unit="credits" />
              </div>
            </div>
            {usage.byStage.length > 0 && (
              <table className="table text-xs mt-4">
                <thead>
                  <tr>
                    <th>AI use, all time</th>
                    <th className="text-right">Calls</th>
                    <th className="text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byStage.map((u) => (
                    <tr key={u.stage}>
                      <td>{{ investigate: "Research", outreach: "Writing emails", check: "Checking emails", reply: "Reading replies" }[u.stage] ?? u.stage}</td>
                      <td className="text-right tabular-nums">{u.calls}</td>
                      <td className="text-right tabular-nums">${(u.cost ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      {tab === "do-not-contact" && (
        <div className="space-y-5">
          <Card id="do-not-contact" className="scroll-mt-4" title="Do-not-contact list" description="Opt-outs and dead addresses land here on their own and are never emailed again. You can add addresses or whole domains." padded={false}>
            <form action={addSuppressionAction} className="flex flex-wrap gap-2 p-5 border-b border-line bg-surface-2">
              <input className="input flex-1 min-w-[220px]" name="value" placeholder="person@company.com or company.com" required />
              <input className="input flex-1 min-w-[160px]" name="note" placeholder="Note (optional)" />
              <button className="btn">Add</button>
            </form>
            {suppressions.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-faint">Nobody is on the list.</p>
            ) : (
              <ul className="divide-y divide-line">
                {suppressions.map((x) => (
                  <li key={x.id} className="px-5 py-2.5 flex items-center gap-3 text-sm">
                    <span className="font-medium min-w-0 truncate">{x.value}</span>
                    <Badge tone={x.reason === "bounced" ? "bad" : x.reason === "unsubscribed" ? "warn" : "neutral"}>{x.reason === "unsubscribed" ? "asked to stop" : x.reason}</Badge>
                    <span className="text-xs text-ink-faint truncate flex-1">{x.note}</span>
                    <span className="text-xs text-ink-faint shrink-0">{new Date(x.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                    <form action={removeSuppressionAction}>
                      <input type="hidden" name="id" value={x.id} />
                      <ConfirmButton confirmLabel="Remove" danger className="btn btn-ghost btn-sm text-ink-faint" message={`Remove ${x.value} from the do-not-contact list? It could then be emailed again.`}>
                        <Icon name="x" />
                      </ConfirmButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {/* This list grows with every business that is not a fit: a table with a search, the full width. */}
          <Card id="removed" className="scroll-mt-4" padded={false}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 border-b border-line">
              <h2 className="text-base font-semibold leading-6">
                {removed.length} removed {removed.length === 1 ? "business" : "businesses"}
              </h2>
              <span className="text-sm text-ink-muted flex-1 min-w-[12rem]">Left out of every future search and import.</span>
              {removed.length > 0 && (
                <form action="/settings" method="get" className="flex items-center gap-2 w-full sm:w-auto">
                  <input type="hidden" name="tab" value="do-not-contact" />
                  <input className="input sm:w-64" name="rq" defaultValue={removedQuery} placeholder="Search name, city or website" aria-label="Search removed businesses" />
                  <button className="btn btn-sm">Search</button>
                  {removedQuery && (
                    <Link href="/settings?tab=do-not-contact#removed" className="btn btn-sm btn-ghost">
                      Clear
                    </Link>
                  )}
                </form>
              )}
            </div>
            {removed.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-faint">Nothing has been removed. Use the remove button on a row of the Businesses table, or “Remove” on a business page.</p>
            ) : removedShown.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-faint">No removed business matches “{removedQuery}”.</p>
            ) : (
              <>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Business</th>
                      <th>City</th>
                      <th>Website</th>
                      <th>What research said</th>
                      <th>Removed</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {removedShown.slice((removedPage - 1) * REMOVED_PER_PAGE, removedPage * REMOVED_PER_PAGE).map((r) => (
                      <tr key={r.id}>
                        <td className="font-semibold text-ink">{r.name}</td>
                        <td className="text-ink-muted">{r.city ?? ""}</td>
                        <td className="text-ink-muted">{r.websiteDomain ?? ""}</td>
                        <td>{r.verdict ? <Badge tone="neutral">{verdictLabel(r.verdict)}</Badge> : <span className="text-ink-faint">not researched</span>}</td>
                        <td className="text-ink-muted whitespace-nowrap">{new Date(r.removedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                        <td className="md:text-right">
                          <form action={allowBusinessAgainAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <ConfirmButton confirmLabel="Allow again" className="btn btn-sm" message={`Allow ${r.name} again? The next search that finds it will add it back as a new business.`}>
                              Allow again
                            </ConfirmButton>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {removedPages > 1 && (
                  <nav className="flex items-center justify-between gap-3 px-5 py-3 border-t border-line text-sm text-ink-muted" aria-label="Removed businesses pages">
                    <span>
                      {(removedPage - 1) * REMOVED_PER_PAGE + 1}–{Math.min(removedShown.length, removedPage * REMOVED_PER_PAGE)} of {removedShown.length}
                    </span>
                    <div className="flex items-center gap-1">
                      <Link aria-disabled={removedPage <= 1} className={`btn btn-sm btn-ghost ${removedPage <= 1 ? "pointer-events-none opacity-40" : ""}`} href={removedHref(removedPage - 1)}>
                        Previous
                      </Link>
                      <span className="tabular-nums px-1">
                        page {removedPage} / {removedPages}
                      </span>
                      <Link aria-disabled={removedPage >= removedPages} className={`btn btn-sm btn-ghost ${removedPage >= removedPages ? "pointer-events-none opacity-40" : ""}`} href={removedHref(removedPage + 1)}>
                        Next
                      </Link>
                    </div>
                  </nav>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {tab === "system" && (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
          <Card id="connections" title="Connections" description="Keys live in the .env file on this computer, never here." padded={false}>
            <ul className="divide-y divide-line">
              {[integ.googleMaps, integ.websiteResearch, integ.ai, integ.webSearch, integ.storage].map((i) => (
                <li key={i.label} className="px-5 py-3 flex gap-3">
                  <Badge tone={tone(i.status)} dot className="h-5 mt-0.5 shrink-0">
                    {i.status === "live" ? "Live" : i.status === "missing_credentials" ? "Needs a key" : "Off"}
                  </Badge>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{i.label}</div>
                    <div className="text-xs text-ink-muted mt-0.5 ">
                      {i.detail}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Background work">
            <KeyValue
              rows={[
                { k: "Worker", v: worker.running ? <Badge tone="ok" dot>running · {worker.active} active</Badge> : <Badge tone="warn" dot>not running in this process</Badge> },
                { k: "Pages read per business", v: `up to ${cfg.RESEARCH_MAX_PAGES}` },
                { k: "Research without a public email", v: cfg.RESEARCH_REQUIRE_EMAIL ? "stops after 2 pages" : "continues" },
                { k: "Database", v: <code className="text-xs">{cfg.TURSO_DATABASE_URL ? "hosted" : cfg.DATABASE_PATH}</code> },
              ]}
            />
            <Link href="/system" className="btn btn-sm btn-ghost mt-3">
              <Icon name="bolt" /> Jobs and health
            </Link>
          </Card>
        </div>
      )}
    </>
  );
}
