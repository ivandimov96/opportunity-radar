import Link from "next/link";
import { notFound } from "next/navigation";
import { getBusinessDetail } from "@/lib/queries";
import { getConfig } from "@/lib/config";
import { Badge, Card, DemoBanner, Empty, PageHeader, ScoreBar, StatusBadge, fmtDate } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { OPPORTUNITY_CATEGORIES, getPlaybook, type OpportunityCategory } from "@/lib/industries";
import { PIPELINE_STAGES, VALIDATION_SIGNALS, stageLabel } from "@/lib/pipeline/stages";
import { addNoteAction, addValidationSignalAction, analyzeBusinessAction, generateDraftAction, researchBusinessAction, setNextActionAction, updateDraftAction, updateStageAction } from "@/app/actions";
import { priorityScore } from "@/lib/scoring/score";

const TABS = ["overview", "findings", "opportunities", "outreach", "pipeline", "pages"] as const;
type Tab = (typeof TABS)[number];

export default async function BusinessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  const d = getBusinessDetail(id);
  if (!d) notFound();
  const { business: b } = d;
  const cfg = getConfig();
  const busy = d.activeJobs.length > 0;
  const verified = d.observations.filter((o) => o.kind === "verified");
  const unknowns = d.observations.filter((o) => o.kind === "unknown");
  const obsById = new Map(d.observations.map((o) => [o.id, o]));
  const counts: Record<Tab, number | null> = { overview: null, findings: d.observations.length, opportunities: d.opportunities.length, outreach: d.drafts.length, pipeline: d.activities.length, pages: d.pages.length };

  return (
    <>
      <PageHeader
        title={
          <>
            {b.name} {b.isDemo && <Badge tone="demo">demo</Badge>}
          </>
        }
        subtitle={
          <>
            {getPlaybook(b.industry).label}
            {b.category ? ` · ${b.category}` : ""} · {[b.street, b.city, b.region, b.postalCode].filter(Boolean).join(", ") || "address unknown"} ·{" "}
            {b.website ? (
              <a href={b.website} target="_blank" rel="noreferrer">
                {b.websiteDomain ?? b.website}
              </a>
            ) : (
              <span className="text-warn">no website</span>
            )}
          </>
        }
        actions={
          <>
            <AutoRefresh active={busy} />
            {!b.isDemo && (
              <form action={researchBusinessAction}>
                <input type="hidden" name="businessId" value={b.id} />
                <button className="btn" disabled={busy || !b.website} title={!b.website ? "No website to research" : ""}>
                  {d.latestRun ? "Re-research website" : "Research website"}
                </button>
              </form>
            )}
            {!b.isDemo && (
              <form action={analyzeBusinessAction}>
                <input type="hidden" name="businessId" value={b.id} />
                <button className="btn btn-primary" disabled={busy || !cfg.ai.enabled || verified.length === 0} title={!cfg.ai.enabled ? "Requires ANTHROPIC_API_KEY" : verified.length === 0 ? "Research first" : ""}>
                  {d.analysis ? "Re-run analysis" : "Analyze opportunities"}
                </button>
              </form>
            )}
          </>
        }
      />
      {b.isDemo && <DemoBanner>Findings, opportunities and drafts below were seeded synthetically to illustrate the product. Live research and analysis are disabled for demo records.</DemoBanner>}
      {d.failedJobs.length > 0 && !busy && (
        <div className="rounded-md border border-bad/30 bg-bad-soft text-bad text-xs px-3 py-2 mb-3">
          Last failure ({d.failedJobs[0].type.replace("_", " ")}): {d.failedJobs[0].error}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 text-xs text-ink-muted mb-4">
        <span>
          Research: <StatusBadge status={b.researchStatus} />
        </span>
        <span>
          Analysis: <StatusBadge status={b.analysisStatus} />
        </span>
        <span>
          Stage: <Badge tone="accent">{stageLabel(d.prospect?.stage ?? "discovered")}</Badge>
        </span>
        {busy && <span className="text-accent">{d.activeJobs[0].progress?.message ?? `${d.activeJobs[0].type.replace("_", " ")} ${d.activeJobs[0].status}`}</span>}
      </div>
      <nav className="flex gap-1 border-b border-line mb-4">
        {TABS.map((t) => (
          <Link key={t} href={`/businesses/${b.id}?tab=${t}`} className={`px-3 py-2 text-sm capitalize hover:no-underline border-b-2 -mb-px ${tab === t ? "border-accent text-accent font-medium" : "border-transparent text-ink-muted hover:text-ink"}`}>
            {t} {counts[t] != null && <span className="text-ink-faint">({counts[t]})</span>}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="grid lg:grid-cols-3 gap-4">
          <Card title="Company" className="lg:col-span-2">
            {d.analysis?.companySummary ? <p className="text-sm">{d.analysis.companySummary}</p> : <p className="text-sm text-ink-muted">{verified.length ? "Research is done; run the analysis to get a summary and opportunity hypotheses." : b.website ? "Not researched yet." : "No website is known for this business, so website research is not possible. Add one via CSV import or research manually."}</p>}
            {d.analysis && (
              <div className="grid md:grid-cols-2 gap-4 mt-4 text-sm">
                <div>
                  <div className="label">Documented workflows (cited)</div>
                  <ul className="list-disc pl-4">
                    {(d.analysis.documentedWorkflows ?? []).map((w, i) => (
                      <li key={i}>
                        {w.name} <span className="text-ink-faint text-xs">({w.observationIds.length} obs.)</span>
                      </li>
                    ))}
                    {!(d.analysis.documentedWorkflows ?? []).length && <li className="text-ink-faint">none</li>}
                  </ul>
                </div>
                <div>
                  <div className="label">Existing tools verified</div>
                  <div>{(d.analysis.existingTools ?? []).join(", ") || <span className="text-ink-faint">none detected</span>}</div>
                  <div className="label mt-3">Industry workflows considered</div>
                  <div className="text-ink-muted text-xs">{(d.analysis.industryWorkflows ?? []).join(" · ")}</div>
                </div>
              </div>
            )}
            {d.analysis?.noCompellingOpportunity && (
              <div className="mt-4 rounded-md border border-warn/30 bg-warn-soft text-warn text-sm px-3 py-2">
                <strong>Insufficient evidence of a commercially compelling software opportunity.</strong> {d.analysis.noOpportunityReason}
              </div>
            )}
          </Card>
          <div className="space-y-4">
            <Card title="Contact channels">
              <dl className="text-sm space-y-1">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">Email</dt>
                  <dd>{b.email ?? <span className="text-warn">unavailable (not verified)</span>}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">Phone</dt>
                  <dd>{b.phone ?? <span className="text-ink-faint">unknown</span>}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">Website</dt>
                  <dd className="truncate">{b.website ? <a href={b.website} target="_blank" rel="noreferrer">{b.websiteDomain}</a> : "none"}</dd>
                </div>
              </dl>
            </Card>
            <Card title="Sources">
              <ul className="text-xs space-y-1">
                {d.sources.map((s) => (
                  <li key={s.id}>
                    <Badge tone={s.provider === "demo" ? "demo" : "neutral"}>{s.provider}</Badge> {s.sourceUrl ? <a href={s.sourceUrl} target="_blank" rel="noreferrer">{s.providerId}</a> : s.providerId}
                    <div className="text-ink-faint">
                      {s.attribution} · {fmtDate(s.discoveredAt)}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Research runs">
              {d.runs.length === 0 ? (
                <Empty>None.</Empty>
              ) : (
                <ul className="text-xs space-y-2">
                  {d.runs.map((r) => (
                    <li key={r.id}>
                      <StatusBadge status={r.status} /> {fmtDate(r.startedAt)} · {r.pagesFetched} pages fetched, {r.pagesFailed} failed · AI obs. {r.aiObservationsAccepted} accepted / {r.aiObservationsRejected} rejected
                      {r.error && <div className="text-bad">{r.error}</div>}
                      {r.notes?.length ? <div className="text-ink-faint">{r.notes.join(" · ")}</div> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === "findings" && (
        <div className="grid lg:grid-cols-3 gap-4">
          <Card title={`Verified observations (${verified.length})`} className="lg:col-span-2">
            {verified.length === 0 ? (
              <Empty>No verified observations yet. {b.website ? "Run website research." : "No website to research."}</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Observation</th>
                    <th>Evidence</th>
                    <th>Method</th>
                  </tr>
                </thead>
                <tbody>
                  {verified.map((o) => (
                    <tr key={o.id} id={`obs-${o.id}`}>
                      <td className="text-xs">{o.category}</td>
                      <td>{o.statement}</td>
                      <td className="text-xs text-ink-muted">
                        {o.evidenceQuote && <q className="block">{o.evidenceQuote}</q>}
                        {o.sourceUrl && (
                          <a href={o.sourceUrl} target="_blank" rel="noreferrer" className="block truncate max-w-[260px]">
                            {o.sourceUrl}
                          </a>
                        )}
                      </td>
                      <td>
                        <Badge tone={o.method === "demo" ? "demo" : o.method === "ai" ? "accent" : "neutral"}>{o.method === "deterministic" ? "detected" : o.method === "ai" ? "AI, quote-verified" : o.method}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title={`Unknowns & assumptions (${unknowns.length})`}>
            <p className="text-xs text-ink-muted mb-2">Operationally relevant things the public information does not establish. These lower confidence, not attractiveness.</p>
            {unknowns.length === 0 ? (
              <Empty>None recorded.</Empty>
            ) : (
              <ul className="text-sm list-disc pl-4 space-y-1">
                {unknowns.map((o) => (
                  <li key={o.id}>{o.statement}</li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "opportunities" && (
        <div className="space-y-4">
          {!d.analysis && <Empty>No analysis yet.{cfg.ai.enabled ? " Research the website, then run the analysis." : " Analysis requires ANTHROPIC_API_KEY."}</Empty>}
          {d.analysis?.noCompellingOpportunity && (
            <div className="rounded-md border border-warn/30 bg-warn-soft text-warn text-sm px-3 py-2">
              <strong>Insufficient evidence of a commercially compelling software opportunity.</strong> {d.analysis.noOpportunityReason}
            </div>
          )}
          {d.analysis?.validationWarnings?.length ? (
            <div className="text-xs text-ink-muted">
              Validation notes: {d.analysis.validationWarnings.join(" · ")}
            </div>
          ) : null}
          {d.opportunities.map((o) => (
            <Card
              key={o.id}
              title={
                <>
                  #{o.rank} {o.title} <Badge tone="neutral">{OPPORTUNITY_CATEGORIES[o.category as OpportunityCategory] ?? o.category}</Badge>
                </>
              }
              actions={
                <div className="flex gap-3">
                  <ScoreBar value={o.attractivenessScore} label="Attractiveness" />
                  <ScoreBar value={o.confidenceScore} label="Confidence" tone={o.confidenceScore < 40 ? "warn" : "ok"} />
                  <ScoreBar value={priorityScore(o.attractivenessScore, o.confidenceScore)} label="Priority" />
                </div>
              }
            >
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-3">
                  <div>
                    <div className="label">Problem hypothesis (to validate)</div>
                    <p>{o.problemHypothesis}</p>
                  </div>
                  <div>
                    <div className="label">Proposed solution</div>
                    <p>{o.proposedSolution}</p>
                  </div>
                  <div>
                    <div className="label">Why not an existing tool / process change</div>
                    <p className="text-ink-muted">{o.whyNotExistingTool}</p>
                  </div>
                  <div>
                    <div className="label">Expected value</div>
                    <p className="text-ink-muted">{o.expectedValue}</p>
                  </div>
                  <div>
                    <div className="label">Sales conversation angle</div>
                    <p className="text-ink-muted">{o.salesAngle}</p>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <Badge>effort: {o.implementationEffort}</Badge>
                    <Badge>reusability: {o.reusability}</Badge>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="label">Supporting verified observations ({o.supportingObservationIds.length})</div>
                    {o.supportingObservationIds.length === 0 ? (
                      <p className="text-warn text-xs">None — this is a hypothesis without direct evidence.</p>
                    ) : (
                      <ul className="list-disc pl-4">
                        {o.supportingObservationIds.map((oid) => {
                          const ob = obsById.get(oid);
                          return (
                            <li key={oid}>
                              {ob ? (
                                <>
                                  {ob.statement}{" "}
                                  {ob.sourceUrl && (
                                    <a href={ob.sourceUrl} target="_blank" rel="noreferrer" className="text-xs">
                                      source
                                    </a>
                                  )}
                                </>
                              ) : (
                                <span className="text-ink-faint">observation removed</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  <div>
                    <div className="label">Assumptions to validate</div>
                    <ul className="list-disc pl-4 text-ink-muted">
                      {o.assumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="label">Validation questions</div>
                    <ul className="list-disc pl-4 text-ink-muted">
                      {o.validationQuestions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="label">Risks</div>
                    <ul className="list-disc pl-4 text-ink-muted">
                      {o.risks.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                      {!o.risks.length && <li className="text-ink-faint">none listed</li>}
                    </ul>
                  </div>
                </div>
              </div>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-ink-muted">Why these scores</summary>
                <div className="grid md:grid-cols-2 gap-4 mt-2">
                  {(["attractiveness", "confidence"] as const).map((k) => (
                    <table key={k} className="table">
                      <thead>
                        <tr>
                          <th>{k}</th>
                          <th>w</th>
                          <th>score</th>
                          <th>why</th>
                        </tr>
                      </thead>
                      <tbody>
                        {o.scoreBreakdown[k].map((f) => (
                          <tr key={f.factor}>
                            <td>{f.factor}</td>
                            <td>{f.weight}</td>
                            <td>{f.score}</td>
                            <td className="text-ink-muted">{f.explanation}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))}
                </div>
                {o.scoreBreakdown.notes.length > 0 && <p className="text-warn mt-2">{o.scoreBreakdown.notes.join(" ")}</p>}
              </details>
              {!b.isDemo && (
                <form action={generateDraftAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
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
                    <label className="label">Sender name (optional)</label>
                    <input className="input" name="senderName" placeholder="Your name" />
                  </div>
                  <button className="btn btn-primary" disabled={busy || !cfg.ai.enabled} title={!cfg.ai.enabled ? "Requires ANTHROPIC_API_KEY" : ""}>
                    Draft outreach for this opportunity
                  </button>
                </form>
              )}
            </Card>
          ))}
        </div>
      )}

      {tab === "outreach" && (
        <div className="space-y-4">
          <div className="rounded-md border border-line bg-panel text-xs text-ink-muted px-3 py-2">Drafts are for human review and manual sending. The MVP deliberately does not send email. Every company-specific claim is mapped to a verified observation; unmapped claims are flagged.</div>
          {d.drafts.length === 0 && <Empty>No drafts yet. Generate one from an opportunity.</Empty>}
          {d.drafts.map((dr) => {
            const opp = d.opportunities.find((o) => o.id === dr.opportunityId);
            return (
              <Card
                key={dr.id}
                title={
                  <>
                    {dr.style} draft {opp ? `· ${opp.title}` : ""} <Badge tone={dr.status === "approved" ? "ok" : dr.status === "archived" ? "neutral" : "accent"}>{dr.status}</Badge> {dr.editedByUser && <Badge>edited</Badge>}
                  </>
                }
                actions={<span className="text-xs text-ink-faint">{fmtDate(dr.createdAt)}</span>}
              >
                {dr.warnings.length > 0 && (
                  <ul className="mb-3 rounded-md border border-warn/30 bg-warn-soft text-warn text-xs px-3 py-2 list-disc pl-6">
                    {dr.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                <form action={updateDraftAction} className="grid lg:grid-cols-3 gap-4">
                  <input type="hidden" name="draftId" value={dr.id} />
                  <input type="hidden" name="businessId" value={b.id} />
                  <div className="lg:col-span-2 space-y-2">
                    <div>
                      <label className="label">To</label>
                      <input className="input" value={dr.toEmail ?? "No verified email address — find the recipient manually"} readOnly />
                    </div>
                    <div>
                      <label className="label">Subject</label>
                      <input className="input" name="subject" defaultValue={dr.subject ?? ""} />
                    </div>
                    <div>
                      <label className="label">Body</label>
                      <textarea className="textarea font-mono text-xs" name="body" rows={12} defaultValue={dr.body} />
                    </div>
                    <div className="flex gap-2">
                      <button className="btn" name="status" value={dr.status}>
                        Save edits
                      </button>
                      <button className="btn btn-primary" name="status" value="approved">
                        Save &amp; approve for manual sending
                      </button>
                      <button className="btn" name="status" value="archived">
                        Archive
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="label">Claims → evidence</div>
                    <ul className="text-xs space-y-2">
                      {dr.claims.map((c, i) => (
                        <li key={i} className={`rounded border px-2 py-1 ${c.observationIds.length ? "border-ok/30 bg-ok-soft" : "border-warn/30 bg-warn-soft"}`}>
                          <q>{c.text}</q>
                          <ul className="mt-1 text-ink-muted">
                            {c.observationIds.map((oid) => {
                              const ob = obsById.get(oid);
                              return (
                                <li key={oid}>
                                  ↳ {ob?.statement ?? "observation removed"}{" "}
                                  {ob?.sourceUrl && (
                                    <a href={ob.sourceUrl} target="_blank" rel="noreferrer">
                                      source
                                    </a>
                                  )}
                                </li>
                              );
                            })}
                            {!c.observationIds.length && <li className="text-warn">no supporting observation</li>}
                          </ul>
                        </li>
                      ))}
                      {!dr.claims.length && <li className="text-ink-faint">No company-specific claims recorded.</li>}
                    </ul>
                  </div>
                </form>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "pipeline" && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="space-y-4">
            <Card title="Stage & next action">
              <form action={updateStageAction} className="space-y-2">
                <input type="hidden" name="businessId" value={b.id} />
                <label className="label">Stage</label>
                <select className="select" name="stage" defaultValue={d.prospect?.stage ?? "discovered"}>
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <input className="input" name="note" placeholder="Reason (optional)" />
                <button className="btn">Update stage</button>
              </form>
              <form action={setNextActionAction} className="space-y-2 mt-4 border-t border-line pt-3">
                <input type="hidden" name="businessId" value={b.id} />
                <label className="label">Next action</label>
                <input className="input" name="nextAction" defaultValue={d.prospect?.nextAction ?? ""} placeholder="e.g. Call to confirm estimate workflow" />
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" type="datetime-local" name="nextActionAt" defaultValue={d.prospect?.nextActionAt ? new Date(d.prospect.nextActionAt).toISOString().slice(0, 16) : ""} />
                  <select className="select" name="priority" defaultValue={d.prospect?.priority ?? "normal"}>
                    <option value="low">Low priority</option>
                    <option value="normal">Normal priority</option>
                    <option value="high">High priority</option>
                  </select>
                </div>
                <button className="btn">Save next action</button>
              </form>
            </Card>
            <Card title="Validation signal">
              <p className="text-xs text-ink-muted mb-2">Record what the business actually told you. These are the only demand signals that count toward product decisions.</p>
              <form action={addValidationSignalAction} className="space-y-2">
                <input type="hidden" name="businessId" value={b.id} />
                <select className="select" name="category" defaultValue={d.opportunities[0]?.category ?? ""}>
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
                <input className="input" name="notes" placeholder="What did they say?" />
                <button className="btn">Record signal</button>
              </form>
              {d.signals.length > 0 && (
                <ul className="text-xs mt-3 space-y-1">
                  {d.signals.map((s) => (
                    <li key={s.id}>
                      <Badge tone={s.signalType === "rejected" ? "bad" : "ok"}>{s.signalType}</Badge> {OPPORTUNITY_CATEGORIES[s.opportunityCategory as OpportunityCategory] ?? s.opportunityCategory} {s.notes && `— ${s.notes}`}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <Card title="Notes & activity" className="lg:col-span-2">
            <form action={addNoteAction} className="flex gap-2 mb-4">
              <input type="hidden" name="businessId" value={b.id} />
              <select className="select w-32" name="type" defaultValue="note">
                <option value="note">Note</option>
                <option value="call">Call</option>
                <option value="email">Email sent</option>
                <option value="meeting">Meeting</option>
              </select>
              <input className="input" name="content" placeholder="Add a note or log an interaction" required />
              <button className="btn">Add</button>
            </form>
            {d.activities.length === 0 ? (
              <Empty>No activity yet.</Empty>
            ) : (
              <ul className="text-sm space-y-2">
                {d.activities.map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <span className="text-xs text-ink-faint w-36 shrink-0">{fmtDate(a.createdAt)}</span>
                    <span>
                      <Badge tone={a.type === "system" ? "neutral" : a.type === "validation" ? "ok" : "accent"}>{a.type.replace("_", " ")}</Badge> {a.content}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "pages" && (
        <Card title="Fetched pages (latest research run)">
          {d.pages.length === 0 ? (
            <Empty>No pages fetched.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Title</th>
                  <th>Text</th>
                  <th>Fetched</th>
                </tr>
              </thead>
              <tbody>
                {d.pages.map((p) => (
                  <tr key={p.id}>
                    <td className="text-xs">{p.kind}</td>
                    <td className="text-xs">
                      <a href={p.url} target="_blank" rel="noreferrer">
                        {p.url}
                      </a>
                    </td>
                    <td className="text-xs">{p.error ? <span className="text-bad">{p.error}</span> : p.statusCode}</td>
                    <td className="text-xs">{p.title ?? "—"}</td>
                    <td className="text-xs">{p.textLength.toLocaleString()} chars</td>
                    <td className="text-xs text-ink-faint">{fmtDate(p.fetchedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}
