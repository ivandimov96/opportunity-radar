import { DUE_CHOICES, dueTag } from "@/lib/due";
import { stepLabel } from "@/lib/outreach/steps";
import Link from "next/link";
import { notFound } from "next/navigation";
import { businessActivities, getBusinessDetail } from "@/lib/queries";
import { getConfig } from "@/lib/config";
import { Badge, Callout, Card, EmptyState, Flash, Icon, PageHeader, ScoreRing, StatusPill, Tabs, fmtDate, fmtDuration, fmtRelative, type Tone } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { formatPhone } from "@/lib/phone";
import { ConfirmButton } from "@/components/confirm-button";
import { ACTIVITY_KINDS, ActivityTimeline, kindCounts, stageTone, type ActivityKind } from "@/components/activity-timeline";
import { OPPORTUNITY_CATEGORIES, SOLUTION_SCOPES, getPlaybook, type OpportunityCategory, type SolutionScope } from "@/lib/industries";
import { FACT_FIELDS, FACT_GROUPS, factLabel, factValueLabel } from "@/lib/profile/fields";
import { PIPELINE_STAGES, stageLabel, verdictLabel } from "@/lib/pipeline/stages";
import { stripQuoted } from "@/lib/mail/parse";
import { deriveWorkflow, isResearchStale, researchAgeDays, defaultTabFor } from "@/lib/workflow";
import { addNoteAction, chooseIdeaAction, removeBusinessAction, completeNextActionAction, generateDraftAction, investigateAction, markReplyHandledAction, reclassifyReplyAction, setBusinessEmailAction, setNextActionAction, setVerdictAction, updateStageAction, updateWebsiteAction } from "@/app/actions";

const REPLY_LABEL: Record<string, string> = { wants_meeting: "Wants a meeting", interested: "Interested", wants_info: "Asks for more information", not_now: "Not now", declined: "Declined", unsubscribe: "Asked not to be contacted", wrong_person: "Points to someone else", other: "Other" };
const REPLY_TONE: Record<string, Tone> = { wants_meeting: "ok", interested: "ok", wants_info: "info", not_now: "neutral", declined: "bad", unsubscribe: "bad", wrong_person: "info", other: "neutral" };

const TABS = ["opportunities", "outreach", "profile", "activity"] as const;
type Tab = (typeof TABS)[number];

