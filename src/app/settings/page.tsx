import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
import { Badge, Callout, Card, Flash, Icon, KeyValue, PageHeader, type Tone, EmptyLine } from "@/components/ui";
import { usageSummary } from "@/lib/ai/usage";
import { getConfig, integrationStatus, MAIL_PRESETS } from "@/lib/config";
import { listMailboxes, mailboxFor, NO_WORKSPACE_MAILBOX } from "@/lib/mail";
import { microsoftConfigured } from "@/lib/mail/microsoft";
import { MailboxForm } from "./mailbox-form";
import { Pager, clampPage } from "@/components/table";
import { Block, Field as FormField, Fields, Group, ModeTile, NumberInput, Row, SettingsForm, Toggle } from "./parts";
import { SaveBar } from "./save-bar";
import { ProfileStepFields, PROFILE_STEP_SECTIONS, PROFILE_STEP_TEXT } from "./profile-steps";
import { countryName, listCountries, regionName } from "@/lib/geo/world";
import { FIRST_WORKSPACE_ID } from "@/db/schema";
import { PLANS, usageByWorkspace, usageOf } from "@/lib/usage";
import { workspaceId } from "@/lib/workspace";
import { listSuppressions } from "@/lib/email/suppression";
import { listRemoved } from "@/lib/pipeline/removed";
import { verdictLabel } from "@/lib/pipeline/stages";
import { workerStatus } from "@/lib/jobs/worker";
import { signatureBlock, signatureLines } from "@/lib/outreach/drafts";
import { creditsUsedThisMonth } from "@/lib/research/stored";
import { usageTotal } from "@/lib/discovery/usage";
import { getSettings, getState, missingSenderDetails, saysEnough, monthlyAiBudgetUsd, searchTargetsText, replyRulesOf, searchTargetsOf } from "@/lib/settings";
import { autopilotStatus, TRUST_MIN_MANUAL } from "@/lib/outreach/autopilot";
import { AUTO_SEARCH_CREDITS, AUTO_SEARCH_RESULTS } from "@/lib/discovery/auto-search";
import { SETTINGS_TABS, settingsHref, type SettingsTab } from "@/lib/settings-nav";
import { addSuppressionAction, setWorkspacePlanAction, removeMailboxAction, setDefaultMailboxAction, allowBusinessAgainAction, removeSuppressionAction, resumeAutopilotAction, saveSettingsAction, sendTestEmailAction, syncMailboxAction, testMailboxAction } from "@/app/actions";

export const metadata = { title: "Settings" };

/** The logo of the provider a mailbox was added as (public/mail/). */
const MAIL_LOGO: Record<string, string> = { gmail: "/mail/gmail.svg", outlook: "/mail/microsoft.svg", microsoft: "/mail/microsoft.svg", yahoo: "/mail/yahoo.svg", icloud: "/mail/icloud.svg", zoho: "/mail/zoho.svg" };

