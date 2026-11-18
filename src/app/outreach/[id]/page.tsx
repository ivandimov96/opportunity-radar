import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { EmailFields } from "@/components/email-editor";
import { Badge, Callout, Card, Flash, Icon, PageHeader, ScoreRing, StatusPill } from "@/components/ui";
import { getConfig } from "@/lib/config";
import { signatureBlock, subjectIdeasFor } from "@/lib/outreach/drafts";
import { draftDetail } from "@/lib/outreach/queries";
import { stripQuoted } from "@/lib/mail/parse";
import { verdictLabel } from "@/lib/pipeline/stages";
import { settingsHref } from "@/lib/settings-nav";
import { EMAIL_LENGTH } from "@/lib/outreach/validate";
import { suggestSubjectsAction, draftStatusAction, generateDraftAction, markDraftSentAction, retryFailedAction, saveDraftAction, setBusinessEmailAction } from "@/app/actions";

export const metadata = { title: "Review email" };

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const EVENT_LABEL: Record<string, string> = { queued: "Queued", attempt: "Handed to the mailbox", sent: "Sent", failed: "Attempt failed", bounced: "Bounced", reconciled: "Confirmed in the Sent folder", unconfirmed: "Outcome unknown", cancelled: "Stopped", rescheduled: "Moved to a later slot" };
const REPLY_LABEL: Record<string, string> = { wants_meeting: "Wants a meeting", interested: "Interested", wants_info: "Asks for more information", not_now: "Not now", declined: "Declined", unsubscribe: "Asked not to be contacted", wrong_person: "Points to someone else", other: "Other" };

