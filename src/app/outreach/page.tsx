import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { ConfirmButton } from "@/components/confirm-button";
import { Badge, Callout, Card, EmptyState, Flash, Icon, PageHeader, ScoreRing, StatusPill, Tabs, fmtRelative } from "@/components/ui";
import { getConfig } from "@/lib/config";
import { campaignHistory, outreachOverview, OUTREACH_TABS, type OutreachTab } from "@/lib/outreach/queries";
import { openingLine } from "@/lib/outreach/validate";
import { getSettings, missingSenderDetails } from "@/lib/settings";
import { settingsHref } from "@/lib/settings-nav";
import { verdictLabel } from "@/lib/pipeline/stages";
import { approveAllReadyAction, cancelQueuedAction, draftStatusAction, markDraftSentAction, retryFailedAction, setBusinessEmailAction, syncMailboxAction } from "@/app/actions";

export const metadata = { title: "Outreach" };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ tab?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const cfg = getConfig();
  const [o, settings, history] = await Promise.all([outreachOverview(), getSettings(), campaignHistory(8)]);
  const c = o.counts;
  const requested = OUTREACH_TABS.some((t) => t.key === sp.tab) ? (sp.tab as OutreachTab) : null;
  const tab: OutreachTab = requested ?? (c.ready + c.approved > 0 ? "ready" : c.review > 0 ? "review" : c.inFlight + c.sent + c.failed > 0 ? "sent" : "ready");
  const rows = o.byTab[tab];
  const here = `/outreach?tab=${tab}`;
  const missing = missingSenderDetails(settings);
  const tabCount: Record<OutreachTab, number> = { ready: c.ready + c.approved, review: c.review, blocked: c.blocked, excluded: c.excluded, sent: o.byTab.sent.length };
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
        subtitle={[`${c.ready} to review`, `${c.approved} approved`, c.pendingWrite ? `${c.pendingWrite} being written` : null, c.inFlight ? `${c.inFlight} queued to send` : null, c.failed ? `${c.failed} not sent` : null, c.bounced ? `${c.bounced} bounced` : null].filter(Boolean).join(" · ")}
        actions={
          <>
            <AutoRefresh active={c.inFlight > 0 || c.pendingWrite > 0} intervalMs={4000} label={c.inFlight > 0 ? `Sending (${c.inFlight} to go)` : "Writing emails"} />
            {c.ready > 0 && (
              <form action={approveAllReadyAction}>
                <input type="hidden" name="campaignId" value={o.campaign.id} />
                <ConfirmButton confirmLabel="Approve all" className="btn" message={`Approve all ${c.ready} email(s) that passed their checks without opening them?`}>
                  <Icon name="check" /> Approve all ready ({c.ready})
                </ConfirmButton>
              </form>
            )}
            {c.approved > 0 ? (
              <Link href="/outreach/send" className="btn btn-primary btn-lg">
                <Icon name="mail" /> Send approved emails ({c.approved})
              </Link>
            ) : (
              <span className="btn btn-primary btn-lg" aria-disabled="true" title="Approve at least one email first">
                <Icon name="mail" /> Send approved emails (0)
              </span>
            )}
          </>
        }
      />
      <Flash msg={sp.ok} />
      <Flash msg={sp.error} tone="bad" />

      {(!cfg.mail.enabled || missing.length > 0 || !cfg.ai.enabled) && (
        <div className="mb-5 space-y-3">
          {!cfg.ai.enabled && (
            <Callout tone="warn" title="Emails cannot be written yet">
              Writing emails needs a model key (ANTHROPIC_API_KEY in <code>.env</code>). Research and review work without it.
            </Callout>
          )}
          {!cfg.mail.enabled && (
            <Callout tone="info" title="No mailbox is connected, so nothing can be sent from here yet" action={<Link href={settingsHref("mailbox")} className="btn btn-sm">Connect a mailbox</Link>}>
              {cfg.mail.reason} You can still review and approve emails, or copy one and send it yourself.
            </Callout>
          )}
          {missing.length > 0 && (
            <Callout tone="warn" title="Your sender details are incomplete" action={<Link href={settingsHref("sender")} className="btn btn-sm">Fill them in</Link>}>
              Every email ends with who you are and where you are. Still missing: {missing.join(", ")}.
            </Callout>
          )}
        </div>
      )}

      <Tabs items={OUTREACH_TABS.map((t) => ({ href: `/outreach?tab=${t.key}`, label: t.label, count: tabCount[t.key], active: tab === t.key }))} />

      {tab === "sent" && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {cfg.mail.enabled && (
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
          <span className="text-xs text-ink-faint">
            {history.length > 0 && `Batches: ${history.slice(0, 4).map((h) => `${h.name} (${h.counts.sent ?? 0} sent${h.counts.bounced ? `, ${h.counts.bounced} bounced` : ""}${h.counts.queued ? `, ${h.counts.queued} queued` : ""})`).join(" · ")}`}
          </span>
        </div>
      )}

      <Card padded={false}>
        {rows.length === 0 && !(tab === "blocked" && o.unreachable.length) ? (
          <EmptyState
            icon="mail"
            title={tab === "ready" ? (c.pendingWrite ? "Emails are being written" : "No emails are waiting") : tab === "review" ? "Nothing needs review" : tab === "blocked" ? "Every qualified business has a usable address" : tab === "excluded" ? "Nothing is excluded" : "Nothing has been sent yet"}
            description={tab === "ready" ? "Qualified businesses with a public email get their email written automatically. Find and research more businesses to fill this list." : undefined}
            action={tab === "ready" ? <Link href="/searches/new" className="btn btn-primary btn-sm">Find businesses</Link> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>To</th>
                  <th>Email</th>
                  <th>Score</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ draft: d, business: b }) => {
                  const blocks = (d.validation?.issues ?? []).filter((i) => i.severity === "block");
                  return (
                    <tr key={d.id} data-draft={d.id} data-status={d.status}>
                      <td className="max-w-[220px]">
                        <Link href={`/outreach/${d.id}`} className="row-link">
                          {b.name}
                        </Link>
                        <div className="text-xs text-ink-faint truncate">
                          {[b.city, b.region].filter(Boolean).join(", ")}
                          {d.step > 0 ? " · follow-up" : ""}
                        </div>
                      </td>
                      <td className="text-xs max-w-[200px]">
                        {b.email ? <span className="truncate block" title={b.email}>{b.email}</span> : <span className="text-warn">no address</span>}
                        {b.emailSource && <span className="text-ink-faint">{b.emailSource === "site" ? "from their website" : b.emailSource === "manual" ? "added by you" : "from the listing"}</span>}
                      </td>
                      <td className="max-w-[420px]">
                        <div className="text-sm font-medium truncate">{d.subject}</div>
                        <div className="text-xs text-ink-muted line-clamp-2">{tab === "review" || tab === "blocked" ? blocks.map((i) => i.message).join(" ") || d.lastError : d.status === "failed" || d.status === "bounced" ? d.lastError : openingLine(d.body)}</div>
                      </td>
                      <td>{b.priority != null ? <ScoreRing value={b.priority} size={34} /> : <span className="text-xs text-ink-faint">—</span>}</td>
                      <td className="whitespace-nowrap">
                        <StatusPill status={d.status} label={d.status === "queued" ? `Queued · ${when(d.scheduledAt)}` : d.status === "failed" ? "Not sent" : undefined} />
                        {d.validation?.overridden && <div className="text-[11px] text-warn mt-0.5">approved despite a failed check</div>}
                        {d.status === "sent" && <div className="text-[11px] text-ink-faint mt-0.5">{when(d.sentAt)}</div>}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          {d.status === "ready" && <StatusForm id={d.id} op="approve" className="btn btn-sm btn-primary">Approve</StatusForm>}
                          {d.status === "approved" && <StatusForm id={d.id} op="unapprove" className="btn btn-sm btn-ghost">Undo</StatusForm>}
                          {(d.status === "ready" || d.status === "approved" || d.status === "needs_review") && <StatusForm id={d.id} op="exclude" className="btn btn-sm btn-ghost">Exclude</StatusForm>}
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
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {tab === "blocked" && o.unreachable.length > 0 && (
        <Card className="mt-5" title="No address on record" description="Research found no public email for these businesses, so nothing was written. Add an address you have (a business card, a reply, a referral) and the work continues." padded={false}>
          <ul className="divide-y divide-line">
            {o.unreachable.map((b) => (
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
        </Card>
      )}
      {tab === "ready" && c.approved > 0 && (
        <p className="text-xs text-ink-faint mt-3">
          <Badge tone="ok">Approved</Badge> emails go out when you press <strong>Send approved emails</strong>: one at a time, at most {settings.dailySendCap} a day, between {settings.sendWindowStart}:00 and {settings.sendWindowEnd}:00.
        </p>
      )}
    </>
  );
}
