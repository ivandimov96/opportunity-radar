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

const TABS = ["opportunities", "profile", "outreach", "activity"] as const;
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
  const TAB_LABEL: Record<Tab, string> = { opportunities: "Overview", profile: "Research", outreach: "Emails", activity: "Activity" };
  const stage = d.prospect?.stage ?? "discovered";
  const tabHref = (t: Tab) => `/businesses/${b.id}?tab=${t}`;
  const activityKind: ActivityKind = ACTIVITY_KINDS.some((k) => k.key === sp.kind) ? (sp.kind as ActivityKind) : "all";
  const activityPage = Math.max(1, Math.floor(Number(sp.page) || 1));
  const ACTIVITY_PAGE_SIZE = 25;
  const activityHref = (k: ActivityKind, page = 1) => `${tabHref("activity")}${k === "all" ? "" : `&kind=${k}`}${page > 1 ? `&page=${page}` : ""}#activity`;
  const outreachHistory = tab === "outreach" ? await businessActivities(b.id, { types: ["email", "call", "meeting", "note"], page: 1, pageSize: 8 }) : null;
  const activity = tab === "activity" ? await businessActivities(b.id, { types: ACTIVITY_KINDS.find((k) => k.key === activityKind)?.types, page: activityPage, pageSize: ACTIVITY_PAGE_SIZE }) : null;

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

  /** The way from found to won, and how many of its steps this business has completed. */
  const JOURNEY = ["Found", "Researched", "Qualified", "Emailed", "Replied", "Meeting", "Won"];
  const reached = stage === "won" ? 7 : stage === "meeting_scheduled" || stage === "proposal_sent" ? 6 : stage === "replied" ? 5 : stage === "contacted" || stage === "lost" ? 4 : stage === "qualified" || stage === "ready_to_contact" || b.verdict === "qualified" ? 3 : b.investigatedAt ? 2 : 1;

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/businesses", label: "Businesses" }, { label: b.name }]}
        title={
          <span className="flex items-center gap-2 flex-wrap">
            {b.name}
            <StatusPill status={b.verdict ?? b.status} />
            <Badge tone={stageTone(stage)}>{stageLabel(stage)}</Badge>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{getPlaybook(b.industry).label}{b.category ? ` · ${b.category}` : ""}</span>
            <span className="text-ink-faint">{[b.street, b.city, b.region, b.postalCode].filter(Boolean).join(", ") || "address unknown"}</span>
            {b.website ? (
              <a href={b.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1">
                {b.websiteDomain ?? b.website} <Icon name="external" className="w-3 h-3" />
              </a>
            ) : (
              <span className="text-warn">no website</span>
            )}
          </span>
        }
        actions={
          <>
            <AutoRefresh active={busy} label={b.statusMessage ?? "Investigating"} />
            {!busy && <PrimaryAction />}
            {!busy && b.website && b.status === "profiled" && (
              <form action={investigateAction}>
                <input type="hidden" name="businessId" value={b.id} />
                <button className="btn btn-ghost" disabled={!cfg.firecrawl.enabled} title={cfg.firecrawl.enabled ? "Fetch the website again and rebuild the profile" : "Website research needs FIRECRAWL_API_KEY"}>
                  <Icon name="refresh" /> Research again
                </button>
              </form>
            )}
            {!busy && !emailed && (
              <form action={removeBusinessAction}>
                <input type="hidden" name="businessId" value={b.id} />
                <input type="hidden" name="returnTo" value="/businesses" />
                <ConfirmButton confirmLabel="Remove" danger className="btn btn-ghost btn-danger" message={`Remove ${b.name}? Its research and any unsent email are deleted, and future searches will leave it out. You can allow it again under Settings.`}>
                  <Icon name="x" /> Remove
                </ConfirmButton>
              </form>
            )}
          </>
        }
      />
      <Flash msg={sp.ok} />
      <Flash msg={sp.error} tone="bad" />

      <div className="surface px-5 py-4 mb-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className={`w-10 h-10 rounded-lg grid place-items-center shrink-0 ${{ accent: "bg-accent-soft text-accent-text", ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", neutral: "bg-surface-3 text-ink-muted", info: "bg-info-soft text-info" }[wf.next.tone]}`}>
            <Icon name={wf.next.tone === "warn" ? "alert" : wf.next.tone === "ok" ? "check" : wf.next.kind === "wait" ? "clock" : "arrowRight"} />
          </span>
          <div className="min-w-[220px] flex-1">
            <div className="text-sm font-semibold text-accent-text">Next step</div>
            <div className="text-lg font-semibold leading-snug">{wf.next.title}</div>
            <div className="text-sm text-ink-muted mt-0.5">{wf.next.description}</div>
          </div>
          {/* Where this business is on the way from found to won. */}
        <ol className="flex items-start gap-0 basis-full lg:basis-0 lg:flex-1 lg:min-w-[30rem] mt-3 pt-4 border-t border-line lg:mt-0 lg:pt-0 lg:border-t-0 overflow-x-auto no-scrollbar" aria-label="Progress">
          {JOURNEY.map((step, i) => {
            const done = i < reached - 1;
            const now = i === reached - 1;
            return (
              <li key={step} className="flex-1 min-w-[4.75rem] flex flex-col items-center text-center relative">
                {i > 0 && <span className={`absolute top-3 right-1/2 w-full h-0.5 -z-0 ${i <= reached - 1 ? "bg-ok" : "bg-line-strong"}`} aria-hidden />}
                <span className={`relative z-10 w-6 h-6 rounded-full grid place-items-center text-xs font-bold ${done ? "bg-ok text-accent-fg" : now ? (stage === "lost" ? "bg-bad text-accent-fg" : "bg-accent text-accent-fg") : "bg-surface-3 text-ink-faint border border-line-strong"}`}>{done ? <Icon name="check" className="w-3.5 h-3.5" /> : i + 1}</span>
                <span className={`text-xs mt-1.5 ${now ? "font-semibold text-ink" : done ? "text-ink-muted" : "text-ink-faint"}`}>{step}</span>
              </li>
            );
          })}
        </ol>
      </div>
      </div>

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

      <Tabs items={TABS.map((t) => ({ href: tabHref(t), label: TAB_LABEL[t], count: counts[t], active: tab === t }))} />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="min-w-0 space-y-5">
          {tab === "profile" && (
            <>
              {d.observations.length > 0 && (
                <Card title="What their website shows" description="Things the pages state that matter for how they work, each with their own words. Limitations are things a page says, never things that were merely not found." padded={false}>
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
                      <summary className="cursor-pointer text-ink-muted">Investigation log ({d.latest.notes!.length})</summary>
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
                <Card title="Verified facts" description="Each one with the words it was read from and a link to the page." padded={false}>
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
                  <summary className="text-xs text-ink-muted select-none px-1 mb-2">Show the {d.pages.length} page{d.pages.length === 1 ? "" : "s"} that were read</summary>
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
            </>
          )}

          {tab === "opportunities" && (
            <>
              <Card title="What this business does" description={d.latest ? `Investigated ${fmtRelative(d.latest.finishedAt ?? d.latest.startedAt)} · ${d.latest.pagesFetched} pages · ${verified.length} verified facts${d.latest.durationMs ? ` · took ${fmtDuration(d.latest.durationMs)}` : ""}` : undefined}>
                {b.summary ? (
                  <p className="text-sm leading-relaxed">{b.summary}</p>
                ) : d.facts.length ? (
                  <p className="text-sm text-ink-muted">{cfg.ai.enabled ? "No summary could be verified from the site." : "Summary needs the AI step (ANTHROPIC_API_KEY). Detected facts are below."}</p>
                ) : (
                  <EmptyState compact icon="sparkles" title="Not investigated yet" description={b.website ? "Investigate to fetch the website and public records, build the profile and analyze opportunities in one step." : b.status === "no_website" ? "No website could be located; add one if you know it." : "No website on record: investigating will first try to locate one."} />
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
                <Card title="Other ideas you could offer" description="Different from the main one. Pick one to raise it instead: the email is then written about that idea." padded={false}>
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
            </>
          )}

          {tab === "outreach" && (
            <>
              {liveDrafts.length === 0 && (
                <EmptyState
                  icon="mail"
                  title="No email yet"
                  description={!primary ? "Research the business first: an email is written from one solid idea." : b.verdict === "qualified" ? (cfg.ai.enabled ? "It is written automatically and appears here when it has passed its checks." : "Writing emails needs a model key (ANTHROPIC_API_KEY).") : "Emails are written automatically for qualified businesses. You can also have one written now."}
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
              {liveDrafts.map((dr) => (
                <Card
                  key={dr.id}
                  title={
                    <span className="flex items-center gap-2 flex-wrap">
                      {dr.step > 0 ? "Follow-up" : "First email"} <StatusPill status={dr.status} label={dr.status === "failed" ? "Not sent" : undefined} />
                    </span>
                  }
                  description={`${dr.subject ?? ""}${dr.toEmail ? ` · to ${dr.toEmail}` : ""}${dr.sentAt ? ` · sent ${fmtDate(dr.sentAt)}` : dr.scheduledAt && dr.status === "queued" ? ` · scheduled ${fmtDate(dr.scheduledAt)}` : ""}`}
                  actions={
                    <Link href={`/outreach/${dr.id}`} className="btn btn-sm">
                      {["needs_review", "ready", "approved"].includes(dr.status) ? "Review" : "Open"}
                    </Link>
                  }
                >
                  <p className="letter-text whitespace-pre-wrap">{dr.body}</p>
                  {dr.lastError && <p className="text-xs text-bad mt-3">{dr.lastError}</p>}
                </Card>
              ))}
              {d.inbound.length > 0 && (
                <Card title="What they wrote back" description="Picked up from your inbox. The original text is kept as it arrived; the label is a reading you can correct." padded={false}>
                  <ul className="divide-y divide-line">
                    {d.inbound.map((m) => (
                      <li key={m.id} className="px-5 py-4 text-sm" data-inbound={m.id}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge tone={m.kind === "bounce" ? "bad" : m.kind === "auto_reply" ? "neutral" : "info"}>{m.kind === "bounce" ? "Bounce" : m.kind === "auto_reply" ? "Automatic reply" : "Reply"}</Badge>
                          <span className="font-medium">{m.fromName || m.fromEmail}</span>
                          {m.classification && (
                            <Badge tone={REPLY_TONE[m.classification] ?? "neutral"} title={m.classifiedBy === "operator" ? "Set by you" : m.classifiedBy === "rules" ? "Recognised by a fixed rule" : `Read by ${m.classifiedBy}${m.classificationConfidence != null ? `, confidence ${Math.round(m.classificationConfidence * 100)}%` : ""}`}>
                              {REPLY_LABEL[m.classification] ?? m.classification}
                            </Badge>
                          )}
                          {m.matchedBy === "address" && m.kind === "reply" && <Badge title="Matched by the sender's address, not by the email thread">probably about this</Badge>}
                          {m.handledAt && <Badge tone="ok">handled</Badge>}
                          <span className="text-xs text-ink-faint ml-auto">{fmtDate(m.receivedAt)}</span>
                        </div>
                        {m.classificationSummary && <p className="text-xs text-ink-muted mt-1.5">{m.classificationSummary}</p>}
                        <p className="letter-text mt-2 whitespace-pre-wrap rounded-lg bg-surface-2 border border-line px-4 py-3">{stripQuoted(m.bodyText).slice(0, 3000)}</p>
                        {m.suggestedReply && !m.handledAt && (
                          <div className="mt-3">
                            <div className="label">A possible answer (send it from your own mailbox; fill in anything in brackets)</div>
                            <p className="whitespace-pre-wrap rounded-lg border border-dashed border-line px-3 py-2 text-ink-muted">{m.suggestedReply}</p>
                          </div>
                        )}
                        {m.kind === "reply" && (
                          <div className="flex flex-wrap items-center gap-2 mt-3">
                            {m.fromEmail && (
                              <a className="btn btn-sm" href={`mailto:${m.fromEmail}?subject=${encodeURIComponent(/^re:/i.test(m.subject ?? "") ? (m.subject ?? "") : `Re: ${m.subject ?? ""}`)}${m.suggestedReply ? `&body=${encodeURIComponent(m.suggestedReply)}` : ""}`}>
                                <Icon name="mail" /> Answer in my mail program
                              </a>
                            )}
                            <form action={markReplyHandledAction}>
                              <input type="hidden" name="inboundId" value={m.id} />
                              <input type="hidden" name="returnTo" value={tabHref("outreach")} />
                              <button className="btn btn-sm btn-ghost">{m.handledAt ? "Mark as open again" : "Mark as handled"}</button>
                            </form>
                            <form action={reclassifyReplyAction} className="flex items-center gap-1.5 ml-auto">
                              <input type="hidden" name="inboundId" value={m.id} />
                              <input type="hidden" name="returnTo" value={tabHref("outreach")} />
                              <select className="select h-8 py-0 text-xs w-auto" name="category" defaultValue={m.classification ?? "other"} aria-label="What this reply says">
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
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              {outreachHistory && outreachHistory.items.length > 0 && (
                <Card title="Contact history" description="Emails, calls, meetings and notes, newest first." padded={false}>
                  <ActivityTimeline activities={outreachHistory.items} />
                </Card>
              )}
            </>
          )}

          {tab === "activity" && (
            <Card id="activity" title="Activity" description="Notes, interactions, stage changes and system events." padded={false} className="scroll-mt-4">
              <form action={addNoteAction} className="flex flex-wrap gap-2 p-5 border-b border-line bg-surface-2">
                <input type="hidden" name="businessId" value={b.id} />
                <select className="select w-36" name="type" defaultValue="note">
                  <option value="note">Note</option>
                  <option value="call">Call</option>
                  <option value="email">Email sent</option>
                  <option value="meeting">Meeting</option>
                </select>
                <input className="input flex-1 min-w-[200px]" name="content" placeholder="What happened? Logging a call, email or meeting marks the business as contacted." required />
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
            </Card>
          )}

        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 min-w-0">
          <Card title="Contact">
            <ul className="text-sm space-y-2.5">
              <ContactRow icon="mail" label="Email">
                {b.email ? (
                  <>
                    <a href={`mailto:${b.email}`} className="truncate block" title={b.email}>
                      {b.email}
                    </a>
                    <span className="text-xs text-ink-faint block">
                      {b.emailSource === "site" ? (
                        b.emailSourceUrl ? (
                          <a href={b.emailSourceUrl} target="_blank" rel="noreferrer">
                            published on their website
                          </a>
                        ) : (
                          "published on their website"
                        )
                      ) : b.emailSource === "manual" ? (
                        "added by you"
                      ) : (
                        "from their listing"
                      )}
                      {b.emailStatus === "invalid" ? " · does not accept mail" : b.emailStatus === "valid" ? " · domain accepts mail" : ""}
                    </span>
                  </>
                ) : (
                  <span className="text-warn">none found</span>
                )}
                {b.contactName && <span className="text-xs text-ink-muted block">Contact named on the site: {b.contactName}</span>}
                <details className="mt-1">
                  <summary className="text-xs text-ink-faint cursor-pointer select-none">{b.email ? "Change" : "Add an address"}</summary>
                  <form action={setBusinessEmailAction} className="flex gap-1.5 mt-1.5">
                    <input type="hidden" name="businessId" value={b.id} />
                    <input className="input h-8 text-xs" type="email" name="email" defaultValue={b.email ?? ""} placeholder="name@their-domain.com" required aria-label="Email address" />
                    <button className="btn btn-sm">Save</button>
                  </form>
                </details>
              </ContactRow>
              <ContactRow icon="phone" label="Phone">{b.phone ? <a href={`tel:${b.phone}`}>{formatPhone(b.phone, b.country)}</a> : <span className="text-ink-faint">unknown</span>}</ContactRow>
              <ContactRow icon="globe" label="Website">
                {b.website ? (
                  <span className="min-w-0 flex items-center gap-1.5 flex-wrap">
                    <a href={b.website} target="_blank" rel="noreferrer" className="truncate inline-flex items-center gap-0.5" title={b.website}>
                      {b.websiteDomain} <Icon name="external" className="w-3 h-3 shrink-0" />
                    </a>
                    {b.websiteSource && /^found_/.test(b.websiteSource) && <Badge tone="info" title="Located by the website finder and verified against the business phone/name">{b.websiteSource === "found_search" ? "found via search" : "found via domain guess"}</Badge>}
                  </span>
                ) : (
                  <span className="text-ink-faint">none</span>
                )}
              </ContactRow>
              {(b.street || b.city) && <ContactRow icon="building" label="Address">{[b.street, [b.city, b.region].filter(Boolean).join(", "), b.postalCode].filter(Boolean).join(" · ")}</ContactRow>}
            </ul>
          </Card>

          <Card title="Pipeline" description="Where this business stands and what you do next.">
            {(() => {
              const due = d.prospect?.nextActionAt ? new Date(d.prospect.nextActionAt) : null;
              const overdue = due ? due.getTime() < Date.now() : false;
              const prio = d.prospect?.priority ?? "normal";
              return (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-ink-muted">Stage</span>
                    <Badge tone={stageTone(stage)} dot>
                      {stageLabel(stage)}
                    </Badge>
                    {prio === "high" && <Badge tone="warn">high priority</Badge>}
                  </div>
                  <form action={updateStageAction} className="mt-2">
                    <input type="hidden" name="businessId" value={b.id} />
                    <label className="sr-only" htmlFor="stage">
                      Move to stage
                    </label>
                    <div className="flex gap-2">
                      <select id="stage" className="select" name="stage" defaultValue={stage}>
                        {PIPELINE_STAGES.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <button className="btn shrink-0">Move</button>
                    </div>
                  </form>

                  <div className="mt-4 pt-4 border-t border-line">
                    <div className="text-sm font-semibold text-ink-muted mb-1.5">Next action</div>
                    {d.prospect?.nextAction ? (
                      <div className={`rounded-[var(--radius-sm)] border px-3 py-2.5 ${overdue ? "border-bad/40 bg-bad/5" : "border-accent/30 bg-accent-soft/40"}`}>
                        <div className="text-sm font-medium text-ink">{d.prospect.nextAction}</div>
                        <div className={`text-xs mt-0.5 ${overdue ? "text-bad" : "text-ink-muted"}`}>
                          {due ? (
                            <>
                              <Icon name="clock" className="w-3 h-3 inline -mt-px mr-1" />
                              {overdue ? "Overdue · " : "Due "}
                              {fmtDate(d.prospect.nextActionAt)} ({fmtRelative(d.prospect.nextActionAt)})
                            </>
                          ) : (
                            "No due date"
                          )}
                          {" · "}
                          <span className="capitalize">{prio}</span> priority
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <form action={completeNextActionAction}>
                            <input type="hidden" name="businessId" value={b.id} />
                            <button className="btn btn-sm" title="Logs it on the Activity tab and clears it">
                              <Icon name="check" /> Done
                            </button>
                          </form>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-ink-faint mb-2">Nothing planned.</p>
                    )}
                    {(() => {
                      const form = (
                        <form action={setNextActionAction} className="space-y-3">
                          <input type="hidden" name="businessId" value={b.id} />
                          <div>
                            <label className="label" htmlFor="nextAction">
                              What to do
                            </label>
                            <input id="nextAction" className="input" name="nextAction" defaultValue={d.prospect?.nextAction ?? ""} placeholder="e.g. Call to confirm the estimate workflow" />
                          </div>
                          <div>
                            <label className="label" htmlFor="nextActionAt">
                              When
                            </label>
                            <input id="nextActionAt" className="input" type="datetime-local" name="nextActionAt" defaultValue={d.prospect?.nextActionAt ? toLocalInput(d.prospect.nextActionAt) : ""} />
                          </div>
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
                          <button className="btn">{d.prospect?.nextAction ? "Update next action" : "Save next action"}</button>
                        </form>
                      );
                      return d.prospect?.nextAction ? (
                        <details className="mt-2">
                          <summary className="text-xs text-ink-muted cursor-pointer hover:text-ink select-none">Change the next action</summary>
                          <div className="mt-3">{form}</div>
                        </details>
                      ) : (
                        <details>
                          <summary className="text-xs text-accent-text cursor-pointer select-none">Plan a next action</summary>
                          <div className="mt-3">{form}</div>
                        </details>
                      );
                    })()}
                  </div>
                </>
              );
            })()}
          </Card>

          <details className="surface">
            <summary className="px-5 py-3.5 text-[0.9rem] font-semibold select-none flex items-center gap-2">
              <Icon name="chevronRight" className="chevron w-3.5 h-3.5 text-ink-faint transition-transform" />
              Where it came from
            </summary>
            <div className="px-5 pb-5">
            <div className="flex items-center gap-3">
              {b.leadScore != null ? <ScoreRing value={b.leadScore} label="Lead" size={44} tone="neutral" /> : <span className="text-ink-faint text-xs">no lead score</span>}
              <div className="min-w-0 text-xs space-y-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge tone={b.kind === "chain" ? "neutral" : "ok"}>{b.kind === "chain" ? "chain / franchise" : b.kind === "independent" ? "independent" : "kind unknown"}</Badge>
                  {b.operatingStatus && b.operatingStatus !== "unknown" && <Badge tone={b.operatingStatus === "closed" ? "bad" : "ok"}>{b.operatingStatus}</Badge>}
                  {b.brand && <Badge tone="neutral" title="Brand attached by the discovery source">{b.brand}</Badge>}
                </div>
                {(b.leadReasons?.length ?? 0) > 0 && <div className="text-ink-faint">{b.leadReasons!.join(" · ")}</div>}
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
                      <span className="text-ink-faint shrink-0">#{f.rank} · {fmtRelative(f.createdAt)}</span>
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
                      <Badge tone="neutral">{s.provider === "google_maps" ? "Google Maps" : s.provider === "overture" ? "Overture Maps" : s.provider === "osm" ? "OpenStreetMap" : s.provider === "csv" ? "CSV / manual" : s.provider}</Badge>
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
    </>
  );
}

/** A part of the page that opens on a click: its heading and a few words on what is inside. */
function Fold({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <details className="border-t border-line">
      <summary className="flex items-center gap-2 py-3 cursor-pointer select-none hover:text-accent-text">
        <Icon name="chevronRight" className="chevron w-4 h-4 shrink-0 text-ink-faint transition-transform" />
        <span className="text-[0.95rem] font-semibold">{title}</span>
        {hint && <span className="text-sm text-ink-faint truncate">{hint}</span>}
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