export default async function ReviewEmailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const d = await draftDetail(id);
  if (!d) notFound();
  const { draft, business: b, opportunity: opp, pack, settings } = d;
  const cfg = getConfig();
  const editable = ["needs_review", "ready", "approved", "excluded"].includes(draft.status);
  const ideas = editable ? await subjectIdeasFor(draft.id) : null;
  const issues = draft.validation?.issues ?? [];
  const blocks = issues.filter((i) => i.severity === "block");
  const warns = issues.filter((i) => i.severity === "warn");
  const recipientBlocked = blocks.some((i) => i.code === "recipient");
  const here = `/outreach/${draft.id}`;
  const byRef = new Map(pack.verified.map((e) => [e.ref, e]));
  const notSeen = new Map(pack.notSeen.map((e) => [e.ref, e]));
  const { softMin: minWords, softMax: maxWords } = EMAIL_LENGTH[draft.step === 0 ? "first" : "followUp"];
  const Status = ({ op, children, className = "btn" }: { op: string; children: React.ReactNode; className?: string }) => (
    <form action={draftStatusAction}>
      <input type="hidden" name="draftId" value={draft.id} />
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="returnTo" value={here} />
      <button className={className}>{children}</button>
    </form>
  );

  return (
    <>
      <PageHeader
        crumbs={[{ href: `/outreach${d.tab ? `?tab=${d.tab}` : ""}`, label: "Outreach" }, { label: b.name }]}
        title={
          <span className="flex items-center gap-2 flex-wrap">
            {draft.step > 0 ? "Follow-up to" : "Email to"} {b.name} <StatusPill status={draft.status} label={draft.status === "failed" ? "Not sent" : undefined} />
          </span>
        }
        subtitle={d.position ? `${d.position.index} of ${d.position.total} in this list` : undefined}
        actions={
          <>
            {d.prev ? <Link href={`/outreach/${d.prev}`} className="btn btn-ghost">← Previous</Link> : null}
            {d.next ? <Link href={`/outreach/${d.next}`} className="btn btn-ghost">Next →</Link> : null}
          </>
        }
      />
      <Flash msg={sp.ok} />
      <Flash msg={sp.error} tone="bad" />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-5 items-start">
        <div className="space-y-4 min-w-0">
          {blocks.length > 0 && (
            <Callout tone="warn" title={recipientBlocked ? "This business cannot be emailed yet" : "A check failed: have a look before this goes out"}>
              <ul className="list-disc pl-4 space-y-0.5 text-sm">
                {blocks.map((i, n) => (
                  <li key={n}>{i.message}</li>
                ))}
              </ul>
              {recipientBlocked && !d.suppression && (
                <form action={setBusinessEmailAction} className="mt-3 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="businessId" value={b.id} />
                  <input type="hidden" name="returnTo" value={here} />
                  <input className="input max-w-xs" type="email" name="email" defaultValue={b.email ?? ""} placeholder="name@their-domain.com" required aria-label="Email address" />
                  <button className="btn btn-sm">Save address</button>
                </form>
              )}
            </Callout>
          )}

          {!draft.validation && editable && (
            <Callout tone="warn" title="This email was written before the current checks existed">
              Nothing has verified its statements against the research. The safest thing is to have it written again below; approving it as it is runs the fixed checks first and records your decision.
            </Callout>
          )}

          <Card
            title={draft.step > 0 ? "The follow-up exactly as it will be sent" : "The email exactly as it will be sent"}
            description={
              <>
                To <strong>{b.email ?? "no address yet"}</strong>
                {b.emailSource && ` · ${b.emailSource === "site" ? "published on their website" : b.emailSource === "manual" ? "added by you" : "from their listing"}`}
                {cfg.mail.address && ` · from ${cfg.mail.address}`}
              </>
            }
          >
            <form action={saveDraftAction} className="space-y-4">
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="nextId" value={d.next ?? ""} />
              <EmailFields subject={draft.subject ?? ""} body={draft.body} readOnly={!editable} minWords={minWords} maxWords={maxWords} suggestAction={draft.step === 0 ? suggestSubjectsAction : undefined} suggestions={ideas?.options ?? []} canSuggest={cfg.ai.enabled} />
              <div>
                <div className="label">Signature (added automatically{settings.senderName ? "" : "; add your name and address"}; change it under <Link href={settingsHref("sender")}>Settings</Link>)</div>
                <pre className="text-xs text-ink-muted whitespace-pre-wrap rounded-lg bg-surface-2 border border-line px-3 py-2 font-[inherit]">{signatureBlock(settings)}</pre>
              </div>
              {editable && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {draft.status !== "excluded" && draft.status !== "approved" && !recipientBlocked && (
                    <>
                      <button className="btn btn-primary" name="then" value={d.next ? "approve_next" : "approve"}>
                        <Icon name="check" /> {blocks.length ? "Approve anyway" : "Approve"}
                        {d.next ? " & next" : ""}
                      </button>
                    </>
                  )}
                  <button className="btn" name="then" value="stay">
                    Save changes
                  </button>
                  {draft.status === "approved" && <span className="text-xs text-ok">Approved: it goes out with the next batch you send.</span>}
                </div>
              )}
            </form>
            {editable && (
              <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-line">
                {draft.status === "approved" && <Status op="unapprove" className="btn btn-sm">Undo approval</Status>}
                {draft.status !== "excluded" ? <Status op="exclude" className="btn btn-sm btn-ghost">Exclude this business</Status> : <Status op="restore" className="btn btn-sm">Put back in the batch</Status>}
                {!recipientBlocked && draft.status !== "excluded" && (
                  <form action={markDraftSentAction}>
                    <input type="hidden" name="draftId" value={draft.id} />
                    <input type="hidden" name="returnTo" value={here} />
                    <ConfirmButton confirmLabel="Record as sent" className="btn btn-sm btn-ghost" message="Record this email as sent by you? Use this when you copied it and sent it from your own mail program.">I sent it myself</ConfirmButton>
                  </form>
                )}
              </div>
            )}
            {draft.status === "failed" && (
              <div className="mt-3 pt-3 border-t border-line">
                <p className="text-sm text-bad mb-2">{draft.lastError}</p>
                <div className="flex flex-wrap gap-2">
                  <form action={retryFailedAction}>
                    <input type="hidden" name="draftId" value={draft.id} />
                    <input type="hidden" name="returnTo" value={here} />
                    <button className="btn btn-sm">Retry now</button>
                  </form>
                  <form action={markDraftSentAction}>
                    <input type="hidden" name="draftId" value={draft.id} />
                    <input type="hidden" name="returnTo" value={here} />
                    <ConfirmButton confirmLabel="Record as sent" className="btn btn-sm btn-ghost" message="Record this email as sent? Do this only if you see it in your Sent folder.">It is in my Sent folder</ConfirmButton>
                  </form>
                </div>
              </div>
            )}
          </Card>

          {editable && cfg.ai.enabled && (
            <Card title="Not happy with it?" description="Have it written again. Say what to change, or leave the note empty for a fresh attempt.">
              <form action={generateDraftAction} className="flex flex-wrap gap-2 items-start">
                <input type="hidden" name="businessId" value={b.id} />
                <input type="hidden" name="step" value={draft.step} />
                <input className="input flex-1 min-w-[240px]" name="feedback" placeholder="e.g. shorter, lead with their maintenance plan, less formal" maxLength={500} />
                <button className="btn">
                  <Icon name="refresh" /> Write it again
                </button>
              </form>
            </Card>
          )}

          {warns.length > 0 && (
            <Card title="Worth a glance" description="These did not hold the email back.">
              <ul className="list-disc pl-4 space-y-0.5 text-sm text-ink-muted">
                {warns.map((i, n) => (
                  <li key={n}>{i.message}</li>
                ))}
              </ul>
            </Card>
          )}

          {(d.events.length > 0 || d.inbound.length > 0) && (
            <Card title="What happened to this email" padded={false}>
              <ol className="divide-y divide-line">
                {d.events.map((e) => (
                  <li key={e.id} className="px-5 py-2.5 flex items-baseline gap-3 text-sm">
                    <span className="text-xs text-ink-faint w-32 shrink-0 tabular-nums">{when(e.createdAt)}</span>
                    <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>
                    <span className="text-xs text-ink-muted truncate">{typeof e.detail?.message === "string" ? e.detail.message : typeof e.detail?.response === "string" ? e.detail.response : typeof e.detail?.scheduledAt === "string" ? `for ${when(e.detail.scheduledAt)}` : ""}</span>
                  </li>
                ))}
                {d.inbound.map((m) => (
                  <li key={m.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-ink-faint w-32 shrink-0 tabular-nums">{when(m.receivedAt)}</span>
                      <Badge tone={m.kind === "bounce" ? "bad" : m.kind === "auto_reply" ? "neutral" : "info"}>{m.kind === "bounce" ? "Bounce" : m.kind === "auto_reply" ? "Automatic reply" : "Reply"}</Badge>
                      <span className="font-medium">{m.fromName || m.fromEmail}</span>
                      {m.classification && <Badge tone="accent">{REPLY_LABEL[m.classification] ?? m.classification}</Badge>}
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-ink-muted">{stripQuoted(m.bodyText).slice(0, 1200)}</p>
                  </li>
                ))}
              </ol>
              {d.inbound.some((m) => m.kind === "reply") && (
                <p className="px-5 py-3 border-t border-line text-xs text-ink-faint">
                  Answer from your own mailbox. Suggested answers and the full conversation are on the <Link href={`/businesses/${b.id}?tab=outreach`}>business page</Link>.
                </p>
              )}
            </Card>
          )}
        </div>

        <aside className="space-y-4 min-w-0 lg:sticky lg:top-6">
          <Card
            title="Why this business"
            actions={
              <Link href={`/businesses/${b.id}`} className="btn btn-sm btn-ghost">
                Full research <Icon name="external" className="w-3 h-3" />
              </Link>
            }
          >
            <div className="flex items-start gap-3">
              {b.priority != null && <ScoreRing value={b.priority} size={44} label="Score" />}
              <div className="min-w-0 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone={b.verdict === "qualified" ? "ok" : "warn"}>{verdictLabel(b.verdict)}</Badge>
                  <span className="text-xs text-ink-faint">{[b.category, [b.city, b.region].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</span>
                </div>
                {b.summary && <p className="mt-1.5 text-ink-muted">{b.summary}</p>}
                {b.website && (
                  <a href={b.website} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1 mt-1">
                    {b.websiteDomain ?? b.website} <Icon name="external" className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
            {(b.verdictReasons ?? []).length > 0 && <p className="text-xs text-ink-faint mt-3 pt-3 border-t border-line">{(b.verdictReasons ?? []).join(" ")}</p>}
          </Card>

          {opp && (
            <Card title="The idea behind this email" description={opp.source === "ai" ? "One consolidated opportunity from the research." : "Grouped from fixed rule patterns; no model reviewed it."}>
              <div className="text-sm font-semibold">{opp.title}</div>
              {opp.whyRelevant && <p className="text-sm text-ink-muted mt-1">{opp.whyRelevant}</p>}
              <p className="text-sm mt-2">{opp.proposedSolution}</p>
              {(opp.components ?? []).length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {(opp.components ?? []).map((c) => (
                    <li key={c.name} className="text-sm">
                      <span className="font-medium">{c.name}.</span> <span className="text-ink-muted">{c.description}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-ink-faint mt-3">
                A hypothesis to explore with them, not a fact: {opp.problemHypothesis}
              </p>
            </Card>
          )}

          <Card title="What the email says about them" description="Each statement and the research behind it." padded={false}>
            {draft.claims.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-faint">No statement about the business is listed for this email.</p>
            ) : (
              <ul className="divide-y divide-line">
                {draft.claims.map((c, n) => {
                  const refs = c.factKeys.map((k) => byRef.get(k)).filter((x): x is NonNullable<typeof x> => Boolean(x));
                  const gaps = c.factKeys.map((k) => notSeen.get(k)).filter((x): x is NonNullable<typeof x> => Boolean(x));
                  return (
                    <li key={n} className="px-5 py-3 text-sm">
                      <div>“{c.text}”</div>
                      {refs.map((e) => (
                        <div key={e.ref} className="mt-1.5 text-xs text-ink-muted border-l-2 border-ok/50 pl-2">
                          <span className="text-ok font-medium">Verified.</span> {e.text}
                          {e.quote && <span className="block text-ink-faint">Their words: “{e.quote.slice(0, 220)}”</span>}
                          {e.sourceUrl && (
                            <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="text-[11px]">
                              source
                            </a>
                          )}
                        </div>
                      ))}
                      {gaps.map((e) => (
                        <div key={e.ref} className="mt-1.5 text-xs text-ink-muted border-l-2 border-warn/50 pl-2">
                          <span className="text-warn font-medium">Not seen on their site</span> ({e.label}): may only be asked, never stated.
                        </div>
                      ))}
                      {!refs.length && !gaps.length && <div className="mt-1.5 text-xs text-bad">Nothing in the research supports this.</div>}
                    </li>
                  );
                })}
              </ul>
            )}
            {draft.validation?.statements && (
              <p className="px-5 py-3 border-t border-line text-xs text-ink-faint">
                Independent check: {draft.validation.statements.filter((s) => s.verdict === "supported").length} supported, {draft.validation.statements.filter((s) => s.verdict === "hypothesis").length} phrased as a question or possibility, {draft.validation.statements.filter((s) => s.verdict === "unsupported").length} unsupported.
              </p>
            )}
            {draft.editedByUser && !draft.validation?.statements && <p className="px-5 py-3 border-t border-line text-xs text-ink-faint">You edited this email, so the independent check of the earlier text no longer applies. The fixed checks ran on your version.</p>}
          </Card>
        </aside>
      </div>
    </>
  );
}