export default async function BusinessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; kind?: string; page?: string; draft?: string; ok?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const d = await getBusinessDetail(id);
  if (!d) notFound();
  const { business: b } = d;
  const cfg = getConfig();
  const busy = d.activeJobs.length > 0 || b.status === "queued" || b.status === "investigating";
  const liveDrafts = d.drafts.filter((x) => x.status !== "archived");
  const openReplies = d.inbound.filter((m) => m.kind === "reply" && !m.handledAt).length;
  const wf = deriveWorkflow({ business: b, stage: d.prospect?.stage ?? "discovered", opportunityCount: d.opportunities.length, draftCount: liveDrafts.length, draftStatus: liveDrafts[0]?.status ?? null, openReplies, busy });
  const primary = d.opportunities.find((o) => o.role === "primary") ?? d.opportunities[0] ?? null;
  const secondary = d.opportunities.filter((o) => o !== primary);
  /** A first email is on its way or out: the idea it raises is no longer swapped. */
  const emailed = d.drafts.some((x) => x.step === 0 && ["queued", "sending", "sent", "bounced"].includes(x.status));
  const obsByRef = new Map(d.observations.map((o) => [o.ref, o]));
  const tab: Tab = sp.tab === "pages" ? "profile" : (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : (defaultTabFor(wf.next.kind) as Tab);
  const verified = d.facts.filter((f) => f.status === "verified");
  const gaps = d.facts.filter((f) => f.status === "not_found");
  const factByKey = new Map(d.facts.map((f) => [f.key, f]));
  const counts: Record<Tab, number | null> = { opportunities: null, profile: verified.length + d.observations.length, outreach: liveDrafts.length + d.inbound.length, activity: d.activityCount };
  const TAB_LABEL: Record<Tab, string> = { opportunities: "Idea", outreach: "Email", profile: "Research", activity: "History" };
  const stage = d.prospect?.stage ?? "discovered";
  const tabHref = (t: Tab) => `/businesses/${b.id}?tab=${t}`;
  const activityKind: ActivityKind = ACTIVITY_KINDS.some((k) => k.key === sp.kind) ? (sp.kind as ActivityKind) : "all";
  const activityPage = Math.max(1, Math.floor(Number(sp.page) || 1));
  const ACTIVITY_PAGE_SIZE = 25;
  const activityHref = (k: ActivityKind, page = 1) => `${tabHref("activity")}${k === "all" ? "" : `&kind=${k}`}${page > 1 ? `&page=${page}` : ""}#activity`;
  const outreachHistory = true ? await businessActivities(b.id, { types: ["email", "call", "meeting", "note"], page: 1, pageSize: 8 }) : null;
  /** The short list on the right: the latest few events, newest first. */
  const recent = await businessActivities(b.id, { page: 1, pageSize: 6 });
  const showAllHistory = sp.tab === "activity" || Boolean(sp.kind || sp.page);
  const activity = showAllHistory ? await businessActivities(b.id, { types: ACTIVITY_KINDS.find((k) => k.key === activityKind)?.types, page: activityPage, pageSize: ACTIVITY_PAGE_SIZE }) : null;

  const PrimaryAction = () => {
    switch (wf.next.kind) {
      case "investigate":
      case "retry":
        return (
          <form action={investigateAction}>
            <input type="hidden" name="businessId" value={b.id} />
            <button className="btn btn-primary" disabled={!cfg.firecrawl.enabled} title={cfg.firecrawl.enabled ? undefined : "Website research needs FIRECRAWL_API_KEY"}>
              <Icon name="sparkles" /> {wf.next.kind === "retry" ? "Try the research again" : "Research"}
            </button>
          </form>
        );
      case "review_research":
        return (
          <Link href={tabHref("opportunities")} className="btn btn-primary">
            <Icon name="eye" /> See why
          </Link>
        );
      case "review_email":
      case "send":
        return liveDrafts[0] ? (
          <Link href={`/outreach/${liveDrafts[0].id}`} className="btn btn-primary">
            <Icon name="mail" /> {wf.next.kind === "send" ? "Open the email" : "Review the email"}
          </Link>
        ) : null;
      case "answer":
        return (
          <Link href={tabHref("outreach")} className="btn btn-primary">
            <Icon name="mail" /> Read the reply
          </Link>
        );
      default:
        return null;
    }
  };

  /** What kind of business it is, in plain words: the listing's own category ("car_repair" reads "Car repair"), else the search type. */
  const rawKind = (b.category ?? "").replace(/_/g, " ").trim();
  const kind = rawKind ? rawKind.charAt(0).toUpperCase() + rawKind.slice(1) : getPlaybook(b.industry).key === "generic" ? "" : getPlaybook(b.industry).label;
  const score = b.priority ?? b.leadScore;
  /**
   * The conversation in time order: emails that went out and what came back, then (last) the emails
   * that still wait for the operator. One list, so nothing has to be pieced together from separate cards.
   */
  const SENT_STATES = ["sent", "bounced", "sending", "queued"];
  const thread: ({ kind: "ours"; at: string; pending: boolean; draft: (typeof liveDrafts)[number] } | { kind: "theirs"; at: string; msg: (typeof d.inbound)[number] })[] = [
    ...liveDrafts.filter((x) => SENT_STATES.includes(x.status)).map((x) => ({ kind: "ours" as const, at: x.sentAt ?? x.scheduledAt ?? x.createdAt, pending: false, draft: x })),
    ...d.inbound.map((m) => ({ kind: "theirs" as const, at: m.receivedAt, msg: m })),
  ].sort((x, y) => (x.at < y.at ? -1 : 1));
  thread.push(...liveDrafts.filter((x) => !SENT_STATES.includes(x.status)).sort((x, y) => x.step - y.step).map((x) => ({ kind: "ours" as const, at: x.createdAt, pending: true, draft: x })));
  const REPLY_TONE: Record<string, Tone> = { wants_meeting: "ok", interested: "ok", wants_info: "info", not_now: "warn", declined: "neutral", unsubscribe: "bad", wrong_person: "warn", other: "neutral" };
  /** Research has been done at least once (whatever it concluded). */
  const researched = Boolean(b.investigatedAt) || d.facts.length > 0;
  /** What the map listing itself says (kept with the source record): its categories, opening hours and a link to it. */
  const raw = (d.sources.find((x) => x.raw)?.raw ?? {}) as { types?: unknown; openingHours?: unknown; cid?: unknown };
  const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const listing = {
    types: Array.isArray(raw.types) ? raw.types.filter((x): x is string => typeof x === "string").slice(0, 4) : [],
    hours: raw.openingHours && typeof raw.openingHours === "object" && !Array.isArray(raw.openingHours) ? WEEK.filter((day) => typeof (raw.openingHours as Record<string, unknown>)[day] === "string").map((day) => [day, String((raw.openingHours as Record<string, unknown>)[day])] as const) : [],
    openDays: (() => {
      const hours = raw.openingHours && typeof raw.openingHours === "object" && !Array.isArray(raw.openingHours) ? (raw.openingHours as Record<string, unknown>) : null;
      if (!hours) return "";
      const open = WEEK.filter((day) => typeof hours[day] === "string" && !/closed/i.test(String(hours[day])));
      if (!open.length) return "";
      const same = open.every((day) => hours[day] === hours[open[0]]);
      const span = open.length === 1 ? open[0].slice(0, 3) : `${open[0].slice(0, 3)}–${open[open.length - 1].slice(0, 3)}`;
      return same ? `${span}, ${String(hours[open[0]])}` : `${open.length} days a week`;
    })(),
    mapUrl: typeof raw.cid === "string" && /^\d+$/.test(raw.cid) ? `https://www.google.com/maps?cid=${raw.cid}` : null,
  };
  /** The way from found to won, and how many of its steps this business has completed. */
  const JOURNEY = ["Found", "Researched", "Qualified", "Emailed", "Replied", "Meeting", "Won"];
  const reached = stage === "won" ? 7 : stage === "meeting_scheduled" || stage === "proposal_sent" ? 6 : stage === "replied" ? 5 : stage === "contacted" || stage === "lost" ? 4 : stage === "qualified" || stage === "ready_to_contact" || b.verdict === "qualified" ? 3 : b.investigatedAt ? 2 : 1;

  return (
    <>
      <nav className="flex items-center gap-1.5 text-sm text-ink-muted mb-4" aria-label="Breadcrumb">
        <Link href="/businesses">Businesses</Link>
        <Icon name="chevronRight" className="w-3 h-3" />
        <span className="text-ink truncate">{b.name}</span>
      </nav>
      <Flash msg={sp.ok} />
      <Flash msg={sp.error} tone="bad" />

      <div className="space-y-4">
        {/* Who they are, how to reach them, and the one thing to do next. */}
        <section className="surface" aria-label="Business">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-4 p-5">
            {score != null && (
              <span className="shrink-0" title={b.priority != null ? "Priority after research" : `Listing score before research: ${(b.leadReasons ?? []).join(", ")}`}>
                <ScoreRing value={score} size={56} />
              </span>
            )}
            <div className="min-w-[14rem] flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl leading-tight">{b.name}</h1>
                <StatusPill status={b.verdict ?? b.status} />
                {b.kind === "chain" && <Badge tone="neutral">chain</Badge>}
              </div>
              <div className="text-sm text-ink-muted mt-1">
                {[kind, [b.street, b.city, b.region, b.postalCode].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                {b.rating != null && (
                  <span className="tabular-nums">
                    {" · "}
                    <strong className="text-ink">{b.rating.toFixed(1)}</strong> <span className="text-warn">★</span>
                    {b.reviewCount != null ? ` (${b.reviewCount.toLocaleString()} ${b.reviewCount === 1 ? "review" : "reviews"})` : ""}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <AutoRefresh active={busy} label={b.statusMessage ?? "Researching"} />
              {/* Research has its own button in step 1; every other next step is one click from here. */}
              {!busy && wf.next.kind !== "investigate" && wf.next.kind !== "retry" && <PrimaryAction />}
              {!busy && !emailed && (
                <form action={removeBusinessAction}>
                  <input type="hidden" name="businessId" value={b.id} />
                  <input type="hidden" name="returnTo" value="/businesses" />
                  <ConfirmButton confirmLabel="Remove" danger className="btn btn-ghost btn-danger" message={`Remove ${b.name}? Its research and any unsent email are deleted, and future searches will leave it out. You can allow it again under Settings.`}>
                    <Icon name="x" /> Remove
                  </ConfirmButton>
                </form>
              )}
            </div>
          </div>
          <ul className="flex flex-wrap items-center gap-x-7 gap-y-2.5 border-t border-line px-5 py-3.5 text-sm" aria-label="Contact">
            <ContactItem icon="phone">
              {b.phone ? (
                <a href={`tel:${b.phone}`} className="tabular-nums">
                  {formatPhone(b.phone, b.country)}
                </a>
              ) : (
                <span className="text-ink-faint">No phone</span>
              )}
            </ContactItem>
            <ContactItem icon="globe">
              {b.website ? (
                <a href={b.website} target="_blank" rel="noreferrer">
                  {b.websiteDomain ?? b.website}
                </a>
              ) : (
                <span className="text-ink-faint">No website</span>
              )}
            </ContactItem>
            <ContactItem icon="mail">
              {b.email ? <a href={`mailto:${b.email}`}>{b.email}</a> : <span className={b.investigatedAt ? "text-warn" : "text-ink-faint"}>{b.investigatedAt ? "No email found" : "No email yet"}</span>}
              <details className="relative inline-block ml-2 text-xs align-middle">
                <summary className="text-ink-faint cursor-pointer select-none list-none hover:text-ink">{b.email ? `${b.emailSource === "site" ? "from their website" : b.emailSource === "manual" ? "added by you" : "from their listing"}${b.emailStatus === "invalid" ? " · does not accept mail" : ""} · change` : "add"}</summary>
                <form action={setBusinessEmailAction} className="absolute z-20 left-0 top-6 flex gap-1.5 surface p-2 shadow-lg w-72">
                  <input type="hidden" name="businessId" value={b.id} />
                  <input className="input h-8 text-xs min-w-0" type="email" name="email" defaultValue={b.email ?? ""} placeholder="name@their-domain.com" required aria-label="Email address" />
                  <button className="btn btn-sm">Save</button>
                </form>
              </details>
            </ContactItem>
            {listing.mapUrl && (
              <ContactItem icon="external">
                <a href={listing.mapUrl} target="_blank" rel="noreferrer">
                  Google Maps
                </a>
              </ContactItem>
            )}
          </ul>
          {/* Where this business is on the way from found to won. */}
          <ol className="flex items-start border-t border-line px-3 py-3.5" aria-label="Journey">
            {JOURNEY.map((step, i) => {
              const done = i < reached - 1;
              const now = i === reached - 1;
              return (
                <li key={step} className="flex-1 min-w-0 flex flex-col items-center text-center relative">
                  {i > 0 && <span className={`absolute top-[0.6rem] right-1/2 w-full h-0.5 ${i <= reached - 1 ? "bg-ok" : "bg-line-strong"}`} aria-hidden />}
                  <span className={`relative z-10 w-5 h-5 rounded-full grid place-items-center text-[0.65rem] font-bold ${done ? "bg-ok text-accent-fg" : now ? (stage === "lost" ? "bg-bad text-accent-fg" : "bg-accent text-accent-fg") : "bg-surface-3 text-ink-faint border border-line-strong"}`}>{done ? <Icon name="check" className="w-3 h-3" /> : i + 1}</span>
                  {/* On a phone only the current step is named: seven names do not fit side by side. */}
                  <span className={`text-xs mt-1 whitespace-nowrap ${now ? "font-semibold text-ink" : `hidden sm:block ${done ? "text-ink-muted" : "text-ink-faint"}`}`}>{now && stage === "lost" ? "Lost" : step}</span>
                </li>
              );
            })}
          </ol>
        </section>

        {/* The work on the left; where the business stands, what happened and where it came from stay beside it. */}
        <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
          <div className="min-w-0 space-y-4">
          {wf.next.kind === "add_email" && (
            <div className="mb-4">
              <Callout tone="warn" title="No public email address was found">
                <p className="text-sm">{(b.verdictReasons ?? [])[0] ?? wf.next.description}</p>
                <form action={setBusinessEmailAction} className="mt-2 flex flex-wrap gap-2 items-center">
                  <input type="hidden" name="businessId" value={b.id} />
                  <input className="input max-w-sm" type="email" name="email" placeholder="name@their-domain.com" required aria-label="Email address" />
                  <button className="btn btn-sm">Save the address and continue the research</button>
                </form>
              </Callout>
            </div>
          )}

          {(wf.next.kind === "retry" || wf.next.kind === "no_website") && (
            <div className="mb-4">
              <Callout tone="warn" title={wf.next.kind === "retry" ? `Investigation failed: ${b.statusMessage ?? "unknown error"}` : "No website could be located"}>
                {wf.next.kind === "no_website" && <p className="text-sm">{wf.next.description}</p>}
                <form action={updateWebsiteAction} className="mt-2 flex flex-wrap gap-2 items-center">
                  <input type="hidden" name="businessId" value={b.id} />
                  <input className="input max-w-sm" name="website" defaultValue={b.website ?? ""} placeholder="https://their-website.com" />
                  <button className="btn btn-sm">Save website &amp; investigate</button>
                </form>
                {wf.next.kind === "no_website" && (
                  <form action={investigateAction} className="mt-2">
                    <input type="hidden" name="businessId" value={b.id} />
                    <button className="btn btn-sm btn-ghost"><Icon name="refresh" /> Retry the website finder</button>
                  </form>
                )}
              </Callout>
            </div>
          )}


          {/* The work, in the order it happens. The step to do now is open; finished ones fold to one line. */}
          <ol className="space-y-4" aria-label="Progress">
            <Step n={1} title="Research" state={researched && !busy ? "done" : "now"} status={busy ? "Researching…" : researched ? `${verdictLabel(b.verdict) || "Researched"}${b.investigatedAt ? ` · ${fmtRelative(b.investigatedAt)}` : ""}` : "Not started"}>
              {!researched && !busy && (
                <div className="surface p-5 flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-[14rem]">
                    <div className="text-base font-semibold">Read their website and prepare one idea</div>
                  </div>
                  <form action={investigateAction}>
                    <input type="hidden" name="businessId" value={b.id} />
                    <button className="btn btn-primary btn-lg" disabled={!cfg.firecrawl.enabled} title={cfg.firecrawl.enabled ? undefined : "Website research needs FIRECRAWL_API_KEY"}>
                      <Icon name="sparkles" /> Research this business
                    </button>
                  </form>
                </div>
              )}
              {!d.latest && !d.facts.length && (
                <section className="surface" aria-label="Map listing">
                  <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line">
                    <div className="px-5 py-4">
                      <div className="text-xs font-semibold text-ink-muted">Listed as</div>
                      <div className="text-[0.95rem] font-semibold mt-1">{listing.types.length ? listing.types.join(", ") : kind || "—"}</div>
                    </div>
                    <div className="px-5 py-4">
                      <div className="text-xs font-semibold text-ink-muted">Reviews</div>
                      <div className="text-[0.95rem] font-semibold mt-1 tabular-nums">
                        {b.rating != null ? (
                          <>
                            {b.rating.toFixed(1)} <span className="text-warn">★</span> <span className="font-normal text-ink-muted">· {(b.reviewCount ?? 0).toLocaleString()} {b.reviewCount === 1 ? "review" : "reviews"}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </div>
                    </div>
                    <div className="px-5 py-4">
                      <div className="text-xs font-semibold text-ink-muted">Open</div>
                      <div className="text-[0.95rem] font-semibold mt-1">{listing.openDays || "—"}</div>
                    </div>
                  </div>
                </section>
              )}
              {(d.latest || d.facts.length > 0) && (
              <Card title="What this business does">
                {b.summary ? (
                  <p className="text-sm leading-relaxed">{b.summary}</p>
                ) : d.facts.length ? (
                  <p className="text-sm text-ink-muted">{cfg.ai.enabled ? "No summary could be verified from the site." : "Summary needs the AI step (ANTHROPIC_API_KEY). Detected facts are below."}</p>
                ) : (
                  <EmptyState compact icon="sparkles" title="Not researched yet" />
                )}
                {d.latest?.workflows?.length ? (
                  <div className="mt-4">
                    <div className="label">Workflows documented on the site</div>
                    <ul className="flex flex-wrap gap-1.5">
                      {d.latest.workflows.map((w, i) => (
                        <li key={i}>
                          <Badge tone="info">{w.name}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Card>
              )}

              {b.status === "profiled" && (
                <Callout tone={b.verdict === "qualified" ? "ok" : b.verdict === "not_a_fit" ? "neutral" : "warn"} title={verdictLabel(b.verdict)}>
                  {(b.verdictReasons ?? []).length > 0 ? (
                    <ul className="text-sm space-y-0.5">
                      {(b.verdictReasons ?? []).map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm">{d.latest?.verdictReason}</p>
                  )}
                  {(b.verdict === "needs_review" || b.verdict === "insufficient_evidence" || b.verdict === "not_a_fit") && primary && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      <form action={setVerdictAction}>
                        <input type="hidden" name="businessId" value={b.id} />
                        <input type="hidden" name="verdict" value="qualified" />
                        <button className="btn btn-sm btn-primary">
                          <Icon name="check" /> Qualify it myself
                        </button>
                      </form>
                      {b.verdict !== "not_a_fit" && (
                        <form action={setVerdictAction}>
                          <input type="hidden" name="businessId" value={b.id} />
                          <input type="hidden" name="verdict" value="not_a_fit" />
                          <button className="btn btn-sm">Not a fit</button>
                        </form>
                      )}
                    </div>
                  )}
                </Callout>
              )}
              {researched && (
                <details className="surface group">
                  <summary className="flex items-center gap-2 px-5 py-3.5 cursor-pointer select-none text-[0.95rem] font-semibold list-none">
                    <Icon name="chevronRight" className="w-4 h-4 text-ink-faint transition-transform group-open:rotate-90" />
                    Everything the research found
                    <span className="text-sm font-normal text-ink-faint">{verified.length + d.observations.length} facts · {d.pages.length} pages</span>
                  </summary>
                  <div className="px-5 pb-5 space-y-5">
                    {d.observations.length > 0 && (
                      <Card title="What their website shows" padded={false}>
                        <ul className="divide-y divide-line">
                          {d.observations.map((o) => (
                            <li key={o.id} className="px-5 py-3 text-sm">
                              <div className="flex items-start gap-2">
                                <Badge tone={o.kind === "limitation" ? "warn" : o.kind === "capability" ? "ok" : "neutral"}>{{ offering: "Offering", process: "How it works", capability: "Online today", limitation: "Limitation they state" }[o.kind] ?? o.kind}</Badge>
                                <span className="min-w-0">{o.statement}</span>
                              </div>
                              <p className="text-xs text-ink-faint mt-1">
                                “{o.evidenceQuote}”{" "}
                                <a href={o.sourceUrl} target="_blank" rel="noreferrer">
                                  source
                                </a>
                              </p>
                            </li>
                          ))}
                        </ul>
                      </Card>
                    )}
                    {d.latest && (
                      <Card title="Research coverage" description={`What was actually read${b.investigatedAt ? ` · ${researchAgeDays(b.investigatedAt)} day(s) ago` : ""}${isResearchStale(b.investigatedAt) ? " · stale, consider re-investigating" : ""}`}>
                        <div className="grid sm:grid-cols-4 gap-3 text-sm">
                          {[
                            { k: "Pages read", v: `${d.pages.filter((p) => !p.error).length} of ${d.pages.length}` },
                            { k: "Firecrawl credits", v: d.pages.length && d.pages.every((p) => p.renderer === "stored") ? "0 · stored pages" : String(d.latest.creditsUsed) },
                            { k: "Facts verified", v: String(d.facts.filter((f) => f.status === "verified").length) },
                            { k: "Off-site records", v: String(d.facts.filter((f) => ["domain_registered", "site_first_seen", "email_provider", "email_senders"].includes(f.key) && f.status === "verified").length) },
                          ].map((x) => (
                            <div key={x.k}>
                              <div className="text-xs text-ink-muted">{x.k}</div>
                              <div className="font-semibold tabular-nums">{x.v}</div>
                            </div>
                          ))}
                        </div>
                        {b.website && (
                          <div className="flex flex-wrap gap-2 mt-3">
                            <form action={investigateAction}>
                              <input type="hidden" name="businessId" value={b.id} />
                              <input type="hidden" name="mode" value="recrawl" />
                              <button className="btn btn-sm" title="Fetch the website again through Firecrawl (one credit per page)">Research again</button>
                            </form>
                            {d.pages.some((p) => p.hasHtml) && (
                              <form action={investigateAction}>
                                <input type="hidden" name="businessId" value={b.id} />
                                <input type="hidden" name="mode" value="reanalyze" />
                                <button className="btn btn-sm btn-ghost" title="Run the detectors again on the stored pages; costs no credits">Re-analyze stored pages</button>
                              </form>
                            )}
                          </div>
                        )}
                        {d.pages.some((p) => p.error) && (
                          <ul className="text-xs text-ink-muted mt-3 space-y-0.5">
                            {d.pages.filter((p) => p.error).map((p) => (
                              <li key={p.id} className="truncate">
                                <span className="text-warn">{p.error}</span> · {p.url}
                              </li>
                            ))}
                          </ul>
                        )}
                        {(d.latest.notes?.length ?? 0) > 0 && (
                          <details className="mt-3 text-xs">
                            <summary className="disclosure text-ink-muted">Investigation log ({d.latest.notes!.length})</summary>
                            <ol className="list-decimal pl-4 mt-1 space-y-0.5 text-ink-muted">
                              {d.latest.notes!.map((n, i) => (
                                <li key={i}>{n}</li>
                              ))}
                            </ol>
                          </details>
                        )}
                      </Card>
                    )}
                    {d.facts.length > 0 && (
                      <Card title="Verified facts" padded={false}>
                        {FACT_GROUPS.map((g) => {
                          const fields = FACT_FIELDS.filter((f) => f.group === g.key && f.key !== "summary");
                          const rows = fields.map((f) => ({ field: f, fact: factByKey.get(f.key) })).filter((r) => r.fact?.status === "verified");
                          if (!rows.length) return null;
                          return (
                            <div key={g.key} className="px-5 py-4 border-b border-line last:border-b-0">
                              <div className="label mb-2">{g.label}</div>
                              <dl className="divide-y divide-line">
                                {rows.map(({ field, fact }) => (
                                  <div key={field.key} className="grid md:grid-cols-[200px_1fr] gap-x-4 gap-y-1 py-2 text-sm">
                                    <dt className="text-ink-muted flex items-center gap-1.5">
                                      {fact!.status === "verified" ? <Icon name="check" className="w-3.5 h-3.5 text-ok" /> : <Icon name="minus" className="w-3.5 h-3.5 text-warn" />}
                                      {field.label}
                                    </dt>
                                    <dd className="min-w-0">
                                      {fact!.status === "verified" ? (
                                        <>
                                          <span className="font-medium">{factValueLabel(fact!.value)}</span>
                                          {(fact!.evidenceQuote || fact!.sourceUrl) && (
                                            <div className="text-xs text-ink-muted mt-0.5">
                                              {fact!.evidenceQuote && fact!.evidenceQuote !== fact!.value && <q className="italic">{fact!.evidenceQuote}</q>}{" "}
                                              {fact!.sourceUrl && (
                                                <a href={fact!.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 whitespace-nowrap">
                                                  source <Icon name="external" className="w-3 h-3" />
                                                </a>
                                              )}
                                              <Badge className="ml-1" tone={fact!.method === "ai" ? "accent" : "neutral"}>{fact!.method === "detected" ? "detected" : fact!.method === "ai" ? "AI · quote verified" : fact!.method}</Badge>
                                            </div>
                                          )}
                                        </>
                                      ) : (
                                        <span className="text-warn">Not found on the site{fact!.evidenceQuote ? <span className="text-ink-faint"> · {fact!.evidenceQuote}</span> : null}</span>
                                      )}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          );
                        })}
                      </Card>
                    )}
                    {gaps.length > 0 && (
                      <Callout tone="neutral" icon="info" title={`${gaps.length} thing${gaps.length === 1 ? "" : "s"} looked for and not found on the site`}>
                        {gaps.map((g) => factLabel(g.key)).join(" · ")}. Not finding something proves nothing about how they work: these are questions to ask, never statements.
                      </Callout>
                    )}
                    {d.pages.length > 0 && (
                      <details>
                        <summary className="disclosure text-xs text-ink-muted px-1 mb-2">Show the {d.pages.length} page{d.pages.length === 1 ? "" : "s"} that were read</summary>
                      <Card title="Pages read" description={d.latest ? `Latest investigation · ${fmtDate(d.latest.startedAt)} · ${d.latest.pagesFetched} fetched, ${d.latest.pagesFailed} failed · ${d.latest.creditsUsed} Firecrawl credit(s)${d.latest.model ? ` · model ${d.latest.model} · $${d.latest.costUsd.toFixed(3)}` : ""}` : undefined} padded={false}>
                        {d.pages.length === 0 ? (
                          <EmptyState compact icon="file" title="No pages fetched" />
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Kind</th>
                                  <th>URL</th>
                                  <th>Status</th>
                                  <th className="text-right">Text</th>
                                </tr>
                              </thead>
                              <tbody>
                                {d.pages.map((p) => (
                                  <tr key={p.id}>
                                    <td>
                                      <Badge>{p.kind}</Badge>
                                      {p.renderer === "stored" && <Badge className="ml-1" tone="neutral" title="Reused from an earlier investigation; no credits">stored</Badge>}
                                    </td>
                                    <td className="text-xs max-w-[420px]">
                                      <a href={p.url} target="_blank" rel="noreferrer" className="truncate block">
                                        {p.url}
                                      </a>
                                      {p.title && <div className="text-ink-faint truncate">{p.title}</div>}
                                    </td>
                                    <td className="text-xs">{p.error ? <span className="text-bad">{p.error}</span> : <span className="text-ok">{p.statusCode}</span>}</td>
                                    <td className="text-xs text-right tabular-nums">{p.textLength.toLocaleString()} chars</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {d.latest?.notes?.length ? <p className="text-xs text-ink-faint px-5 py-3 border-t border-line">{d.latest.notes.join(" · ")}</p> : null}
                      </Card>
                      </details>
                    )}
                  </div>
                </details>
              )}
            </Step>

            <Step n={2} title="Idea" state={!researched ? "later" : liveDrafts.length > 0 || emailed ? "done" : "now"} status={primary ? primary.title : researched ? "No idea found" : ""}>
              {primary && (
                <Card
                  title={primary.title}
                  description={
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <Badge tone="accent">The one idea to raise</Badge>
                      {primary.scope && <Badge tone={primary.scope === "existing" ? "neutral" : "info"}>{SOLUTION_SCOPES[primary.scope as SolutionScope] ?? primary.scope}</Badge>}
                      <Badge>{OPPORTUNITY_CATEGORIES[primary.category as OpportunityCategory] ?? primary.category}</Badge>
                      <Badge tone={primary.source === "ai" ? "info" : "neutral"} title={primary.source === "ai" ? "Written by the model from the research; every citation was checked in code" : "Grouped from fixed rule patterns; no model reviewed it"}>
                        {primary.source === "ai" ? "AI, evidence checked" : "rule-based"}
                      </Badge>
                      <Badge>{primary.implementationEffort} effort</Badge>
                    </span>
                  }
                  actions={
                    <div className="flex gap-2">
                      <ScoreRing value={primary.attractivenessScore} label="Attractive" size={44} />
                      <ScoreRing value={primary.confidenceScore} label="Confidence" size={44} tone={primary.confidenceScore < 60 ? "warn" : undefined} />
                    </div>
                  }
                >
                  <div className="text-sm">
                    {/* First: the idea as it would be said, what it is worth, and what to ask. */}
                    {primary.source === "ai" && primary.salesAngle ? (
                      <p className="letter-text text-ink">{primary.salesAngle}</p>
                    ) : (
                      <p className="text-[0.95rem] text-ink">{primary.proposedSolution}</p>
                    )}
                    <div className="grid md:grid-cols-2 gap-x-6 gap-y-4 mt-5 mb-5">
                      {primary.expectedValue && <Field label="What it would be worth to them">{primary.expectedValue}</Field>}
                      <ListField label="Questions to ask them" items={primary.validationQuestions} />
                    </div>
                    {/* Then the reasoning, each part behind its own heading. */}
                    <Fold title="Why this business" hint="what was noticed, and the problem it suggests">
                      <div className="space-y-4">
                        {primary.whyRelevant && <Field label="Why it fits them">{primary.whyRelevant}</Field>}
                        <Field label="The challenge" hint="a hypothesis to validate, not a fact">
                          {primary.problemHypothesis}
                        </Field>
                      </div>
                    </Fold>
                    <Fold title="What we could build" hint={`${(primary.components ?? []).length || "no"} part${(primary.components ?? []).length === 1 ? "" : "s"}`}>
                      <div className="space-y-4">
                        <p>{primary.proposedSolution}</p>
                        {(primary.components ?? []).length > 0 && (
                          <ul className="space-y-2.5">
                            {(primary.components ?? []).map((c) => (
                              <li key={c.name} className="rounded-lg border border-line p-3">
                                <div className="font-semibold">{c.name}</div>
                                <p className="text-ink-muted">{c.description}</p>
                                <EvidenceChips refs={c.evidence} factByKey={factByKey} obsByRef={obsByRef} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </Fold>
                    <Fold title="Evidence" hint={`${primary.supportingFactKeys.length} thing${primary.supportingFactKeys.length === 1 ? "" : "s"} from their website this idea rests on`}>
                      <EvidenceChips refs={primary.supportingFactKeys} factByKey={factByKey} obsByRef={obsByRef} />
                    </Fold>
                    <Fold title="Risks and open questions" hint="what could be wrong, and what to check">
                      <div className="grid md:grid-cols-2 gap-4">
                        {primary.whyNotExistingTool && (
                          <Field label="Why not an existing tool" muted>
                            {primary.whyNotExistingTool}
                          </Field>
                        )}
                        <ListField label="Unknown: assumptions to check" items={primary.assumptions} />
                        {primary.risks.length > 0 && <ListField label="Risks" items={primary.risks} />}
                      </div>
                    </Fold>
                    <Fold title="How the two scores were calculated" hint={`attractive ${primary.attractivenessScore}, confidence ${primary.confidenceScore}`}>
                      <div className="text-xs text-ink-muted">
                        <div className="grid md:grid-cols-2 gap-4 ">
                        {(["attractiveness", "confidence"] as const).map((k) => (
                          <ul key={k} className="space-y-1">
                            <li className="font-medium capitalize text-ink">{k}</li>
                            {primary.scoreBreakdown[k].map((f) => (
                              <li key={f.factor}>
                                {f.factor} ({Math.round(f.weight * 100)}%): <span className="tabular-nums">{f.score}</span>. {f.explanation}
                              </li>
                            ))}
                          </ul>
                        ))}
                      </div>
                      {primary.scoreBreakdown.notes.length > 0 && <p className="mt-2">{primary.scoreBreakdown.notes.join(" ")}</p>}
                      </div>
                    </Fold>
                  </div>
                </Card>
              )}
              {secondary.length > 0 && (
                <Card title="Other ideas you could offer" padded={false}>
                  <ul className="divide-y divide-line">
                    {secondary.map((o) => (
                      <li key={o.id} className="px-5 py-3 text-sm">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{o.title}</span>
                          {o.scope && <Badge tone={o.scope === "existing" ? "neutral" : "info"}>{SOLUTION_SCOPES[o.scope as SolutionScope] ?? o.scope}</Badge>}
                          <Badge>{OPPORTUNITY_CATEGORIES[o.category as OpportunityCategory] ?? o.category}</Badge>
                          <span className="text-xs text-ink-faint ml-auto tabular-nums">
                            attractive {o.attractivenessScore} · confidence {o.confidenceScore}
                          </span>
                        </div>
                        {o.source === "ai" && o.salesAngle && <p className="mt-1">{o.salesAngle}</p>}
                        <p className="text-ink-muted mt-1">{o.proposedSolution}</p>
                        <EvidenceChips refs={o.supportingFactKeys} factByKey={factByKey} obsByRef={obsByRef} />
                        {!emailed && (
                          <form action={chooseIdeaAction} className="mt-3">
                            <input type="hidden" name="businessId" value={b.id} />
                            <input type="hidden" name="opportunityId" value={o.id} />
                            <ConfirmButton confirmLabel="Raise this idea" className="btn btn-sm" message={`Raise “${o.title}” instead of the current idea?${liveDrafts.length ? " The unsent email about the current idea is withdrawn." : ""}${b.verdict === "qualified" && cfg.ai.enabled ? " A new email is written (about $0.05 of AI)." : ""}`}>
                              Raise this idea instead
                            </ConfirmButton>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {!primary && <div className="surface p-5 text-sm text-ink-muted">The research found no idea worth raising with this business.</div>}
            </Step>

            <Step n={3} title="Email" state={!primary ? "later" : emailed && openReplies === 0 ? "done" : "now"} status={emailed ? (openReplies > 0 ? `Emailed · ${openReplies} repl${openReplies === 1 ? "y" : "ies"} to answer` : `Emailed · ${stageLabel(stage)}`) : liveDrafts[0] ? ({ ready: "Written, ready to review", needs_review: "Written, needs review", approved: "Approved", excluded: "Excluded" }[liveDrafts[0].status] ?? "Written") : primary ? "Not written yet" : ""}>
              {liveDrafts.length === 0 && (
                <EmptyState
                  icon="mail"
                  title="No email yet"
                  action={
                    primary && cfg.ai.enabled && !busy ? (
                      <form action={generateDraftAction}>
                        <input type="hidden" name="businessId" value={b.id} />
                        <button className="btn btn-primary btn-sm">
                          <Icon name="mail" /> Write the email now
                        </button>
                      </form>
                    ) : undefined
                  }
                />
              )}
              {/* The conversation in the order it happened: what you sent, what they answered, and last what waits for you now. */}
              {thread.length > 0 && (
                <ol className="space-y-3" aria-label="Conversation">
                  {thread.map((t) =>
                    t.kind === "ours" ? (
                      <li key={t.draft.id} className={`surface overflow-hidden border-l-4 ${t.pending ? "border-l-accent" : "border-l-line-strong"}`}>
                        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-line">
                          <span className="text-sm font-semibold">{t.pending ? `${stepLabel(t.draft.step)} · waiting for you` : `You · ${stepLabel(t.draft.step).toLowerCase()}`}</span>
                          <StatusPill status={t.draft.status} label={t.draft.status === "failed" ? "Not sent" : undefined} />
                          <span className="text-xs text-ink-faint">{t.draft.sentAt ? fmtDate(t.draft.sentAt) : t.draft.scheduledAt && t.draft.status === "queued" ? `goes out ${fmtDate(t.draft.scheduledAt)}` : ""}</span>
                          <Link href={`/outreach/${t.draft.id}`} className={`btn btn-sm ml-auto ${t.pending ? "btn-primary" : ""}`}>
                            {t.pending ? "Review" : "Open"}
                          </Link>
                        </div>
                        <div className="px-5 py-4">
                          <div className="text-xs text-ink-faint mb-2">
                            {t.draft.step > 0 ? "Re: " : ""}
                            {t.draft.subject}
                            {t.draft.toEmail ? ` · to ${t.draft.toEmail}` : ""}
                          </div>
                          <p className="letter-text whitespace-pre-wrap">{t.draft.body}</p>
                          {t.draft.lastError && <p className="text-sm text-bad mt-2">{t.draft.lastError}</p>}
                        </div>
                      </li>
                    ) : (
                      <li key={t.msg.id} className="surface overflow-hidden border-l-4 border-l-ok bg-surface-2">
                        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-line">
                          <span className="text-sm font-semibold">{t.msg.fromName || t.msg.fromEmail || "They"}</span>
                          <Badge tone={t.msg.kind === "bounce" ? "bad" : t.msg.kind === "auto_reply" ? "neutral" : "info"}>{t.msg.kind === "bounce" ? "Bounce" : t.msg.kind === "auto_reply" ? "Automatic reply" : "Reply"}</Badge>
                          {t.msg.classification && <Badge tone={REPLY_TONE[t.msg.classification] ?? "neutral"}>{REPLY_LABEL[t.msg.classification] ?? t.msg.classification}</Badge>}
                          {t.msg.handledAt && <Badge tone="ok">handled</Badge>}
                          <span className="text-xs text-ink-faint ml-auto">{fmtDate(t.msg.receivedAt)}</span>
                        </div>
                        <div className="px-5 py-4">
                          <p className="letter-text whitespace-pre-wrap">{stripQuoted(t.msg.bodyText).slice(0, 3000)}</p>
                          {t.msg.kind === "reply" && (
                            <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-line">
                              <form action={markReplyHandledAction}>
                                <input type="hidden" name="inboundId" value={t.msg.id} />
                                <input type="hidden" name="returnTo" value={`/businesses/${b.id}`} />
                                <button className="btn btn-sm">{t.msg.handledAt ? "Reopen" : "Mark as handled"}</button>
                              </form>
                              {t.msg.fromEmail && (
                                <a className="btn btn-sm btn-ghost" href={`mailto:${t.msg.fromEmail}?subject=${encodeURIComponent(/^re:/i.test(t.msg.subject ?? "") ? (t.msg.subject ?? "") : `Re: ${t.msg.subject ?? ""}`)}`}>
                                  Answer in my mail program
                                </a>
                              )}
                              <form action={reclassifyReplyAction} className="flex items-center gap-1.5 ml-auto">
                                <input type="hidden" name="inboundId" value={t.msg.id} />
                                <input type="hidden" name="returnTo" value={`/businesses/${b.id}`} />
                                <select name="category" className="select h-8 !min-h-0 text-xs w-auto" defaultValue={t.msg.classification ?? "other"} aria-label="What the reply says">
                                  {Object.entries(REPLY_LABEL).map(([k, v]) => (
                                    <option key={k} value={k}>
                                      {v}
                                    </option>
                                  ))}
                                </select>
                                <button className="btn btn-sm btn-ghost">Correct</button>
                              </form>
                            </div>
                          )}
                        </div>
                      </li>
                    ),
                  )}
                </ol>
              )}
            </Step>
          </ol>

            {/* The whole history with its filters, when asked for from the short list on the right. */}
            {showAllHistory && (
              <section className="surface overflow-hidden" id="history" aria-label="All history">
                <div className="flex items-center gap-2 px-5 py-3.5">
                  <h2 className="text-[0.95rem] font-semibold">All history</h2>
                  <span className="text-sm text-ink-faint">{d.activityCount}</span>
                  <Link href={`/businesses/${b.id}`} className="ml-auto text-sm">Close</Link>
                </div>
                <div id="activity" className="scroll-mt-4 border-t border-line">
                  <form action={addNoteAction} className="flex flex-wrap gap-2 p-5 border-b border-line bg-surface-2">
                    <input type="hidden" name="businessId" value={b.id} />
                    <select className="select w-36" name="type" defaultValue="note">
                      <option value="note">Note</option>
                      <option value="call">Call</option>
                      <option value="email">Email sent</option>
                      <option value="meeting">Meeting</option>
                    </select>
                    <input className="input flex-1 min-w-[160px]" name="content" placeholder="Add a note, call or meeting" required />
                    <button className="btn btn-primary">
                      <Icon name="plus" /> Add
                    </button>
                  </form>
                  {d.activityCount === 0 ? (
                    <EmptyState compact icon="note" title="No activity yet" />
                  ) : (
                    activity && (
                      <ActivityTimeline
                        activities={activity.items}
                        kind={activityKind}
                        kindHref={(k) => activityHref(k)}
                        counts={kindCounts(activity.countsByType)}
                        pagination={{ page: activityPage, pageSize: ACTIVITY_PAGE_SIZE, total: activity.total, href: (p) => activityHref(activityKind, p) }}
                      />
                    )
                  )}
                </div>
              </section>
            )}
          </div>
          <aside className="min-w-0 space-y-4" aria-label="Status and history">
          <section className="surface" aria-label="Stage and next action">
            <div className="px-5 pt-4 pb-4">
              <h2 className="text-[0.95rem] font-semibold mb-2.5">Stage</h2>
              <form action={updateStageAction} className="flex gap-2">
                <input type="hidden" name="businessId" value={b.id} />
                <label className="sr-only" htmlFor="stage">
                  Move to stage
                </label>
                <select id="stage" className="select" name="stage" defaultValue={stage}>
                  {PIPELINE_STAGES.map((st) => (
                    <option key={st.key} value={st.key}>
                      {st.label}
                    </option>
                  ))}
                </select>
                <button className="btn shrink-0">Move</button>
              </form>
            </div>
            {(() => {
              const na = d.prospect?.nextAction ?? null;
              const prio = d.prospect?.priority ?? "normal";
              const due = d.prospect?.nextActionAt ? new Date(d.prospect.nextActionAt) : null;
              const when = dueTag(d.prospect?.nextActionAt);
              const form = (
                <form action={setNextActionAction} className="space-y-3 mt-3">
                  <input type="hidden" name="businessId" value={b.id} />
                  <div>
                    <label className="label" htmlFor="nextAction">
                      What to do
                    </label>
                    <input id="nextAction" className="input" name="nextAction" defaultValue={na ?? ""} placeholder="e.g. Call about the estimate" />
                  </div>
                  <fieldset>
                    <legend className="label">When</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {DUE_CHOICES.map((c) => (
                        <label key={c.days} className="chip cursor-pointer has-[:checked]:bg-accent-soft has-[:checked]:text-accent-text has-[:checked]:border-transparent">
                          <input type="radio" name="dueIn" value={c.days} className="sr-only" />
                          {c.label}
                        </label>
                      ))}
                    </div>
                    <input id="nextActionAt" className="input mt-2" type="datetime-local" name="nextActionAt" defaultValue={d.prospect?.nextActionAt ? toLocalInput(d.prospect.nextActionAt) : ""} aria-label="Or an exact date and time" />
                  </fieldset>
                  <div>
                    <label className="label" htmlFor="priority">
                      Priority
                    </label>
                    <select id="priority" className="select" name="priority" defaultValue={prio}>
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  <button className="btn btn-primary btn-sm">Save</button>
                </form>
              );
              return (
                <div className="border-t border-line px-5 pt-4 pb-5">
                  <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-[0.95rem] font-semibold">Next action</h2>
                    {na && when && <Badge tone={when.tone}>{when.label}</Badge>}
                    {na && prio === "high" && <Badge tone="warn">High priority</Badge>}
                  </div>
                  {na ? (
                    <>
                      <p className="text-sm font-medium leading-snug">{na}</p>
                      {due && <p className="text-xs text-ink-muted mt-1">{due.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>}
                      {/* Done and Change side by side; the form opens under them. */}
                      <details className="mt-3 group/plan">
                        <summary className="list-none flex items-center gap-2 select-none">
                          <button form="next-action-done" className="btn btn-sm btn-primary">
                            <Icon name="check" /> Done
                          </button>
                          <span className="btn btn-sm cursor-pointer">
                            Change <Icon name="chevronDown" className="w-3.5 h-3.5 transition-transform group-open/plan:rotate-180" />
                          </span>
                        </summary>
                        {form}
                      </details>
                      <form id="next-action-done" action={completeNextActionAction}>
                        <input type="hidden" name="businessId" value={b.id} />
                      </form>
                    </>
                  ) : (
                    <details className="group/plan">
                      <summary className="btn btn-sm w-fit list-none cursor-pointer select-none">
                        Plan a next action <Icon name="chevronDown" className="w-3.5 h-3.5 transition-transform group-open/plan:rotate-180" />
                      </summary>
                      {form}
                    </details>
                  )}
                </div>
              );
            })()}
          </section>

          <section className="surface" aria-label="History">
            <div className="flex items-center gap-2 px-5 pt-4">
              <h2 className="text-[0.95rem] font-semibold">History</h2>
              <span className="text-sm text-ink-faint">{d.activityCount}</span>
              {d.activityCount > recent.items.length && (
                <Link href={`/businesses/${b.id}?tab=activity#history`} className="ml-auto text-sm">
                  Show all
                </Link>
              )}
            </div>
            <form action={addNoteAction} className="flex gap-2 px-5 pt-3">
              <input type="hidden" name="businessId" value={b.id} />
              <input type="hidden" name="type" value="note" />
              <input className="input h-9 flex-1 min-w-0" name="content" placeholder="Add a note" required aria-label="Add a note" />
              <button className="btn btn-sm h-9">Add</button>
            </form>
            {recent.items.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-faint">Nothing yet.</p>
            ) : (
              <ol className="px-5 py-4 space-y-3">
                {recent.items.map((a) => (
                  <li key={a.id} className="flex gap-3 text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-line-strong mt-2 shrink-0" aria-hidden />
                    <div className="min-w-0">
                      <div className="line-clamp-2" title={a.content}>{a.content.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (k) => (PIPELINE_STAGES.some((st) => st.key === k) ? stageLabel(k).toLowerCase() : k))}</div>
                      <div className="text-xs text-ink-faint">{fmtRelative(a.createdAt)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>


          <details className="surface">
            <summary className="px-5 py-3.5 text-[0.9rem] font-semibold select-none flex items-center gap-2">
              <Icon name="chevronRight" className="chevron w-3.5 h-3.5 text-ink-faint transition-transform" />
              Where it came from
            </summary>
            <div className="px-5 pb-5">
            <div className="flex items-start gap-3">
              {b.leadScore != null ? <ScoreRing value={b.leadScore} label="Lead" size={44} /> : <span className="text-ink-faint text-xs">no lead score</span>}
              <div className="min-w-0 text-xs space-y-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge tone={b.kind === "chain" ? "warn" : b.kind === "independent" ? "ok" : "neutral"}>{b.kind === "chain" ? "chain / franchise" : b.kind === "independent" ? "independent" : "kind unknown"}</Badge>
                  {b.operatingStatus && b.operatingStatus !== "unknown" && <Badge tone={b.operatingStatus === "closed" ? "bad" : "ok"}>{b.operatingStatus}</Badge>}
                  {b.brand && <Badge tone="info" title="Brand attached by the discovery source">{b.brand}</Badge>}
                </div>
                {(b.leadReasons?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {/* What counted for the score in green, what counted against it in amber. */}
                    {b.leadReasons!.map((r) => (
                      <Badge key={r} tone={/^no |\bno \w+ yet|chain|franchise|closed|missing|without/i.test(r) ? "warn" : "ok"}>
                        {r}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-line text-xs">
              <div className="label">Searches</div>
              {d.foundBy.length === 0 ? (
                <p className="text-ink-faint">Not from a search: imported or added by hand.</p>
              ) : (
                <ul className="space-y-1">
                  {d.foundBy.map((f) => (
                    <li key={f.searchId} className="flex items-center gap-1.5 min-w-0">
                      <Link href={`/searches/${f.searchId}`} className="truncate">
                        {f.name}
                      </Link>
                      <Badge tone="accent">#{f.rank}</Badge>
                      <span className="text-ink-faint shrink-0">{fmtRelative(f.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-line text-xs">
              <div className="label">Source records</div>
              <ul className="space-y-1.5">
                {d.sources.map((s) => (
                  <li key={s.id} className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Badge tone={s.provider === "google_maps" ? "info" : "neutral"}>{s.provider === "google_maps" ? "Google Maps" : s.provider === "overture" ? "Overture Maps" : s.provider === "osm" ? "OpenStreetMap" : s.provider === "csv" ? "CSV / manual" : s.provider}</Badge>
                      {s.sourceUrl ? (
                        <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="truncate inline-flex items-center gap-0.5" title={s.providerId ?? undefined}>
                          open listing <Icon name="external" className="w-3 h-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="truncate text-ink-faint" title={s.providerId ?? undefined}>
                          {s.providerId}
                        </span>
                      )}
                      <span className="text-ink-faint shrink-0 ml-auto">{fmtRelative(s.discoveredAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-3 pt-3 border-t border-line text-xs text-ink-faint flex flex-wrap gap-1.5 items-center">
              <StatusPill status={b.status} />
              {b.statusMessage && <span>{b.statusMessage}</span>}
            </div>
            </div>
          </details>
          </aside>
        </div>
      </div>
    </>
  );
}

/** One way to reach the business, in the line under its name. */
function ContactItem({ icon, children }: { icon: React.ComponentProps<typeof Icon>["name"]; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 min-w-0">
      <Icon name={icon} className="w-4 h-4 shrink-0 text-ink-faint" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/**
 * One step of the work on a business. "now" is open, "done" folds to its heading (a click opens it again),
 * "later" is only a heading: there is nothing to do there yet.
 */
function Step({ n, title, status, state, children }: { n: number; title: string; status: string; state: "done" | "now" | "later"; children?: React.ReactNode }) {
  const head = (
    <>
      <span className={`w-7 h-7 rounded-full grid place-items-center text-sm font-bold shrink-0 ${state === "done" ? "bg-ok text-accent-fg" : state === "now" ? "bg-accent text-accent-fg" : "bg-surface-3 text-ink-faint border border-line-strong"}`}>{state === "done" ? <Icon name="check" className="w-4 h-4" /> : n}</span>
      <span className={`text-lg font-semibold ${state === "later" ? "text-ink-faint" : ""}`}>{title}</span>
      {status && <span className={`text-sm truncate ${state === "now" ? "text-ink-muted" : "text-ink-faint"}`}>{status}</span>}
    </>
  );
  if (state === "later") return <li className="flex items-center gap-3 px-1 py-1">{head}</li>;
  return (
    <li>
      <details open={state === "now" || undefined} className="group/step">
        <summary className="flex items-center gap-3 px-1 py-1 cursor-pointer select-none list-none">
          {head}
          <Icon name="chevronRight" className="w-4 h-4 ml-auto shrink-0 text-ink-faint transition-transform group-open/step:rotate-90" />
        </summary>
        <div className="mt-3 space-y-4">{children}</div>
      </details>
    </li>
  );
}

/** A part of the page that opens on a click: its heading and a few words on what is inside. */
function Fold({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <details className="border-t border-line">
      <summary className="flex items-center gap-2 py-3 cursor-pointer select-none hover:text-accent-text">
        <Icon name="chevronRight" className="chevron w-4 h-4 shrink-0 text-ink-faint transition-transform" />
        <span className="text-[0.95rem] font-semibold">{title}</span>
        {hint && /\d/.test(hint) && <span className="text-sm text-ink-faint truncate">{hint}</span>}
      </summary>
      <div className="pb-5 pl-6">{children}</div>
    </details>
  );
}

function Field({ label, hint, children, muted }: { label: string; hint?: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <div>
      <div className="label">
        {label} {hint && <span className="normal-case font-normal text-ink-faint">({hint})</span>}
      </div>
      <p className={muted ? "text-ink-muted" : ""}>{children}</p>
    </div>
  );
}
function ListField({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="label">{label}</div>
      {items.length ? (
        <ul className="list-disc pl-4 text-xs text-ink-muted space-y-0.5">
          {items.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-faint">none listed</p>
      )}
    </div>
  );
}
function ContactRow({ icon, label, children }: { icon: "mail" | "phone" | "globe" | "building"; label: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 min-w-0">
      <span className="w-7 h-7 rounded-lg bg-surface-3 text-ink-muted grid place-items-center shrink-0" title={label}>
        <Icon name={icon} className="w-3.5 h-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-ink-muted leading-tight">{label}</div>
        <div className="min-w-0 leading-snug">{children}</div>
      </div>
    </li>
  );
}
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type FactRow = { key: string; status: string; value: string | null; evidenceQuote: string | null; sourceUrl: string | null };
type ObsRow = { ref: string; kind: string; statement: string; evidenceQuote: string; sourceUrl: string };

/** What an idea rests on, in three kinds that are never mixed: verified facts, observations, and things not seen on the site. */
function EvidenceChips({ refs, factByKey, obsByRef }: { refs: string[]; factByKey: Map<string, FactRow>; obsByRef: Map<string, ObsRow> }) {
  if (!refs.length) return <p className="text-xs text-ink-faint mt-1">Nothing cited.</p>;
  return (
    <ul className="mt-1.5 space-y-1">
      {refs.map((r) => {
        const o = obsByRef.get(r);
        const f = factByKey.get(r);
        if (o)
          return (
            <li key={r} className="text-xs border-l-2 border-ok/50 pl-2">
              <span className="text-ok font-medium">Observed.</span> {o.statement} <span className="text-ink-faint">“{o.evidenceQuote.slice(0, 200)}”</span>{" "}
              <a href={o.sourceUrl} target="_blank" rel="noreferrer">
                source
              </a>
            </li>
          );
        if (f && f.status === "verified")
          return (
            <li key={r} className="text-xs border-l-2 border-ok/50 pl-2">
              <span className="text-ok font-medium">Verified.</span> {factLabel(r)}
              {f.value && f.value !== "yes" ? `: ${factValueLabel(f.value)}` : ""} {f.evidenceQuote && <span className="text-ink-faint">“{f.evidenceQuote.slice(0, 200)}”</span>}{" "}
              {f.sourceUrl && (
                <a href={f.sourceUrl} target="_blank" rel="noreferrer">
                  source
                </a>
              )}
            </li>
          );
        if (f)
          return (
            <li key={r} className="text-xs border-l-2 border-warn/50 pl-2">
              <span className="text-warn font-medium">Not seen on their site.</span> {factLabel(r)}. Proves nothing about how they work: something to ask.
            </li>
          );
        return null;
      })}
    </ul>
  );
}
