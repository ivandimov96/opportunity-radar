import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { Pager, clampPage } from "@/components/table";
import { ConfirmButton } from "@/components/confirm-button";
import { Badge, Callout, Card, EmptyState, Flash, Icon, PageHeader, ScoreRing, StatusPill, Tabs, fmtRelative } from "@/components/ui";
import { getConfig } from "@/lib/config";
import { mailboxFor } from "@/lib/mail";
import { outreachOverview, OUTREACH_TABS, type OutreachTab } from "@/lib/outreach/queries";
import { openingLine } from "@/lib/outreach/validate";
import { autopilotStatus, releaseTime } from "@/lib/outreach/autopilot";
import { STEP, stepLabel } from "@/lib/outreach/steps";
import { automaticSendHold } from "@/lib/outreach/eligibility";
import { getSettings, missingSenderDetails } from "@/lib/settings";
import { settingsHref } from "@/lib/settings-nav";
import { verdictLabel } from "@/lib/pipeline/stages";
import { approveAllReadyAction, cancelQueuedAction, draftStatusAction, markDraftSentAction, retryFailedAction, setBusinessEmailAction, syncMailboxAction } from "@/app/actions";

export const metadata = { title: "Outreach" };

/** The colour of each kind of email in the list. */
const STEP_TONE: Record<number, "neutral" | "info" | "warn" | "accent" | "ok"> = { 0: "neutral", 1: "info", 2: "warn", 3: "accent", 9: "ok" };