/** The hours of a day as people read them on a clock. 24 is the end of the day. */
const HOURS = Array.from({ length: 25 }, (_, h) => h);
const clock = (h: number) => (h === 24 ? "24:00 (midnight)" : `${String(h).padStart(2, "0")}:00`);

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; tab?: string; step?: string; rq?: string; rp?: string; dp?: string }> }) {
  const sp = await searchParams;
  // The product's own workspace sees what the providers cost and what every account used; a customer sees their plan.
  const platform = (await workspaceId()) === FIRST_WORKSPACE_ID;
  const myUsage = await usageOf();
  const accounts = platform ? await usageByWorkspace() : [];
  // How the product is built (its services, its background work) is shown to the product's own workspace only.
  const tabs = SETTINGS_TABS.filter((t) => platform || t.key !== "system");
  const tab: SettingsTab = tabs.some((t) => t.key === sp.tab) ? (sp.tab as SettingsTab) : "sender";
  const cfg = getConfig();
  // The mailbox as this workspace has it (only the first workspace has one for now).
  const box = await mailboxFor();
  const boxes = await listMailboxes();
  const [s, usage, aiLimit, credits, serperUsed, suppressions, lastSync] = await Promise.all([getSettings(), usageSummary(), monthlyAiBudgetUsd(), creditsUsedThisMonth(), usageTotal("serper"), listSuppressions(5000), getState<{ at: string; replies: number; bounces: number; fetched: number }>("mail.lastSync")]);
  const removed = tab === "do-not-contact" ? await listRemoved() : [];
  const pilot = await autopilotStatus(s);
  /** What the app searches for on its own: made from the profile. */
  const autoTargets = searchTargetsOf(s);
  /** What happens to each kind of reply: the operator's own rules, or the defaults while they have set none. */
  const replyRules = replyRulesOf(s);
  /** The removed list can grow long: it has its own search and pages. */
  const REMOVED_PER_PAGE = 25;
  const removedQuery = (sp.rq ?? "").trim().slice(0, 80);
  const removedNeedle = removedQuery.toLowerCase();
  const removedShown = removedNeedle ? removed.filter((r) => [r.name, r.city, r.websiteDomain].some((v) => (v ?? "").toLowerCase().includes(removedNeedle))) : removed;
  const removedPages = Math.max(1, Math.ceil(removedShown.length / REMOVED_PER_PAGE));
  const removedPage = Math.min(removedPages, Math.max(1, Number(sp.rp) || 1));
  /** The do-not-contact list, a page at a time. */
  const DNC_PER_PAGE = 25;
  const dncPage = clampPage(sp.dp, suppressions.length, DNC_PER_PAGE);
  const removedHref = (page: number) => `/settings?tab=do-not-contact${removedQuery ? `&rq=${encodeURIComponent(removedQuery)}` : ""}${page > 1 ? `&rp=${page}` : ""}#removed`;
  const integ = integrationStatus();
  const countries = tab === "sender" ? listCountries().map((c) => ({ code: c.code, name: c.name })).sort((x, y) => x.name.localeCompare(y.name)) : [];
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

  const tabBadge: Partial<Record<SettingsTab, number>> = { sender: missing.length, mailbox: box.enabled ? 0 : 1, system: platform ? [integ.googleMaps, integ.websiteResearch, integ.ai].filter((i) => i.status !== "live").length : 0 };

  return (
    <>
      <PageHeader title="Settings" />
      <Flash msg={sp.ok} />
      <Flash msg={sp.error} tone="bad" />
      <div className="grid lg:grid-cols-[230px_minmax(0,1fr)] gap-x-8 gap-y-5 items-start">
        {/* The sections, grouped. On a phone the menu is one row that scrolls sideways. */}
        <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible lg:sticky lg:top-6 -mx-1 px-1 pb-1" aria-label="Settings sections">
          {tabs.map((t, i) => {
            const active = tab === t.key;
            const firstOfGroup = i === 0 || tabs[i - 1].group !== t.group;
            const n = tabBadge[t.key] || 0;
            return (
              <div key={t.key} className="contents lg:block">
                {firstOfGroup && i > 0 && <div className={`hidden lg:block text-xs font-semibold text-ink-faint px-3 pb-1 pt-4`}>{t.group}</div>}
                <Link href={`/settings?tab=${t.key}`} aria-current={active ? "page" : undefined} className={`flex items-center gap-2.5 rounded-lg px-3 h-10 text-sm whitespace-nowrap hover:no-underline ${active ? "bg-accent-soft text-accent-text font-semibold" : "text-ink-muted hover:bg-surface-2 hover:text-ink"}`}>
                  <Icon name={t.icon} className="w-4 h-4 shrink-0" />
                  <span className="lg:flex-1">{t.label}</span>
                  {n > 0 && <span className="rounded-full bg-warn-soft text-warn text-xs font-bold px-1.5 leading-5 tabular-nums">{n}</span>}
                </Link>
              </div>
            );
          })}
        </nav>
        <div className="min-w-0">

      {tab === "sender" &&
        (() => {
          // Plain tabs: the guided, in-order walk is the first-run setup (/setup); here everything is simply there to change.
          const steps = [
            { key: "you", label: "Profile", done: missing.length === 0 },
            { key: "offer", label: "Offer", done: saysEnough(s.offer) && saysEnough(s.offerResult) },
            { key: "audience", label: "Customers", done: s.targetKinds.length > 0 && s.targetPlaces.length > 0 },
            { key: "extras", label: "Extras", done: true },
          ] as const;
          // Opens on the tab asked for, otherwise on the first that still needs something.
          const step = (steps.find((x) => x.key === sp.step) ?? steps.find((x) => !x.done) ?? steps[0]).key;
          const stepHref = (key: string) => `/settings?tab=sender&step=${key}`;
          const sections = PROFILE_STEP_SECTIONS[step];
          const heading = PROFILE_STEP_TEXT[step];
          return (
            // The same Save as every other Settings page: a bar that appears once something was changed.
            <form action={saveSettingsAction} id={step === "you" ? "sender" : step} data-discard="reload" className="max-w-3xl space-y-5 scroll-mt-4">
              <div className="surface">
              <nav className="flex gap-1 px-3 border-b border-line overflow-x-auto" aria-label="Your details">
                {steps.map((x) => {
                  const on = x.key === step;
                  return (
                    <Link key={x.key} href={stepHref(x.key)} aria-current={on ? "page" : undefined} className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-3.5 text-sm font-medium hover:no-underline transition-colors ${on ? "text-ink" : "text-ink-muted hover:text-ink"}`}>
                      {x.label}
                      {/* A tab that still lacks something the app needs says so with a dot. */}
                      {!x.done && <span className="w-1.5 h-1.5 rounded-full bg-[var(--warn)]" role="img" aria-label="needs your attention" />}
                      {on && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-[var(--accent)]" />}
                    </Link>
                  );
                })}
              </nav>
              {sections.map((name) => (
                <input key={name} type="hidden" name="section" value={name} />
              ))}
              {/* Saving stays on the tab. */}
              <input type="hidden" name="then" value={stepHref(step)} />
              <header className="px-6 pt-5 pb-1">
                <h2 className="text-lg font-semibold">{heading[0]}</h2>
                <p className="text-sm text-ink-muted mt-1">{heading[1]}</p>
              </header>

              <ProfileStepFields step={step} s={s} countries={countries} />
              </div>
              <SaveBar />
            </form>
          );
        })()}

      {tab === "mailbox" && (
        <div className="space-y-5 max-w-3xl">
          <Card id="mailbox" className="scroll-mt-4" title="Mailboxes" description="Connect the email address your emails are sent from and replies come back to." padded={false}>
            {boxes.length > 0 && (
              <ul className="grid sm:grid-cols-2 gap-3 p-4">
                {boxes.map((m) => {
                  const sendsFrom = m.isDefault && m.enabled;
                  return (
                    <li key={m.id} className={`rounded-xl border p-4 flex flex-col gap-3 ${sendsFrom ? "border-[var(--accent)] bg-accent-soft/30" : "border-line"}`}>
                      <div className="flex items-start gap-3">
                        <span className="w-10 h-10 rounded-lg bg-white border border-black/5 grid place-items-center shrink-0" aria-hidden="true">
                          {MAIL_LOGO[m.provider] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={MAIL_LOGO[m.provider]} alt="" className="max-w-7 max-h-6 w-auto h-auto" />
                          ) : (
                            <Icon name="mail" className="w-5 h-5 text-slate-500" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <strong className="block text-sm truncate" title={m.address}>
                            {m.address}
                          </strong>
                          <span className="block text-xs text-ink-muted truncate" title={m.label ?? undefined}>
                            {m.label}
                          </span>
                        </div>
                        <form action={removeMailboxAction} className="-mt-1 -mr-1.5 shrink-0">
                          <input type="hidden" name="mailboxId" value={m.id} />
                          <ConfirmButton
                            confirmLabel="Remove"
                            danger
                            className="btn btn-sm btn-ghost px-2 text-ink-faint hover:text-bad"
                            title={`Remove ${m.address}`}
                            aria-label={`Remove ${m.address}`}
                            message={`Remove ${m.address}? Its saved sign-in is deleted and its inbox is no longer read. ${boxes.filter((x) => x.enabled && x.id !== m.id).length ? "Emails still waiting go out from your other mailbox." : "Nothing is sent and no replies are read until a mailbox is added again."} Emails already sent stay in your history.`}
                          >
                            <Icon name="x" />
                          </ConfirmButton>
                        </form>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge tone={m.enabled ? "ok" : "warn"} dot>
                          {m.enabled ? "Connected" : "Not working"}
                        </Badge>
                        {sendsFrom && boxes.length > 1 && <Badge tone="info">Sending from this one</Badge>}
                      </div>
                      {m.reason && <p className="text-xs text-warn">{m.reason}</p>}
                      {m.enabled && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-1">
                          {!m.isDefault && (
                            <form action={setDefaultMailboxAction}>
                              <input type="hidden" name="mailboxId" value={m.id} />
                              <button className="btn btn-sm">Send from this one</button>
                            </form>
                          )}
                          <form action={testMailboxAction}>
                            <input type="hidden" name="mailboxId" value={m.id} />
                            <button className="btn btn-sm btn-ghost px-2">Check</button>
                          </form>
                          <form action={sendTestEmailAction}>
                            <input type="hidden" name="mailboxId" value={m.id} />
                            <ConfirmButton confirmLabel="Send the test" className="btn btn-sm btn-ghost px-2" message={`Send one test email from ${m.address} to itself?`}>
                              Send a test
                            </ConfirmButton>
                          </form>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {box.enabled && (
              <div className="px-5 py-3 border-t border-line flex items-center gap-3 flex-wrap">
                <p className="text-xs text-ink-muted flex-1 min-w-[16rem]">{lastSync ? `Inbox last read ${new Date(lastSync.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}: ${lastSync.replies} repl${lastSync.replies === 1 ? "y" : "ies"}, ${lastSync.bounces} bounce(s) in ${lastSync.fetched} new message(s).` : "The inbox is read every five minutes while sent emails are waiting for an answer. Only messages that answer an email sent from here are kept."}</p>
                <form action={syncMailboxAction}>
                  <input type="hidden" name="returnTo" value={settingsHref("mailbox")} />
                  <button className="btn btn-sm btn-ghost">Read the inbox now</button>
                </form>
              </div>
            )}
            <div className="px-5 py-4 border-t border-line">
              {boxes.length === 0 ? (
                <>
                  {box.reason && box.reason !== NO_WORKSPACE_MAILBOX && (
                    <div className="mb-4">
                      <Callout tone="warn" title="Not connected">
                        {box.reason}
                      </Callout>
                    </div>
                  )}
                  <MailboxForm microsoftReady={microsoftConfigured()} allowFake={cfg.mail.provider === "fake"} />
                </>
              ) : (
                <details>
                  <summary className="disclosure font-medium text-sm">Add another mailbox</summary>
                  <div className="mt-4">
                    <MailboxForm microsoftReady={microsoftConfigured()} allowFake={cfg.mail.provider === "fake"} />
                  </div>
                </details>
              )}
            </div>
          </Card>
        </div>
      )}

      {tab === "sending" && (
        <SettingsForm className="max-w-3xl" resettable>
          <Group id="sending" title="Daily limit and hours" description="“Send approved” puts emails in a queue. These limits decide when each one actually leaves." section="sending">
            <Row label="Emails per day" help={pilot.cap.warmingUp ? `Keep it low from a personal mailbox: 20 is a sensible ceiling. While the app sends on its own the limit in force is ${pilot.cap.cap} a day for now: it starts at 10 and rises by 5 each week up to your number.` : "Keep it low from a personal mailbox: 20 is a sensible ceiling."} htmlFor="dailySendCap">
              <NumberInput name="dailySendCap" value={s.dailySendCap} unit="at most" min={1} />
            </Row>
            <Row label="Pause between two emails" help="So they do not all leave at the same moment." htmlFor="sendSpacingSeconds">
              <NumberInput name="sendSpacingSeconds" value={s.sendSpacingSeconds} unit="seconds" min={20} />
            </Row>
            <Row label="Sending hours" help="Emails only leave between these two times, by the clock of the computer the app runs on." htmlFor="sendWindowStart">
              <div className="flex items-center gap-2">
                <select className="select" id="sendWindowStart" name="sendWindowStart" defaultValue={s.sendWindowStart} aria-label="Send from">
                  {HOURS.slice(0, 24).map((h) => (
                    <option key={h} value={h}>
                      {clock(h)}
                    </option>
                  ))}
                </select>
                <span className="text-sm text-ink-muted">to</span>
                <select className="select" id="sendWindowEnd" name="sendWindowEnd" defaultValue={s.sendWindowEnd} aria-label="Send until">
                  {HOURS.slice(1).map((h) => (
                    <option key={h} value={h}>
                      {clock(h)}
                    </option>
                  ))}
                </select>
              </div>
            </Row>
          </Group>

          <Group id="followups" title="When nobody answers" description="The emails that follow an unanswered first email. The sequence stops the moment they answer." section="followups">
            <Row label="Emails after the first one" help="An out-of-office reply postpones the next email by a week." htmlFor="followUpCount">
              <select className="select" id="followUpCount" name="followUpCount" defaultValue={s.followUpCount}>
                <option value={0}>None</option>
                <option value={1}>One follow-up</option>
                <option value={2}>A follow-up, then a last note</option>
              </select>
            </Row>
            <Row label="Wait before each next email" help="Counted in working days. 0 means never follow up." htmlFor="followUpDays">
              <NumberInput name="followUpDays" value={s.followUpDays} unit="working days" min={0} />
            </Row>
            <Row label="Check back after a “not now”" help="One more email is written when the time comes. 0 means never." htmlFor="recontactDays">
              <NumberInput name="recontactDays" value={s.recontactDays} unit="days" min={0} />
            </Row>
          </Group>
        </SettingsForm>
      )}

      {tab === "autopilot" && (
        <div className="space-y-5 max-w-3xl">
          {/* Where things stand, said once and first: off, waiting to start, running, or paused. */}
          {(() => {
            const state = pilot.paused ? "paused" : pilot.active ? "active" : pilot.mode !== "manual" && pilot.waitingFor ? "waiting" : "manual";
            const look = { paused: ["bg-warn-soft text-warn", "alert"], active: ["bg-ok-soft text-ok", "play"], waiting: ["bg-info-soft text-info", "clock"], manual: ["bg-surface-3 text-ink-muted", "mail"] } as const;
            const title = { paused: "Automatic sending is paused", active: "Automatic sending is active", waiting: "Automatic sending is not active yet", manual: "You send every email yourself" }[state];
            return (
              <section className="surface p-5 flex items-start gap-4">
                <span className={`w-11 h-11 rounded-xl grid place-items-center shrink-0 ${look[state][0]}`}>
                  <Icon name={look[state][1]} className="w-5 h-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold leading-6">{title}</h2>
                  <p className="text-sm text-ink-muted mt-0.5">
                    {state === "paused" && pilot.paused
                      ? pilot.paused.reason
                      : state === "active"
                        ? `${pilot.mode === "hold" ? `Each email is sent ${s.holdHours} hour${s.holdHours === 1 ? "" : "s"} after it is written, unless you edit or exclude it.` : "Each email is sent as soon as it is written."} Up to ${pilot.cap.cap} a day${pilot.cap.warmingUp ? " for now (the limit increases each week)" : ""}, within your sending hours.`
                        : state === "waiting"
                          ? pilot.waitingFor
                          : "Nothing is sent without your approval. Choose a mode below to have emails sent on your behalf."}
                  </p>
                  {state === "paused" && pilot.paused && (
                    <p className="text-xs text-ink-faint mt-1.5">Paused {new Date(pilot.paused.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Emails continue to be written, and you can still send them manually.</p>
                  )}
                </div>
                {state === "paused" && (
                  <form action={resumeAutopilotAction} className="shrink-0">
                    <ConfirmButton confirmLabel="Resume" className="btn btn-sm" message="Resume automatic sending?">
                      Resume
                    </ConfirmButton>
                  </form>
                )}
              </section>
            );
          })()}

          <SettingsForm resettable>
          <Group id="autopilot" title="Sending mode"
            description={
              <>
                <span className="group-has-[input[name=sendMode][value=hold]:checked]:hidden group-has-[input[name=sendMode][value=auto]:checked]:hidden">You send every email yourself. Nothing is sent on your behalf.</span>
                <span className="hidden group-has-[input[name=sendMode][value=hold]:checked]:inline">Checked emails are sent for you once their review period has passed.</span>
                <span className="hidden group-has-[input[name=sendMode][value=auto]:checked]:inline">Checked emails are sent for you as soon as they are written.</span>
              </>
            } section="autopilot">
            <Block>
              <div className="grid sm:grid-cols-3 gap-3">
                <ModeTile name="sendMode" value="manual" checked={s.sendMode === "manual"} icon={<Icon name="eye" className="w-[18px] h-[18px]" />} title="Manual" tag="Full control">
                  You review and send every email. Nothing is sent without your approval.
                </ModeTile>
                <ModeTile
                  name="sendMode"
                  value="hold"
                  checked={s.sendMode === "hold"}
                  icon={<Icon name="clock" className="w-[18px] h-[18px]" />}
                  title="After a review period"
                  tag="Recommended"
                  extra={
                    <span className="flex items-center gap-2 text-xs text-ink">
                      Hold for
                      <input className="input w-16 h-8 text-sm tabular-nums" id="holdHours" name="holdHours" type="number" defaultValue={s.holdHours} min={1} inputMode="numeric" aria-label="Hours an email is held before it is sent" />
                      hours
                    </span>
                  }
                >
                  Each email is held first, giving you time to read it. Editing or excluding it stops the send.
                </ModeTile>
                <ModeTile name="sendMode" value="auto" checked={s.sendMode === "auto"} icon={<Icon name="bolt" className="w-[18px] h-[18px]" />} title="Immediately" tag="Hands-off">
                  Emails are sent as soon as they are written. Only once you are confident in their quality.
                </ModeTile>
              </div>
            </Block>
          </Group>

          <Group id="autorules" title="What is sent automatically"
            className="transition-opacity group-has-[input[name=sendMode][value=manual]:checked]:opacity-55"
            description={
              <>
                <span className="group-has-[input[name=sendMode][value=manual]:checked]:hidden">Narrow automatic sending to the emails you are comfortable with. Anything left out is held for you under Outreach.</span>
                <span className="hidden group-has-[input[name=sendMode][value=manual]:checked]:inline">Not in use while the mode is Manual. These apply once an automatic mode is chosen.</span>
              </>
            } section="autorules">
            <Row end label="First emails" help="The first email to a business that has not heard from you." htmlFor="autoSendFirst">
              <Toggle name="autoSendFirst" on={s.autoSendFirst} />
            </Row>
            <Row end label="Follow-ups and check-backs" help="The emails that follow an unanswered first email, and the check-back after a “not now”." htmlFor="autoSendFollowUps">
              <Toggle name="autoSendFollowUps" on={s.autoSendFollowUps} />
            </Row>
            <Row label="Minimum score" help="Only businesses scoring at least this are emailed automatically. Lower-scoring ones are held for your review." htmlFor="autoSendMinScore">
              <NumberInput name="autoSendMinScore" value={s.autoSendMinScore} unit="out of 100" min={0} max={100} />
            </Row>
            <Row end label="Weekdays only" help="Nothing is sent automatically on Saturday or Sunday. Emails that are ready go out on Monday." htmlFor="autoSendWeekdaysOnly">
              <Toggle name="autoSendWeekdaysOnly" on={s.autoSendWeekdaysOnly} />
            </Row>
          </Group>

          <Group id="answers" title="Replies" description="Every reply is read and sorted. Choose what happens to each kind." section="answers">
            {(
              [
                ["wants_meeting", "They ask for a call", s.bookingLink ? "The answer offers your booking link." : "The answer offers a time. Add a booking link under Your details and it is offered instead.", "Offer Tuesday or Thursday afternoon, 20 minutes."],
                ["not_now", "They say “not now”", "The answer is a short thank-you. A check-back is planned for later.", "Ask which month would suit them better."],
                ["interested", "They say yes", "The answer picks up what you offered. Only you know when it will be ready.", "Say the mock-up arrives within three working days."],
                ["wants_info", "They ask a question", "The answer replies to the question. Prices, dates and past work are yours to state.", "Projects start at 1,500. Never promise a delivery date."],
                ["wrong_person", "They point to someone else", "The answer thanks them. Writing to the other person is your decision.", "Ask if you may mention their name when you write."],
              ] as const
            ).map(([kind, when, what, example]) => (
              <div key={kind} className="px-5 py-4">
                <div className="grid sm:grid-cols-[minmax(0,1fr)_13.5rem] gap-x-6 gap-y-2.5 sm:items-center">
                  <div className="min-w-0">
                    <label htmlFor={`replyAction_${kind}`} className="block text-sm font-medium text-ink">
                      {when}
                    </label>
                    <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{what}</p>
                  </div>
                  <select className="select" id={`replyAction_${kind}`} name={`replyAction_${kind}`} defaultValue={replyRules[kind].action}>
                    <option value="send">Send automatically</option>
                    <option value="review">Draft for my review</option>
                    <option value="none">No reply</option>
                  </select>
                </div>
                <details className="mt-2.5" open={Boolean(replyRules[kind].note)}>
                  <summary className="disclosure text-xs text-ink-muted">Your own instructions for this answer</summary>
                  <input className="input mt-2" name={`replyNote_${kind}`} defaultValue={replyRules[kind].note} maxLength={400} placeholder={`For example: ${example}`} aria-label={`Your instructions for the answer when ${when.toLowerCase()}`} />
                </details>
              </div>
            ))}
            <Row label="Out of office" help="No answer is written. The next email to them waits this long." htmlFor="outOfOfficeDays">
              <NumberInput name="outOfOfficeDays" value={s.outOfOfficeDays} unit="days" min={1} max={30} />
            </Row>
            <div className="px-5 py-4 grid sm:grid-cols-[minmax(0,1fr)_13.5rem] gap-x-6 gap-y-2.5 sm:items-center">
              <div className="min-w-0">
                <div className="text-sm font-medium">They ask you to stop</div>
                <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">No answer. They are added to Do not contact and never emailed again. This cannot be changed.</p>
              </div>
              <div>
                <Badge tone="info">Always</Badge>
              </div>
            </div>
            <Block>
              <p className="text-xs text-ink-muted leading-relaxed">Even when set to “Send automatically”, an answer waits for your review when the reply was not clearly understood, or after two automatic answers in the same conversation.</p>
            </Block>
          </Group>
          </SettingsForm>
        </div>
      )}

      {tab === "automation" && (
        <SettingsForm className="max-w-3xl" resettable>
          <Group id="automation" title="Find new businesses" description="When few businesses are left to research, the app starts a search by itself." section="automation" aside={<Toggle name="autoSearch" on={s.autoSearch} label="Find new businesses on its own" />}>
            <Block>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Who to look for</div>
                  {autoTargets.length ? (
                    <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                      <strong className="text-ink">{[...new Set(autoTargets.map((t) => t.what))].join(", ")}</strong> in{" "}
                      <strong className="text-ink">{[...new Set(autoTargets.map((t) => (t.region ? `${regionName(t.country, t.region)} (${countryName(t.country)})` : countryName(t.country))))].join(", ")}</strong>. Each kind is searched city by city, largest first, and never the same city twice.
                    </p>
                  ) : (
                    <p className="text-xs text-warn mt-0.5 leading-relaxed">Nothing yet. Say who you sell to and where under Your details, and the searches are made from it.</p>
                  )}
                </div>
                <Link href="/settings?tab=sender&step=audience" className="btn btn-sm shrink-0">
                  {autoTargets.length ? "Change" : "Set it up"}
                </Link>
              </div>
            </Block>
            <Row label="Searches per day" help={`Each search reads ${AUTO_SEARCH_RESULTS} listings and uses ${AUTO_SEARCH_CREDITS} search credits.`} htmlFor="searchesPerDay">
              <NumberInput name="searchesPerDay" value={s.searchesPerDay} unit="at most" min={0} />
            </Row>
          </Group>

          <Group id="research" title="Research saved businesses" description="Reads the website of each saved business and judges whether it is a fit, best leads first." section="research" aside={<Toggle name="autoResearch" on={s.autoResearch} label="Research saved businesses on its own" />}>
            <Row label="Businesses researched per day" htmlFor="researchPerDay">
              <NumberInput name="researchPerDay" value={s.researchPerDay} unit="at most" min={0} />
            </Row>
            <Row label="Pause while emails wait for you" help="Research stops while this many written emails are waiting for your review, so work does not pile up." htmlFor="readyBuffer">
              <NumberInput name="readyBuffer" value={s.readyBuffer} unit="emails" min={0} />
            </Row>
          </Group>

          <Group id="drafting" title="Write emails" description="What happens once research says a business is a fit." section="drafting">
            <Row end label="Write the email as soon as a business qualifies" help="It lands under Outreach. Whether it then waits for you or goes out is decided under Automatic sending." htmlFor="autoDraft">
              <Toggle name="autoDraft" on={s.autoDraft} />
            </Row>
          </Group>
        </SettingsForm>
      )}

      {tab === "usage" && (
        <div className="space-y-5 max-w-3xl">
          <Card title={`Your plan: ${myUsage.plan.label}`} description={myUsage.plan.limits.research === null ? "This account has no monthly limits." : `What this account can do each month. The count starts again on ${myUsage.resetsOn}.`}>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-5">
              {(
                [
                  { label: "Businesses researched", u: myUsage.research },
                  { label: "Searches run", u: myUsage.searches },
                ] as const
              ).map(({ label, u }) => {
                const pct = u.limit ? Math.min(100, (u.used / u.limit) * 100) : 0;
                const full = u.limit !== null && u.used >= u.limit;
                return (
                  <div key={label}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="label">{label}</span>
                      <span className="text-sm tabular-nums">
                        <strong>{u.used}</strong>
                        <span className="text-ink-muted">{u.limit === null ? " this month" : ` of ${u.limit}`}</span>
                      </span>
                    </div>
                    {u.limit !== null && (
                      <div className="h-2 rounded-full bg-surface-3 overflow-hidden mt-1.5" role="img" aria-label={`${u.used} of ${u.limit} used`}>
                        <div className={`h-full rounded-full ${full ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-[var(--accent)]"}`} style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    {full && <p className="text-xs text-bad mt-1.5">All used. More can be started from {myUsage.resetsOn}.</p>}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-ink-muted mt-5">
              {myUsage.emails} email{myUsage.emails === 1 ? "" : "s"} written this month. Writing, reviewing and sending emails is not counted against the plan.
            </p>
          </Card>

          {platform && accounts.length > 0 && (
            <Card title="Accounts" description="Every account, what it used this month and what that cost you. A plan is researched businesses / searches per month; changing it takes effect at once." padded={false}>
              <div>
                <table className="table table-fixed w-full text-sm">
                  <colgroup>
                    <col />
                    <col className="w-[13.5rem]" />
                    <col className="w-[6rem]" />
                    <col className="w-[5.5rem]" />
                    <col className="w-[8.5rem]" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Plan</th>
                      <th className="text-right">Researched</th>
                      <th className="text-right">Searches</th>
                      <th className="text-right">Cost to you</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((a) => (
                      <tr key={a.id}>
                        <td className="min-w-0">
                          <div className="font-medium truncate" title={a.owner ?? a.name}>{a.owner ?? a.name ?? "No owner"}</div>
                          {a.id === FIRST_WORKSPACE_ID && <div className="text-xs text-ink-muted">This account</div>}
                        </td>
                        <td>
                          {a.id === FIRST_WORKSPACE_ID ? (
                            <span className="text-ink-muted">{a.plan.label}</span>
                          ) : (
                            <form action={setWorkspacePlanAction} className="flex items-center gap-1.5">
                              <input type="hidden" name="workspaceId" value={a.id} />
                              <select name="plan" defaultValue={a.plan.key} className="select h-8 w-auto text-sm" aria-label={`Plan of ${a.owner ?? a.name}`}>
                                {Object.values(PLANS)
                                  .filter((p) => p.key !== "owner")
                                  .map((p) => (
                                    <option key={p.key} value={p.key}>
                                      {p.label}: {p.limits.research} / {p.limits.searches}
                                    </option>
                                  ))}
                              </select>
                              <button className="btn btn-sm">Save</button>
                            </form>
                          )}
                        </td>
                        <td className="text-right tabular-nums">{a.research.used}{a.research.limit !== null && <span className="text-ink-faint"> / {a.research.limit}</span>}</td>
                        <td className="text-right tabular-nums">{a.searches.used}{a.searches.limit !== null && <span className="text-ink-faint"> / {a.searches.limit}</span>}</td>
                        <td className="text-right tabular-nums whitespace-nowrap" title={`AI $${a.cost.aiUsd.toFixed(2)} · ${a.cost.pageCredits} website pages · ${a.cost.searchCredits} search credits · ${a.emails} emails written`}>
                          <div>${a.cost.aiUsd.toFixed(2)} AI</div>
                          <div className="text-xs text-ink-muted">
                            {a.cost.pageCredits} pages · {a.cost.searchCredits} credits
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {platform && (
          <Card id="usage" title="What the product spends this month" description="Your own provider budgets, over every account together. They reset on the first of the month.">
            <form action={saveSettingsAction} className="flex flex-wrap items-end gap-3 pb-5 mb-5 border-b border-line">
              <input type="hidden" name="section" value="budget" />
              <div className="flex-1 min-w-[14rem]">
                <Field label="AI budget per month (USD)" name="monthlyAiBudgetUsd" type="number" value={s.monthlyAiBudgetUsd ?? ""} placeholder={`${cfg.AI_SPEND_LIMIT_USD} (from .env)`} hint="Research and writing stop for the month when this is reached." />
              </div>
              <button className="btn btn-primary">Save</button>
            </form>
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
          )}
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
              <EmptyLine>Nobody is on the list.</EmptyLine>
            ) : (
              <ul className="divide-y divide-line">
                {suppressions.slice((dncPage - 1) * DNC_PER_PAGE, dncPage * DNC_PER_PAGE).map((x) => (
                  <li key={x.id} className="px-5 py-2.5 flex items-center gap-3 text-sm">
                    <span className="font-medium min-w-0 truncate">{x.value}</span>
                    <Badge tone={x.reason === "bounced" ? "bad" : x.reason === "unsubscribed" ? "warn" : "neutral"}>{x.reason === "unsubscribed" ? "asked to stop" : x.reason}</Badge>
                    <span className="text-xs text-ink-faint truncate flex-1">{x.note}</span>
                    <span className="text-xs text-ink-faint shrink-0">{new Date(x.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                    <form action={removeSuppressionAction}>
                      <input type="hidden" name="id" value={x.id} />
                      <input type="hidden" name="dp" value={dncPage} />
                      <ConfirmButton confirmLabel="Remove" danger className="btn btn-ghost btn-sm text-ink-faint" message={`Remove ${x.value} from the do-not-contact list? It could then be emailed again.`}>
                        <Icon name="x" />
                      </ConfirmButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <Pager page={dncPage} perPage={DNC_PER_PAGE} total={suppressions.length} hrefFor={(p) => `/settings?tab=do-not-contact${p > 1 ? `&dp=${p}` : ""}`} label={suppressions.length === 1 ? "entry" : "entries"} />
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
              <EmptyLine>Nothing has been removed. Use the remove button on a row of the Businesses table, or “Remove” on a business page.</EmptyLine>
            ) : removedShown.length === 0 ? (
              <EmptyLine>No removed business matches “{removedQuery}”.</EmptyLine>
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
                <Pager page={removedPage} perPage={REMOVED_PER_PAGE} total={removedShown.length} hrefFor={removedHref} label={removedShown.length === 1 ? "business" : "businesses"} />
              </>
            )}
          </Card>
        </div>
      )}

      {tab === "system" && platform && (
        <div className="space-y-5 max-w-3xl">
          <Group id="connections" title="Connections" description="The services the app works with. Only you see this page: your customers never do.">
            {(
              [
                ["Finding businesses", integ.googleMaps],
                ["Reading websites", integ.websiteResearch],
                ["AI for research and writing", integ.ai],
                ["Finding a missing website", integ.webSearch],
                ["Database", integ.storage],
              ] as const
            ).map(([what, i]) => (
              <div key={what} className="px-5 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{what}</div>
                    <div className="text-xs text-ink-muted">{i.label}</div>
                  </div>
                  <Badge tone={tone(i.status)} dot className="shrink-0">
                    {i.status === "live" ? "Working" : i.status === "missing_credentials" ? "Needs a key" : "Off"}
                  </Badge>
                </div>
                <details className="mt-1.5">
                  <summary className="disclosure text-xs text-ink-faint">Details</summary>
                  <p className="text-xs text-ink-muted mt-1.5 leading-relaxed">{i.detail}</p>
                </details>
              </div>
            ))}
          </Group>

          <Group title="Background work" description="What runs behind the pages: searches, research, writing and sending.">
            <Block>
              <KeyValue
                rows={[
                  { k: "Worker", v: worker.running ? <Badge tone="ok" dot>running · {worker.active} active</Badge> : <Badge tone="warn" dot>not running in this process</Badge> },
                  { k: "Pages read per business", v: `up to ${cfg.RESEARCH_MAX_PAGES}` },
                  { k: "Research without a public email", v: cfg.RESEARCH_REQUIRE_EMAIL ? "stops after 2 pages" : "continues" },
                  { k: "Database", v: <code className="text-xs">{cfg.TURSO_DATABASE_URL ? "hosted" : cfg.DATABASE_PATH}</code> },
                ]}
              />
              <Link href="/system" className="btn btn-sm mt-4">
                <Icon name="bolt" /> Jobs and health
              </Link>
            </Block>
          </Group>
        </div>
      )}
        </div>
      </div>
    </>
  );
}
