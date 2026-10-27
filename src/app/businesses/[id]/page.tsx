import Link from "next/link";
import { notFound } from "next/navigation";
import { getBusinessDetail } from "@/lib/queries";
import { getConfig } from "@/lib/config";
import { Badge, Callout, Card, EmptyState, Icon, KeyValue, PageHeader, ScoreRing, Stepper, StatusPill, Tabs, fmtDate, fmtRelative } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { OutreachEditor, type ClaimView } from "@/components/outreach-editor";
import { OPPORTUNITY_CATEGORIES, getPlaybook, type OpportunityCategory } from "@/lib/industries";
import { PIPELINE_STAGES, VALIDATION_SIGNALS, stageLabel } from "@/lib/pipeline/stages";
import { deriveWorkflow, defaultTabFor } from "@/lib/workflow";
import { priorityScore } from "@/lib/scoring/score";
import { addNoteAction, addValidationSignalAction, analyzeBusinessAction, generateDraftAction, researchBusinessAction, setNextActionAction, updateDraftAction, updateStageAction, updateWebsiteAction } from "@/app/actions";

const TABS = ["overview", "findings", "opportunities", "outreach", "activity", "pages"] as const;
type Tab = (typeof TABS)[number];

export default async function BusinessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const d = await getBusinessDetail(id);
  if (!d) notFound();
  const { business: b } = d;
  const cfg = getConfig();
  const busy = d.activeJobs.length > 0;
  const verified = d.observations.filter((o) => o.kind === "verified");
  const unknowns = d.observations.filter((o) => o.kind === "unknown");
  const obsById = new Map(d.observations.map((o) => [o.id, o]));
  const wf = deriveWorkflow({ business: b, stage: d.prospect?.stage ?? "discovered", opportunityCount: d.opportunities.length, draftCount: d.drafts.length, busy });
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : (defaultTabFor(wf.next.kind) as Tab);
  const counts: Record<Tab, number | null> = { overview: null, findings: d.observations.length, opportunities: d.opportunities.length, outreach: d.drafts.length, activity: d.activities.length, pages: d.pages.length };
  const best = d.opportunities[0];
  const tabHref = (t: Tab) => `/businesses/${b.id}?tab=${t}`;

  const PrimaryAction = () => {
    switch (wf.next.kind) {
      case "research":
      case "retry_research":
        return (
          <form action={researchBusinessAction}>
            <input type="hidden" name="businessId" value={b.id} />
            <button className="btn btn-primary">
              <Icon name="globe" /> {wf.next.kind === "retry_research" ? "Retry research" : "Research website"}
            </button>
          </form>
        );
      case "analyze":
        return (
          <form action={analyzeBusinessAction}>
            <input type="hidden" name="businessId" value={b.id} />
            <button className="btn btn-primary">
              <Icon name="sparkles" /> Analyze opportunities
            </button>
          </form>
        );
      case "draft":
        return (
          <Link href={tabHref("opportunities")} className="btn btn-primary">
            <Icon name="mail" /> Draft outreach
          </Link>
        );
      case "review_draft":
        return (
          <Link href={tabHref("outreach")} className="btn btn-primary">
            <Icon name="eye" /> Review draft
          </Link>
        );
      case "needs_key":
        return (
          <Link href="/settings" className="btn">
            <Icon name="settings" /> Enable AI
          </Link>
        );
      case "follow_up":
        return (
          <Link href={tabHref("activity")} className="btn btn-primary">
            <Icon name="note" /> Log activity
          </Link>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/businesses", label: "Businesses" }, { label: b.name }]}
        title={
          <span className="flex items-center gap-2 flex-wrap">
            {b.name} {b.isDemo && <Badge tone="demo">demo</Badge>}
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
            <AutoRefresh active={busy} label={d.activeJobs[0]?.progress?.message ?? d.activeJobs[0]?.type.replace(/_/g, " ")} />
            {!busy && <PrimaryAction />}
            {!busy && !b.isDemo && (
              <details className="relative">
                <summary className="btn btn-ghost">
                  More <Icon name="chevronDown" className="w-3.5 h-3.5" />
                </summary>
                <div className="absolute right-0 mt-1 w-56 surface p-1 z-20 shadow-md">
                  {b.website && (
                    <form action={researchBusinessAction}>
                      <input type="hidden" name="businessId" value={b.id} />
                      <button className="w-full text-left text-sm px-3 py-2 rounded-md hover:bg-surface-2">Re-research website</button>
                    </form>
                  )}
                  {verified.length > 0 && cfg.ai.enabled && (
                    <form action={analyzeBusinessAction}>
                      <input type="hidden" name="businessId" value={b.id} />
                      <button className="w-full text-left text-sm px-3 py-2 rounded-md hover:bg-surface-2">Re-run analysis</button>
                    </form>
                  )}
                  <Link href={tabHref("pages")} className="block text-sm px-3 py-2 rounded-md hover:bg-surface-2 hover:no-underline text-ink">
                    Fetched pages
                  </Link>
                </div>
              </details>
            )}
          </>
        }
      />

      <div className="surface p-4 md:p-5 mb-5">
        <Stepper steps={wf.steps} />
        <div className="mt-4 pt-4 border-t border-line flex flex-wrap items-center gap-3">
          <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${{ accent: "bg-accent-soft text-accent-text", ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", neutral: "bg-surface-3 text-ink-muted", info: "bg-info-soft text-info" }[wf.next.tone]}`}>
            <Icon name={wf.next.tone === "warn" ? "alert" : wf.next.tone === "ok" ? "check" : wf.next.kind === "wait" ? "clock" : "arrowRight"} />
          </span>
          <div className="min-w-[220px] flex-1">
            <div className="text-sm font-semibold">Next step: {wf.next.title}</div>
            <div className="text-xs text-ink-muted">{wf.next.description}</div>
          </div>
          {!busy && <PrimaryAction />}
        </div>
      </div>

      {d.failedJobs.length > 0 && !busy && wf.next.kind !== "retry_research" && (
        <div className="mb-4">
          <Callout tone="bad" title={`Last ${d.failedJobs[0].type.replace(/_/g, " ")} failed`}>{d.failedJobs[0].error}</Callout>
        </div>
      )}
      {wf.next.kind === "retry_research" && d.failedJobs[0] && (
        <div className="mb-4">
          <Callout tone="warn" title="Research failed">
            {d.failedJobs[0].error}
            <form action={updateWebsiteAction} className="mt-2 flex flex-wrap gap-2 items-center">
              <input type="hidden" name="businessId" value={b.id} />
              <input className="input max-w-sm" name="website" defaultValue={b.website ?? ""} placeholder="https://correct-website.com" />
              <label className="text-xs flex items-center gap-1">
                <input type="checkbox" name="research" defaultChecked /> research after saving
              </label>
              <button className="btn btn-sm">Save website</button>
            </form>
          </Callout>
        </div>
      )}
      {wf.next.kind === "no_website" && !b.isDemo && (
        <div className="mb-4">
          <Callout tone="warn" title="No website on record">
            <form action={updateWebsiteAction} className="mt-2 flex flex-wrap gap-2 items-center">
              <input type="hidden" name="businessId" value={b.id} />
              <input className="input max-w-sm" name="website" placeholder="https://their-website.com" />
              <label className="text-xs flex items-center gap-1">
                <input type="checkbox" name="research" defaultChecked /> research after saving
              </label>
              <button className="btn btn-sm">Add website</button>
            </form>
          </Callout>
        </div>
      )}
      {b.isDemo && (
        <div className="mb-4">
          <Callout tone="demo" title="Synthetic demo record">Findings, opportunities and drafts were seeded to illustrate the product. Live research is disabled here.</Callout>
        </div>
      )}

      <Tabs items={TABS.map((t) => ({ href: tabHref(t), label: t.charAt(0).toUpperCase() + t.slice(1), count: counts[t], active: tab === t }))} />

      <div className="grid lg:grid-cols-[1fr_300px] gap-5 items-start">
        <div className="min-w-0 space-y-5">
          {tab === "overview" && (
            <>
              <Card title="What this business does" description={d.analysis ? `From the analysis · ${fmtRelative(d.analysis.createdAt)}` : undefined}>
                {d.analysis?.companySummary ? (
                  <p className="text-sm leading-relaxed">{d.analysis.companySummary}</p>
                ) : verified.length ? (
                  <EmptyState compact icon="sparkles" title="Findings are ready; no summary yet" description={cfg.ai.enabled ? "Run the analysis to get a summary and opportunity hypotheses." : "Analysis needs an Anthropic API key. Review the verified findings meanwhile."} action={<Link href={tabHref("findings")} className="btn btn-sm">See {verified.length} findings</Link>} />
                ) : (
                  <EmptyState compact icon="globe" title="Not researched yet" description={b.website ? "Research fetches the public website and records only what can be verified." : "No website is known; nothing can be fetched."} />
                )}
                {d.analysis?.noCompellingOpportunity && (
                  <div className="mt-4">
                    <Callout tone="warn" title="Insufficient evidence of a commercially compelling software opportunity">{d.analysis.noOpportunityReason}</Callout>
                  </div>
                )}
              </Card>
              {d.analysis && (
                <div className="grid md:grid-cols-2 gap-5">
                  <Card title="Documented workflows" description="Each cites verified observations.">
                    {(d.analysis.documentedWorkflows ?? []).length ? (
                      <ul className="space-y-2 text-sm">
                        {d.analysis.documentedWorkflows!.map((w, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <Icon name="check" className="w-4 h-4 text-ok mt-0.5" />
                            <span>
                              {w.name} <span className="text-xs text-ink-faint">· {w.observationIds.length} obs.</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-ink-faint">None documented.</p>
                    )}
                  </Card>
                  <Card title="Existing tools verified" description="Considered before proposing custom work.">
                    {(d.analysis.existingTools ?? []).length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {d.analysis.existingTools!.map((t) => (
                          <Badge key={t} tone="info">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-ink-faint">No third-party tools detected on the website.</p>
                    )}
                    {(d.analysis.industryWorkflows ?? []).length ? <p className="text-xs text-ink-faint mt-3">Industry workflows considered: {d.analysis.industryWorkflows!.join(" · ")}</p> : null}
                  </Card>
                </div>
              )}
              {best && (
                <Card title="Top opportunity" actions={<Link href={tabHref("opportunities")} className="btn btn-sm btn-ghost">All {d.opportunities.length}</Link>}>
                  <div className="flex gap-4 items-start">
                    <ScoreRing value={priorityScore(best.attractivenessScore, best.confidenceScore)} label="Priority" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{best.title}</div>
                      <div className="text-xs text-ink-faint mb-1">{OPPORTUNITY_CATEGORIES[best.category as OpportunityCategory] ?? best.category}</div>
                      <p className="text-sm text-ink-muted">{best.problemHypothesis}</p>
                    </div>
                  </div>
                </Card>
              )}
            </>
          )}

          {tab === "findings" && (
            <>
              <Card title={`Verified observations · ${verified.length}`} description="Facts backed by a source URL and an evidence quote. AI-extracted items were accepted only when the quote appears verbatim on the page." padded={false}>
                {verified.length === 0 ? (
                  <EmptyState icon="globe" title="No verified observations" description={b.website ? "Research the website to collect source-backed findings." : "No website to research."} />
                ) : (
                  <div className="divide-y divide-line">
                    {groupBy(verified, (o) => o.category).map(([cat, items]) => (
                      <div key={cat} className="px-5 py-4">
                        <div className="label mb-2">{cat}</div>
                        <ul className="space-y-3">
                          {items.map((o) => (
                            <li key={o.id} id={`obs-${o.id}`} className="grid md:grid-cols-[1fr_1fr] gap-3 text-sm">
                              <div className="flex items-start gap-2">
                                <Icon name="check" className="w-4 h-4 text-ok mt-0.5 shrink-0" />
                                <span>
                                  {o.statement}{" "}
                                  <Badge tone={o.method === "demo" ? "demo" : o.method === "ai" ? "accent" : "neutral"}>{o.method === "deterministic" ? "detected" : o.method === "ai" ? "AI · quote verified" : o.method}</Badge>
                                </span>
                              </div>
                              <div className="text-xs text-ink-muted border-l-2 border-line pl-3">
                                {o.evidenceQuote && <q className="block italic">{o.evidenceQuote}</q>}
                                {o.sourceUrl && (
                                  <a href={o.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-1 max-w-full">
                                    <span className="truncate">{o.sourceUrl.replace(/^https?:\/\//, "")}</span> <Icon name="external" className="w-3 h-3 shrink-0" />
                                  </a>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
              <Card title={`Unknowns · ${unknowns.length}`} description="Operationally relevant things the public information does not establish. They lower confidence, never attractiveness.">
                {unknowns.length === 0 ? (
                  <p className="text-sm text-ink-faint">None recorded{cfg.ai.enabled ? "." : " (AI extraction records these; needs an API key)."}</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {unknowns.map((o) => (
                      <li key={o.id} className="flex items-start gap-2">
                        <Icon name="info" className="w-4 h-4 text-warn mt-0.5 shrink-0" /> <span>{o.statement}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}

          {tab === "opportunities" && (
            <>
              {!d.analysis && <EmptyState icon="sparkles" title="No analysis yet" description={verified.length ? (cfg.ai.enabled ? "Run the analysis to turn findings into scored hypotheses." : "Analysis needs an Anthropic API key.") : "Research the website first."} />}
              {d.analysis?.noCompellingOpportunity && <Callout tone="warn" title="Insufficient evidence of a commercially compelling software opportunity">{d.analysis.noOpportunityReason}</Callout>}
              {d.analysis?.validationWarnings?.length ? <p className="text-xs text-ink-faint">Validator notes: {d.analysis.validationWarnings.join(" · ")}</p> : null}
              {d.opportunities.map((o) => (
                <Card
                  key={o.id}
                  title={
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-ink-faint">#{o.rank}</span> {o.title}
                      <Badge>{OPPORTUNITY_CATEGORIES[o.category as OpportunityCategory] ?? o.category}</Badge>
                      {o.supportingObservationIds.length === 0 && <Badge tone="warn">hypothesis only</Badge>}
                    </span>
                  }
                  actions={
                    <div className="flex gap-3">
                      <ScoreRing value={o.attractivenessScore} label="Attractive" size={46} />
                      <ScoreRing value={o.confidenceScore} label="Confidence" size={46} tone={o.confidenceScore < 40 ? "warn" : undefined} />
                    </div>
                  }
                >
                  <div className="grid md:grid-cols-2 gap-5 text-sm">
                    <div className="space-y-3">
                      <Field label="Problem hypothesis" hint="to validate">{o.problemHypothesis}</Field>
                      <Field label="Proposed solution">{o.proposedSolution}</Field>
                      <Field label="Why not an existing tool or process change" muted>{o.whyNotExistingTool}</Field>
                      <Field label="Expected value" muted>{o.expectedValue}</Field>
                      <Field label="Conversation angle" muted>{o.salesAngle}</Field>
                      <div className="flex gap-2 flex-wrap">
                        <Badge tone="info">effort: {o.implementationEffort}</Badge>
                        <Badge tone="info">reusability: {o.reusability}</Badge>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <div className="label">Supporting evidence · {o.supportingObservationIds.length}</div>
                        {o.supportingObservationIds.length === 0 ? (
                          <p className="text-xs text-warn">No verified observation supports this hypothesis. Confidence is capped.</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {o.supportingObservationIds.map((oid) => {
                              const ob = obsById.get(oid);
                              return (
                                <li key={oid} className="flex items-start gap-2 text-xs">
                                  <Icon name="check" className="w-3.5 h-3.5 text-ok mt-0.5 shrink-0" />
                                  <span>
                                    {ob?.statement ?? <span className="text-ink-faint">observation removed</span>}{" "}
                                    {ob?.sourceUrl && (
                                      <a href={ob.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5">
                                        source <Icon name="external" className="w-3 h-3" />
                                      </a>
                                    )}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                      <ListField label="Assumptions to validate" items={o.assumptions} />
                      <ListField label="Questions for the business" items={o.validationQuestions} />
                      <ListField label="Risks" items={o.risks} />
                    </div>
                  </div>
                  <details className="mt-4 group">
                    <summary className="text-xs text-ink-muted inline-flex items-center gap-1 hover:text-ink">
                      <Icon name="chevronDown" className="w-3.5 h-3.5 group-open:rotate-180 transition-transform" /> Why these scores
                    </summary>
                    <div className="grid md:grid-cols-2 gap-4 mt-3">
                      {(["attractiveness", "confidence"] as const).map((k) => (
                        <div key={k} className="rounded-[var(--radius-sm)] border border-line overflow-hidden">
                          <table className="table text-xs">
                            <thead>
                              <tr>
                                <th>{k}</th>
                                <th className="text-right">w</th>
                                <th className="text-right">score</th>
                              </tr>
                            </thead>
                            <tbody>
                              {o.scoreBreakdown[k].map((f) => (
                                <tr key={f.factor}>
                                  <td>
                                    {f.factor}
                                    <div className="text-ink-faint">{f.explanation}</div>
                                  </td>
                                  <td className="text-right tabular-nums">{f.weight}</td>
                                  <td className="text-right tabular-nums font-medium">{f.score}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                    {o.scoreBreakdown.notes.length > 0 && <p className="text-xs text-warn mt-2">{o.scoreBreakdown.notes.join(" ")}</p>}
                  </details>
                  {!b.isDemo && (
                    <form action={generateDraftAction} className="mt-4 pt-4 border-t border-line flex flex-wrap items-end gap-2">
                      <input type="hidden" name="businessId" value={b.id} />
                      <input type="hidden" name="opportunityId" value={o.id} />
                      <div>
                        <label className="label">Style</label>
                        <select className="select" name="style" defaultValue="concise">
                          <option value="concise">Concise</option>
                          <option value="consultative">Consultative</option>
                          <option value="casual">Casual</option>
                        </select>
                      </div>
                      <div>
                        <label className="label">Sender name</label>
                        <input className="input" name="senderName" placeholder="optional" />
                      </div>
                      <button className="btn btn-primary" disabled={busy || !cfg.ai.enabled} title={!cfg.ai.enabled ? "Requires ANTHROPIC_API_KEY" : ""}>
                        <Icon name="mail" /> Draft outreach
                      </button>
                    </form>
                  )}
                </Card>
              ))}
            </>
          )}

          {tab === "outreach" && (
            <>
              <Callout tone="neutral" icon="shield" title="Nothing is sent automatically.">
                Review the draft, approve it, then send it from your own email. Highlighted phrases show which claims are backed by verified observations.
              </Callout>
              {d.drafts.length === 0 && <EmptyState icon="mail" title="No drafts yet" description={d.opportunities.length ? "Generate one from an opportunity." : "Analyze the business first to get an opportunity to write about."} action={d.opportunities.length ? <Link href={tabHref("opportunities")} className="btn btn-primary">Go to opportunities</Link> : undefined} />}
              {d.drafts.map((dr) => {
                const opp = d.opportunities.find((o) => o.id === dr.opportunityId);
                const claims: ClaimView[] = dr.claims.map((c) => ({ text: c.text, supported: c.observationIds.length > 0, evidence: c.observationIds.map((oid) => ({ statement: obsById.get(oid)?.statement ?? "observation removed", sourceUrl: obsById.get(oid)?.sourceUrl ?? null })) }));
                return (
                  <Card
                    key={dr.id}
                    title={
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="capitalize">{dr.style}</span> draft <StatusPill status={dr.status} /> {dr.editedByUser && <Badge>edited</Badge>}
                      </span>
                    }
                    description={opp ? `For: ${opp.title}` : undefined}
                    actions={
                      <span className="text-xs text-ink-faint inline-flex items-center gap-1">
                        <Icon name="mail" className="w-3.5 h-3.5" /> {dr.toEmail ?? "no verified email"} · {fmtRelative(dr.createdAt)}
                      </span>
                    }
                  >
                    {dr.warnings.length > 0 && (
                      <div className="mb-4">
                        <Callout tone="warn" title={`${dr.warnings.length} thing${dr.warnings.length === 1 ? "" : "s"} to check before sending`}>
                          <ul className="list-disc pl-4 space-y-0.5">
                            {dr.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </Callout>
                      </div>
                    )}
                    <OutreachEditor draftId={dr.id} businessId={b.id} subject={dr.subject ?? ""} body={dr.body} claims={claims} status={dr.status} action={updateDraftAction} />
                  </Card>
                );
              })}
            </>
          )}

          {tab === "activity" && (
            <Card title="Activity" description="Notes, interactions, stage changes and system events." padded={false}>
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
              {d.activities.length === 0 ? (
                <EmptyState compact icon="note" title="No activity yet" />
              ) : (
                <ol className="relative px-5 py-4">
                  {d.activities.map((a) => (
                    <li key={a.id} className="flex gap-3 pb-4 last:pb-0">
                      <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${a.type === "system" ? "bg-ink-faint" : a.type === "validation" ? "bg-ok" : a.type === "stage_change" ? "bg-accent" : "bg-info"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm">{a.content}</div>
                        <div className="text-[11px] text-ink-faint">
                          {a.type.replace(/_/g, " ")} · {fmtDate(a.createdAt)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}

          {tab === "pages" && (
            <Card title="Fetched pages" description={d.latestRun ? `Latest research run · ${fmtDate(d.latestRun.startedAt)} · ${d.latestRun.pagesFetched} fetched, ${d.latestRun.pagesFailed} failed` : undefined} padded={false}>
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
              {d.latestRun?.notes?.length ? <p className="text-xs text-ink-faint px-5 py-3 border-t border-line">{d.latestRun.notes.join(" · ")}</p> : null}
            </Card>
          )}
        </div>

        {/* ------------------------------------------------------- side rail */}
        <aside className="space-y-4 lg:sticky lg:top-6 min-w-0">
          <Card title="Contact">
            <KeyValue
              rows={[
                { k: "Email", v: b.email ? <a href={`mailto:${b.email}`}>{b.email}</a> : <span className="text-warn">not verified</span> },
                { k: "Phone", v: b.phone ?? <span className="text-ink-faint">unknown</span> },
                { k: "Website", v: b.website ? <a href={b.website} target="_blank" rel="noreferrer">{b.websiteDomain}</a> : <span className="text-ink-faint">none</span> },
              ]}
            />
          </Card>
          {best && (
            <Card title="Scores">
              <div className="flex justify-around">
                <ScoreRing value={best.attractivenessScore} label="Attractive" size={52} />
                <ScoreRing value={best.confidenceScore} label="Confidence" size={52} tone={best.confidenceScore < 40 ? "warn" : undefined} />
                <ScoreRing value={priorityScore(best.attractivenessScore, best.confidenceScore)} label="Priority" size={52} />
              </div>
              <p className="text-[11px] text-ink-faint mt-3">Best of {d.opportunities.length} opportunit{d.opportunities.length === 1 ? "y" : "ies"}. Attractiveness is how good it would be if true; confidence is how much verified evidence supports it.</p>
            </Card>
          )}
          <Card title="Pipeline">
            <form action={updateStageAction} className="space-y-2">
              <input type="hidden" name="businessId" value={b.id} />
              <label className="label">Stage</label>
              <div className="flex gap-2">
                <select className="select" name="stage" defaultValue={d.prospect?.stage ?? "discovered"}>
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button className="btn btn-sm shrink-0">Set</button>
              </div>
            </form>
            <form action={setNextActionAction} className="space-y-2 mt-3 pt-3 border-t border-line">
              <input type="hidden" name="businessId" value={b.id} />
              <label className="label">Next action</label>
              <input className="input" name="nextAction" defaultValue={d.prospect?.nextAction ?? ""} placeholder="e.g. Call to confirm estimate workflow" />
              <div className="flex gap-2">
                <input className="input" type="datetime-local" name="nextActionAt" defaultValue={d.prospect?.nextActionAt ? toLocalInput(d.prospect.nextActionAt) : ""} />
                <select className="select w-28" name="priority" defaultValue={d.prospect?.priority ?? "normal"}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </div>
              <button className="btn btn-sm">Save</button>
            </form>
          </Card>
          <Card title="Validation signal" description="What the business actually told you.">
            <form action={addValidationSignalAction} className="space-y-2">
              <input type="hidden" name="businessId" value={b.id} />
              <select className="select" name="category" defaultValue={best?.category ?? ""}>
                <option value="" disabled>
                  Opportunity category
                </option>
                {Object.entries(OPPORTUNITY_CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select className="select" name="signalType" defaultValue="conversation">
                {VALIDATION_SIGNALS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <input className="input" name="notes" placeholder="Short note (optional)" />
              <button className="btn btn-sm">Record</button>
            </form>
            {d.signals.length > 0 && (
              <ul className="text-xs mt-3 space-y-1 pt-3 border-t border-line">
                {d.signals.map((s) => (
                  <li key={s.id} className="flex items-center gap-1.5">
                    <Badge tone={s.signalType === "rejected" ? "bad" : "ok"}>{s.signalType.replace(/_/g, " ")}</Badge>
                    <span className="text-ink-muted truncate">{OPPORTUNITY_CATEGORIES[s.opportunityCategory as OpportunityCategory] ?? s.opportunityCategory}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Sources">
            <ul className="text-xs space-y-2">
              {d.sources.map((s) => (
                <li key={s.id}>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={s.provider === "demo" ? "demo" : "neutral"}>{s.provider === "osm" ? "OpenStreetMap" : s.provider}</Badge>
                    {s.sourceUrl ? (
                      <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="truncate">
                        {s.providerId}
                      </a>
                    ) : (
                      <span className="truncate text-ink-muted">{s.providerId}</span>
                    )}
                  </div>
                  <div className="text-ink-faint mt-0.5">
                    {s.attribution} · {fmtRelative(s.discoveredAt)}
                  </div>
                </li>
              ))}
            </ul>
            <div className="text-[11px] text-ink-faint mt-3 pt-3 border-t border-line">
              Research: <StatusPill status={b.researchStatus} /> · Analysis: <StatusPill status={b.analysisStatus} /> · Stage: {stageLabel(d.prospect?.stage ?? "discovered")}
            </div>
          </Card>
        </aside>
      </div>
    </>
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
function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    m.set(k, [...(m.get(k) ?? []), it]);
  }
  return [...m.entries()];
}
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