/** Emails (and businesses without an address) on one page. */
const PER_PAGE = 25;

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ tab?: string; page?: string; upage?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const cfg = getConfig();
  // The mailbox as this workspace has it (only the first workspace has one for now).
  const box = await mailboxFor();
  const [o, settings] = await Promise.all([outreachOverview(), getSettings()]);
  const c = o.counts;
  const pilot = await autopilotStatus(settings);
  /** When a ready email of the open batch leaves on its own, or null when it waits for the operator. */
  const goesOutAt = (d: { status: string; step: number; updatedAt: string; campaignId: string | null }) => (pilot.active && d.status === "ready" && d.campaignId === o.campaign.id && (d.step !== STEP.answer || settings.autoAnswer) ? releaseTime(d.updatedAt, settings) : null);
  const requested = OUTREACH_TABS.some((t) => t.key === sp.tab) ? (sp.tab as OutreachTab) : null;
  const tab: OutreachTab = requested ?? (c.ready + c.approved > 0 ? "ready" : c.review > 0 ? "review" : c.inFlight + c.sent + c.failed > 0 ? "sent" : "ready");
  const all = o.byTab[tab];
  // Each list in pages; an action on a row comes back to the page it was on.
  const page = clampPage(sp.page, all.length, PER_PAGE);
  const rows = all.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const upage = clampPage(sp.upage, o.unreachable.length, PER_PAGE);
  const unreachable = o.unreachable.slice((upage - 1) * PER_PAGE, upage * PER_PAGE);
  const pageHref = (patch: { page?: number; upage?: number }) => {
    const next = { page, upage, ...patch };
    return `/outreach?tab=${tab}${next.page > 1 ? `&page=${next.page}` : ""}${next.upage > 1 ? `&upage=${next.upage}` : ""}`;
  };
  // Ready emails the autopilot leaves to the operator (a UK business that does not show it is a company), with the reason.
  const held = new Map<string, string>();
  if (pilot.active && tab === "ready") for (const r of rows) if (r.draft.status === "ready" && r.draft.step !== STEP.answer) { const why = await automaticSendHold(r.business); if (why) held.set(r.draft.id, why); }
  const here = pageHref({});
  const missing = missingSenderDetails(settings);
  const tabCount: Record<OutreachTab, number> = { ready: c.ready + c.approved, review: c.review, blocked: c.blocked, excluded: c.excluded, sent: o.byTab.sent.length };
  /** When the most recent email of the Sent list went out. */
  const lastSent = o.byTab.sent.map((r) => r.draft.sentAt).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
  const StatusForm = ({ id, op, children, className = "btn btn-sm" }: { id: string; op: string; children: React.ReactNode; className?: string }) => (
    <form action={draftStatusAction}>
      <input type="hidden" name="draftId" value={id} />
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="returnTo" value={here} />
      <button className={className}>{children}</button>
    </form>
  );

  return (
    <>
      <PageHeader
        title="Outreach"
        subtitle={[c.pendingWrite ? `${c.pendingWrite} being written` : null, c.inFlight ? `${c.inFlight} queued to send` : null, c.failed ? `${c.failed} not sent` : null].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <AutoRefresh active={c.inFlight > 0 || c.pendingWrite > 0} intervalMs={4000} label={c.inFlight > 0 ? `Sending (${c.inFlight} to go)` : "Writing emails"} />
            {c.ready > 0 && (
              <form action={approveAllReadyAction}>
                <input type="hidden" name="campaignId" value={o.campaign.id} />
                <ConfirmButton confirmLabel="Approve all" className="btn" message={`Approve all ${c.ready} email(s) that passed their checks without opening them?`}>
                  <Icon name="check" /> Approve ready <span className="btn-count">{c.ready}</span>
                </ConfirmButton>
              </form>
            )}
            {c.approved > 0 ? (
              <Link href="/outreach/send" className="btn btn-primary">
                <Icon name="mail" /> Send approved <span className="btn-count">{c.approved}</span>
              </Link>
            ) : null}
          </>
        }
      />
      <Flash msg={sp.ok} />
      <Flash msg={sp.error} tone="bad" />

      {(!box.enabled || missing.length > 0 || !cfg.ai.enabled) && (
        <div className="mb-5 space-y-3">
          {!cfg.ai.enabled && (
            <Callout tone="warn" title="Emails cannot be written yet">
              Writing emails needs a model key (ANTHROPIC_API_KEY in <code>.env</code>). Research and review work without it.
            </Callout>
          )}
          {!box.enabled && (
            <Callout tone="info" title="No mailbox is connected, so nothing can be sent from here yet" action={<Link href={settingsHref("mailbox")} className="btn btn-sm">Connect a mailbox</Link>}>
              {box.reason} You can still review and approve emails, or copy one and send it yourself.
            </Callout>
          )}
          {missing.length > 0 && (
            <Callout tone="warn" title="Your sender details are incomplete" action={<Link href={settingsHref("sender")} className="btn btn-sm">Fill them in</Link>}>
              Every email ends with who you are and where you are. Still missing: {missing.join(", ")}.
            </Callout>
          )}
        </div>
      )}

      {pilot.mode !== "manual" && (
        <div className="mb-5">
          {pilot.paused ? (
            <Callout tone="warn" title="Sending on its own is paused" action={<Link href={settingsHref("autopilot")} className="btn btn-sm">Open the setting</Link>}>
              {pilot.paused.reason} You can still approve and send by hand.
            </Callout>
          ) : pilot.active ? (
            <Callout tone="ok" title="The app is sending on its own" action={<Link href={settingsHref("autopilot")} className="btn btn-sm">Change</Link>}>
              {settings.sendMode === "hold" ? `An email under Ready goes out ${settings.holdHours} hour${settings.holdHours === 1 ? "" : "s"} after it was written or last edited. Exclude it and it stays.` : "An email under Ready goes out at the next run, within a minute or two."} Emails under Needs review always wait for you. At most {pilot.cap.cap} a day{pilot.cap.warmingUp ? " for now" : ""}.
            </Callout>
          ) : (
            <Callout tone="info" title="Sending on its own is chosen, but not active yet" action={<Link href={settingsHref("autopilot")} className="btn btn-sm">Open the setting</Link>}>
              {pilot.waitingFor}
            </Callout>
          )}
        </div>
      )}

      <Tabs items={OUTREACH_TABS.map((t) => ({ href: `/outreach?tab=${t.key}`, label: t.label, count: tabCount[t.key], active: tab === t.key }))} />

      <Card padded={false}>
        {/* What this list is, how many, and what can be done with all of it. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 border-b border-line">
          <h2 className="text-base font-semibold leading-6">
            {all.length} {all.length === 1 ? "email" : "emails"}
          </h2>
          <span className="text-sm text-ink-muted flex-1 min-w-[12rem]">
            {tab === "ready"
              ? pilot.active
                ? "Written and checked. Each one goes out at the time shown unless you exclude it; approving sends it now."
                : "Written and checked. Read each one, then approve it."
              : tab === "review"
                ? "A check found something. Open the email to see what and fix it."
                : tab === "blocked"
                  ? "Qualified, but there is no address that may be used."
                  : tab === "excluded"
                    ? "Left out by you. They are not sent."
                    : lastSent
                      ? `The last one went out ${fmtRelative(lastSent)}. Replies appear on the Dashboard as they arrive.`
                      : "Replies appear on the Dashboard as they arrive."}
          </span>
          {tab === "sent" && (
            <div className="flex flex-wrap items-center gap-2">
              {box.enabled && (
                <form action={syncMailboxAction}>
                  <input type="hidden" name="returnTo" value={here} />
                  <button className="btn btn-sm">
                    <Icon name="refresh" /> Check the inbox for replies
                  </button>
                </form>
              )}
              {c.inFlight > 0 &&
                [...new Set(o.byTab.sent.filter((r) => r.draft.status === "queued").map((r) => r.draft.campaignId))].filter(Boolean).map((id) => (
                  <form key={id} action={cancelQueuedAction}>
                    <input type="hidden" name="campaignId" value={id!} />
                    <ConfirmButton confirmLabel="Stop sending" danger className="btn btn-sm btn-danger" message="Stop the emails that have not gone out yet? They return to Ready, still approved. Emails already sent stay sent.">
                      <Icon name="x" /> Stop sending
                    </ConfirmButton>
                  </form>
                ))}
            </div>
          )}
        </div>
        {all.length === 0 && !(tab === "blocked" && o.unreachable.length) ? (
          <EmptyState
            icon="mail"
            title={tab === "ready" ? (c.pendingWrite ? "Emails are being written" : "No emails are waiting") : tab === "review" ? "Nothing needs review" : tab === "blocked" ? "Every qualified business has a usable address" : tab === "excluded" ? "Nothing is excluded" : "Nothing has been sent yet"}
            description={tab === "ready" ? "Qualified businesses with a public email get their email written automatically. Find and research more businesses to fill this list." : undefined}
            action={tab === "ready" ? <Link href="/searches/new" className="btn btn-primary btn-sm">Find businesses</Link> : undefined}
          />
        ) : (
          <div className="overflow-hidden">
            {/* The table always fits its card: fixed column shares, long values cut with "…" (the full value is in the tooltip). */}
            <table className="table md:table-fixed">
              <colgroup className="hidden md:table-column-group">
                <col className="md:w-[17%]" />
                <col className="md:w-[7rem]" />
                <col className="hidden 2xl:table-column 2xl:w-[16%]" />
                <col />
                <col className="md:w-[4.5rem]" />
                <col className="md:w-[9.25rem]" />
                <col className="md:w-[12rem]" />
              </colgroup>
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Email</th>
                  <th className="hidden 2xl:table-cell">To</th>
                  <th>Subject</th>
                  <th>Score</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ draft: d, business: b }) => {
                  // What holds an email back: a failed check, or (for an answer) the reason only the operator can give it.
                  const blocks = (d.validation?.issues ?? []).filter((i) => i.severity === "block" || i.code === "needs_you");
                  const to = d.step === STEP.answer ? d.toEmail : b.email;
                  const release = held.has(d.id) ? null : goesOutAt(d);
                  // Under the subject: why it is held back (when it is), otherwise how the email begins.
                  const detail = (tab === "review" || tab === "blocked" ? blocks.map((i) => i.message).join(" ") || d.lastError : d.status === "failed" || d.status === "bounced" ? d.lastError : openingLine(d.body)) ?? "";
                  return (
                    <tr key={d.id} data-draft={d.id} data-status={d.status}>
                      <td className="overflow-hidden">
                        <Link href={`/outreach/${d.id}`} className="row-link truncate block" title={b.name}>
                          {b.name}
                        </Link>
                        <div className="text-xs text-ink-faint truncate">{[b.city, b.region].filter(Boolean).join(", ")}</div>
                      </td>
                      <td className="overflow-hidden">
                        <Badge tone={STEP_TONE[d.step] ?? "neutral"}>{stepLabel(d.step)}</Badge>
                      </td>
                      <td className="hidden 2xl:table-cell text-sm overflow-hidden">{to ? <span className="truncate block" title={to}>{to}</span> : <span className="text-warn">No address</span>}</td>
                      <td className="overflow-hidden">
                        <div className="text-sm font-medium truncate" title={`${d.subject ?? ""}${to ? ` · to ${to}` : ""}`}>
                          {d.step > 0 ? "Re: " : ""}
                          {d.subject}
                        </div>
                        <div className={`text-xs truncate ${tab === "review" || tab === "blocked" || d.status === "failed" || d.status === "bounced" ? "text-warn" : "text-ink-muted"}`} title={detail || undefined}>
                          {detail}
                        </div>
                      </td>
                      <td>{b.priority != null ? <ScoreRing value={b.priority} size={34} /> : <span className="text-xs text-ink-faint">—</span>}</td>
                      <td className="whitespace-nowrap">
                        <StatusPill status={d.status} label={d.status === "queued" ? "Queued" : d.status === "failed" ? "Not sent" : d.status === "ready" ? "Ready" : undefined} />
                        {d.status === "queued" && <div className="text-xs text-ink-faint mt-0.5">{when(d.scheduledAt)}</div>}
                        {d.validation?.overridden && <div className="text-xs text-warn mt-0.5" title="Approved although a check had failed">check overridden</div>}
                        {held.has(d.id) && <div className="text-xs text-warn mt-0.5" title={held.get(d.id)}>waits for you</div>}
                        {release && <div className="text-xs text-ink-muted mt-0.5">{release.getTime() <= Date.now() ? "goes out next" : `goes out ${when(release.toISOString())}`}</div>}
                        {d.approvedBy === "autopilot" && d.status !== "ready" && <div className="text-xs text-ink-faint mt-0.5">by autopilot</div>}
                        {d.status === "sent" && <div className="text-xs text-ink-faint mt-0.5">{when(d.sentAt)}</div>}
                      </td>
                      <td className="!pl-0">
                        <div className="flex items-center justify-end gap-1.5">
                          {d.status === "ready" && <StatusForm id={d.id} op="approve" className="btn btn-sm btn-primary">Approve</StatusForm>}
                          {d.status === "approved" && <StatusForm id={d.id} op="unapprove" className="btn btn-sm btn-ghost">Undo</StatusForm>}
                          {d.status === "excluded" && <StatusForm id={d.id} op="restore">Put back</StatusForm>}
                          {d.status === "failed" && (
                            <>
                              <form action={retryFailedAction}>
                                <input type="hidden" name="draftId" value={d.id} />
                                <input type="hidden" name="returnTo" value={here} />
                                <button className="btn btn-sm">Retry</button>
                              </form>
                              <form action={markDraftSentAction}>
                                <input type="hidden" name="draftId" value={d.id} />
                                <input type="hidden" name="returnTo" value={here} />
                                <ConfirmButton confirmLabel="Record as sent" className="btn btn-sm btn-ghost" message="Record this email as sent? Do this only if you see it in your Sent folder.">It was sent</ConfirmButton>
                              </form>
                            </>
                          )}
                          <Link href={`/outreach/${d.id}`} className="btn btn-sm">
                            {["ready", "approved", "needs_review"].includes(d.status) ? "Review" : "Open"}
                          </Link>
                          {/* Taking a row out is always the last thing on the right, as in every table; rows that cannot be taken out keep the space, so the buttons line up. */}
                          {d.status === "ready" || d.status === "approved" || d.status === "needs_review" ? (
                            <StatusForm id={d.id} op="exclude" className="btn btn-ghost btn-sm text-ink-faint hover:text-bad">
                              <span className="sr-only">Exclude</span>
                              <Icon name="x" />
                            </StatusForm>
                          ) : (
                            <span className="w-9 shrink-0" aria-hidden />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager page={page} perPage={PER_PAGE} total={all.length} hrefFor={(p) => pageHref({ page: p })} label="emails" />
          </div>
        )}
      </Card>

      {tab === "blocked" && o.unreachable.length > 0 && (
        <Card className="mt-5" title="No address on record" description="Research found no public email for these businesses, so nothing was written. Add an address you have (a business card, a reply, a referral) and the work continues." padded={false}>
          <ul className="divide-y divide-line">
            {unreachable.map((b) => (
              <li key={b.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-[200px] flex-1">
                  <Link href={`/businesses/${b.id}`} className="font-medium text-sm">
                    {b.name}
                  </Link>
                  <div className="text-xs text-ink-faint">
                    {[b.city, b.region].filter(Boolean).join(", ")} · {verdictLabel(b.verdict)}
                    {b.investigatedAt ? ` · researched ${fmtRelative(b.investigatedAt)}` : ""}
                  </div>
                </div>
                <form action={setBusinessEmailAction} className="flex items-center gap-2">
                  <input type="hidden" name="businessId" value={b.id} />
                  <input type="hidden" name="returnTo" value={here} />
                  <input className="input w-60" type="email" name="email" placeholder="name@their-domain.com" required aria-label={`Email for ${b.name}`} />
                  <button className="btn btn-sm">Add email</button>
                </form>
              </li>
            ))}
          </ul>
          <Pager page={upage} perPage={PER_PAGE} total={o.unreachable.length} hrefFor={(p) => pageHref({ upage: p })} label="businesses" />
        </Card>
      )}
      {tab === "ready" && c.approved > 0 && (
        <p className="text-xs text-ink-faint mt-3">
          <Badge tone="ok">Approved</Badge> emails go out when you press <strong>Send approved</strong>: one at a time, at most {settings.dailySendCap} a day, between {settings.sendWindowStart}:00 and {settings.sendWindowEnd}:00.
        </p>
      )}
    </>
  );
}
