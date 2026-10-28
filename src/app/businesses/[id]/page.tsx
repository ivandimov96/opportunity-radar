import Link from "next/link";
import { notFound } from "next/navigation";
import { getBusinessDetail } from "@/lib/queries";
import { getConfig } from "@/lib/config";
import { Badge, Callout, Card, EmptyState, Icon, KeyValue, PageHeader, ScoreRing, Stepper, StatusPill, Tabs, fmtDate, fmtRelative } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { OutreachEditor, type ClaimView } from "@/components/outreach-editor";
import { OPPORTUNITY_CATEGORIES, getPlaybook, type OpportunityCategory } from "@/lib/industries";
import { FACT_FIELDS, FACT_GROUPS, factLabel, factValueLabel } from "@/lib/profile/fields";
import { PIPELINE_STAGES, VALIDATION_SIGNALS, stageLabel } from "@/lib/pipeline/stages";
import { deriveWorkflow, isResearchStale, researchAgeDays, defaultTabFor } from "@/lib/workflow";
import { priorityScore } from "@/lib/scoring/score";
import { addNoteAction, addValidationSignalAction, generateDraftAction, investigateAction, setNextActionAction, updateDraftAction, updateStageAction, updateWebsiteAction } from "@/app/actions";

const TABS = ["profile", "opportunities", "outreach", "activity", "pages"] as const;
type Tab = (typeof TABS)[number];

export default async function BusinessPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const d = await getBusinessDetail(id);
  if (!d) notFound();
  const { business: b } = d;
  const cfg = getConfig();
  const busy = d.activeJobs.length > 0 || b.status === "queued" || b.status === "investigating";
  const wf = deriveWorkflow({ business: b, stage: d.prospect?.stage ?? "lead", opportunityCount: d.opportunities.length, draftCount: d.drafts.length, busy });
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : (defaultTabFor(wf.next.kind) as Tab);
  const verified = d.facts.filter((f) => f.status === "verified");
  const gaps = d.facts.filter((f) => f.status === "not_found");
  const factByKey = new Map(d.facts.map((f) => [f.key, f]));
  const counts: Record<Tab, number | null> = { profile: d.facts.length, opportunities: d.opportunities.length, outreach: d.drafts.length, activity: d.activities.length, pages: d.pages.length };
  const best = d.opportunities[0];
  const tabHref = (t: Tab) => `/businesses/${b.id}?tab=${t}`;

  const PrimaryAction = () => {
    switch (wf.next.kind) {
      case "investigate":
      case "retry":
        return (
          <form action={investigateAction}>
            <input type="hidden" name="businessId" value={b.id} />
            <button className="btn btn-primary">
              <Icon name="sparkles" /> {wf.next.kind === "retry" ? "Retry investigation" : "Investigate"}
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
            <AutoRefresh active={busy} label={b.statusMessage ?? "Investigating"} />
            {!busy && <PrimaryAction />}
            {!busy && !b.isDemo && b.website && b.status === "profiled" && (
              <form action={investigateAction}>
                <input type="hidden" name="businessId" value={b.id} />
                <button className="btn btn-ghost" title="Fetch the website again and rebuild the profile">
                  <Icon name="refresh" /> Re-investigate
                </button>
              </form>
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

      {(wf.next.kind === "retry" || wf.next.kind === "no_website") && !b.isDemo && (
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
      {b.isDemo && (
        <div className="mb-4">
          <Callout tone="demo" title="Synthetic demo record">Profile, opportunities and drafts were seeded to illustrate the product. Live investigation is disabled here.</Callout>
        </div>
      )}

      <Tabs items={TABS.map((t) => ({ href: tabHref(t), label: t.charAt(0).toUpperCase() + t.slice(1), count: counts[t], active: tab === t }))} />

      <div className="grid lg:grid-cols-[1fr_300px] gap-5 items-start">
        <div className="min-w-0 space-y-5">
          {tab === "profile" && (
            <>
              <Card title="What this business does" description={d.latest ? `Investigated ${fmtRelative(d.latest.finishedAt ?? d.latest.startedAt)} · ${d.latest.pagesFetched} pages · ${verified.length} verified facts${d.latest.durationMs ? ` · ${(d.latest.durationMs / 1000).toFixed(1)}s` : ""}` : undefined}>
                {b.summary ? (
                  <p className="text-sm leading-relaxed">{b.summary}</p>
                ) : d.facts.length ? (
                  <p className="text-sm text-ink-muted">{cfg.ai.enabled ? "No summary could be verified from the site." : "Summary needs the AI step (ANTHROPIC_API_KEY). Detected facts are below."}</p>
                ) : (
                  <EmptyState compact icon="sparkles" title="Not investigated yet" description={b.website ? "Investigate to fetch the website and public records, build the profile and analyze opportunities in one step." : b.status === "no_website" ? "No website could be located; add one if you know it." : "No website on record: investigating will first try to locate one."} />
                )}
                {b.verdict === "no_opportunity" && d.latest?.verdictReason && (
                  <div className="mt-4">
                    <Callout tone="warn" title="No compelling software opportunity">{d.latest.verdictReason}</Callout>
                  </div>
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
                  {!b.isDemo && b.website && (
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
                <Card title="Profile" description="Every field is verified with a quote and source, marked not found after checking the site, or unknown." padded={false}>
                  {FACT_GROUPS.map((g) => {
                    const fields = FACT_FIELDS.filter((f) => f.group === g.key && f.key !== "summary");
                    const rows = fields.map((f) => ({ field: f, fact: factByKey.get(f.key) })).filter((r) => r.fact);
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
                                        <Badge className="ml-1" tone={fact!.method === "demo" ? "demo" : fact!.method === "ai" ? "accent" : "neutral"}>{fact!.method === "detected" ? "detected" : fact!.method === "ai" ? "AI · quote verified" : fact!.method}</Badge>
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
                <Callout tone="neutral" icon="info" title={`${gaps.length} thing${gaps.length === 1 ? "" : "s"} the site does not establish`}>
                  {gaps.map((g) => factLabel(g.key)).join(" · ")}. Gaps lower confidence, never attractiveness, and are the starting point for opportunity hypotheses.
                </Callout>
              )}
            </>
          )}

          {tab === "opportunities" && (
            <>
              {b.status !== "profiled" && <EmptyState icon="sparkles" title="No analysis yet" description={b.website ? "Investigate the business first." : b.status === "no_website" ? "No website could be located." : "Investigate: the website finder runs first."} />}
              {b.verdict === "needs_ai" && <Callout tone="warn" title="No rule-based pattern matched; AI analysis pending">The profile has detected facts and off-site records, but none of the deterministic patterns applied. The AI step (needs ANTHROPIC_API_KEY) reads the full pages for subtler hypotheses.</Callout>}
              {b.verdict === "no_opportunity" && <Callout tone="warn" title="No compelling software opportunity">{d.latest?.verdictReason}</Callout>}
              {b.verdict === "insufficient_evidence" && <Callout tone="warn" title="Insufficient evidence to recommend anything">{d.latest?.verdictReason} Hypotheses below, if any, rest on gaps and should be read as questions, not findings.</Callout>}
              {d.latest?.warnings?.length ? <p className="text-xs text-ink-faint">Validator notes: {d.latest.warnings.join(" · ")}</p> : null}
              {d.opportunities.map((o) => {
                const supportVerified = o.supportingFactKeys.filter((k) => factByKey.get(k)?.status === "verified");
                const supportGaps = o.supportingFactKeys.filter((k) => factByKey.get(k)?.status === "not_found");
                return (
                  <Card
                    key={o.id}
                    title={
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="text-ink-faint">#{o.rank}</span> {o.title}
                        <Badge>{OPPORTUNITY_CATEGORIES[o.category as OpportunityCategory] ?? o.category}</Badge>
                        {supportVerified.length === 0 && <Badge tone="warn">hypothesis only</Badge>}
                        {o.source === "rules" && <Badge tone="info" title="Deterministic pattern over verified facts and gaps; no model involved">rule-based</Badge>}
                        {o.source === "ai" && <Badge tone="accent" title="Model hypothesis; every cited fact was verified in code">AI</Badge>}
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
                      <div className="space-y-4">
                        <Step n={1} label="What we observed">
                          {supportVerified.length ? (
                            <ul className="space-y-1.5 text-xs">
                              {supportVerified.map((k) => {
                                const f = factByKey.get(k)!;
                                return (
                                  <li key={k}>
                                    <span className="font-medium">{factLabel(k)}:</span> {factValueLabel(f.value)}
                                    {f.evidenceQuote && f.evidenceQuote !== f.value && <q className="block italic text-ink-muted mt-0.5">{f.evidenceQuote}</q>}
                                    {f.sourceUrl && (
                                      <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 ml-1">
                                        source <Icon name="external" className="w-3 h-3" />
                                      </a>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p className="text-xs text-warn">Nothing verified supports this one; it rests on what the site does not show.</p>
                          )}
                        </Step>
                        <Step n={2} label="What problem might exist" hint="hypothesis, not a finding">
                          <p>{o.problemHypothesis}</p>
                        </Step>
                        <Step n={3} label="Why it matters">
                          <p className="text-ink-muted">{o.expectedValue ?? "Value mechanism not stated."}</p>
                        </Step>
                        <Step n={4} label="What software could help">
                          <p>{o.proposedSolution}</p>
                          {o.whyNotExistingTool && <p className="text-xs text-ink-muted mt-1">Why not an existing tool or a process change: {o.whyNotExistingTool}</p>}
                          <div className="flex gap-2 flex-wrap mt-2">
                            <Badge tone="info">effort: {o.implementationEffort}</Badge>
                            <Badge tone="info">reusability: {o.reusability}</Badge>
                          </div>
                        </Step>
                      </div>
                      <div className="space-y-4">
                        <Step n={5} label="Evidence" hint={`${supportVerified.length} verified · ${supportGaps.length} gap${supportGaps.length === 1 ? "" : "s"}`}>
                          {supportGaps.length > 0 && (
                            <p className="text-xs text-ink-muted">
                              Not shown on the site: {supportGaps.map((k) => factLabel(k).toLowerCase()).join(", ")}. A gap is a reason to ask, never proof of a problem.
                            </p>
                          )}
                          {o.supportingFactKeys.length === 0 && <p className="text-xs text-warn">No profile fact cited. Confidence is capped.</p>}
                          {o.supportingFactKeys.some((k) => !factByKey.get(k)) && <p className="text-xs text-ink-faint">Some cited facts are no longer established after re-investigation.</p>}
                        </Step>
                        <Step n={6} label="What remains unknown">
                          <ListField label="Assumptions" items={o.assumptions} />
                          <div className="mt-2">
                            <ListField label="Risks" items={o.risks} />
                          </div>
                        </Step>
                        <Step n={7} label="How we could validate it">
                          <ListField label="Questions for the business" items={o.validationQuestions} />
                          {o.salesAngle && <p className="text-xs text-ink-muted mt-2">Conversation angle: {o.salesAngle}</p>}
                        </Step>
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
                        <button className="btn btn-primary" disabled={busy} title={!cfg.ai.enabled ? "Template draft from verified facts (AI not configured)" : ""}>
                          <Icon name="mail" /> {cfg.ai.enabled ? "Draft outreach" : "Draft outreach (template)"}
                        </button>
                      </form>
                    )}
                  </Card>
                );
              })}
            </>
          )}

          {tab === "outreach" && (
            <>
              <Callout tone="neutral" icon="shield" title="Nothing is sent automatically.">
                Review the draft, approve it, then send it from your own email. Highlighted phrases show which claims are backed by profile facts.
              </Callout>
              {d.drafts.length === 0 && <EmptyState icon="mail" title="No drafts yet" description={d.opportunities.length ? "Generate one from an opportunity." : "Investigate the business first to get an opportunity to write about."} action={d.opportunities.length ? <Link href={tabHref("opportunities")} className="btn btn-primary">Go to opportunities</Link> : undefined} />}
              {d.drafts.map((dr) => {
                const opp = d.opportunities.find((o) => o.id === dr.opportunityId);
                const claims: ClaimView[] = dr.claims.map((c) => ({ text: c.text, supported: c.factKeys.length > 0, evidence: c.factKeys.map((k) => ({ statement: `${factLabel(k)}: ${factByKey.get(k)?.status === "verified" ? factValueLabel(factByKey.get(k)?.value) : "not found on the site"}`, sourceUrl: factByKey.get(k)?.sourceUrl ?? null })) }));
                return (
                  <Card
                    key={dr.id}
                    title={
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="capitalize">{dr.style}</span> draft <StatusPill status={dr.status} /> {dr.editedByUser && <Badge>edited</Badge>}
                      </span>
                    }
                    description={<span>{opp ? `For: ${opp.title}` : ""} <Badge tone={dr.model === "template" ? "info" : "accent"} title={dr.model === "template" ? "Built from verified facts and gaps without a model" : `Model: ${dr.model ?? "unknown"}`}>{dr.model === "template" ? "template draft" : "AI draft"}</Badge></span>}
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
            <Card title="Fetched pages" description={d.latest ? `Latest investigation · ${fmtDate(d.latest.startedAt)} · ${d.latest.pagesFetched} fetched, ${d.latest.pagesFailed} failed · ${d.latest.creditsUsed} Firecrawl credit(s)${d.latest.model ? ` · model ${d.latest.model} · $${d.latest.costUsd.toFixed(3)}` : ""}` : undefined} padded={false}>
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
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 min-w-0">
          <Card title="Contact">
            <ul className="text-sm space-y-2.5">
              <ContactRow icon="mail" label="Email">
                {b.email ? (
                  <a href={`mailto:${b.email}`} className="truncate block" title={b.email}>
                    {b.email}
                  </a>
                ) : (
                  <span className="text-warn">not found yet</span>
                )}
              </ContactRow>
              <ContactRow icon="phone" label="Phone">{b.phone ? <a href={`tel:${b.phone}`}>{fmtPhone(b.phone)}</a> : <span className="text-ink-faint">unknown</span>}</ContactRow>
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

          {best && (
            <Card title="Scores" description={`From the best of ${d.opportunities.length} hypothes${d.opportunities.length === 1 ? "is" : "es"}.`}>
              <div className="grid grid-cols-3 gap-2 justify-items-center">
                <ScoreRing value={best.attractivenessScore} label="Attractive" size={52} />
                <ScoreRing value={best.confidenceScore} label="Confidence" size={52} tone={best.confidenceScore < 40 ? "warn" : undefined} />
                <ScoreRing value={priorityScore(best.attractivenessScore, best.confidenceScore)} label="Priority" size={52} />
              </div>
              <dl className="mt-3 pt-3 border-t border-line text-[11px] text-ink-faint space-y-0.5">
                <div><dt className="inline text-ink-muted">Attractive</dt> <dd className="inline">how valuable it would be if true.</dd></div>
                <div><dt className="inline text-ink-muted">Confidence</dt> <dd className="inline">how much verified evidence supports it.</dd></div>
                <div><dt className="inline text-ink-muted">Priority</dt> <dd className="inline">both combined; orders the pipeline.</dd></div>
              </dl>
            </Card>
          )}

          <Card title="Pipeline" description={`Stage: ${stageLabel(d.prospect?.stage ?? "lead")}`}>
            <form action={updateStageAction}>
              <input type="hidden" name="businessId" value={b.id} />
              <label className="label" htmlFor="stage">Move to stage</label>
              <div className="flex gap-2">
                <select id="stage" className="select" name="stage" defaultValue={d.prospect?.stage ?? "lead"}>
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button className="btn shrink-0">Set</button>
              </div>
            </form>
            <form action={setNextActionAction} className="mt-4 pt-4 border-t border-line space-y-3">
              <input type="hidden" name="businessId" value={b.id} />
              <div>
                <label className="label" htmlFor="nextAction">Next action</label>
                <input id="nextAction" className="input" name="nextAction" defaultValue={d.prospect?.nextAction ?? ""} placeholder="e.g. Call to confirm the estimate workflow" />
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <div className="min-w-0">
                  <label className="label" htmlFor="nextActionAt">Due</label>
                  <input id="nextActionAt" className="input" type="datetime-local" name="nextActionAt" defaultValue={d.prospect?.nextActionAt ? toLocalInput(d.prospect.nextActionAt) : ""} />
                </div>
                <div>
                  <label className="label" htmlFor="priority">Priority</label>
                  <select id="priority" className="select w-24" name="priority" defaultValue={d.prospect?.priority ?? "normal"}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              <button className="btn">Save next action</button>
            </form>
          </Card>

          <Card title="Validation signal" description="What the business actually told you; this is what makes a hypothesis real.">
            <form action={addValidationSignalAction} className="space-y-3">
              <input type="hidden" name="businessId" value={b.id} />
              <div>
                <label className="label" htmlFor="signalCategory">Opportunity</label>
                <select id="signalCategory" className="select" name="category" defaultValue={best?.category ?? ""}>
                  <option value="" disabled>
                    Choose the opportunity…
                  </option>
                  {Object.entries(OPPORTUNITY_CATEGORIES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="signalType">Signal</label>
                <select id="signalType" className="select" name="signalType" defaultValue="conversation">
                  {VALIDATION_SIGNALS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="signalNotes">Note <span className="normal-case font-normal text-ink-faint">(optional)</span></label>
                <input id="signalNotes" className="input" name="notes" placeholder="What they said, in a few words" />
              </div>
              <button className="btn">Record</button>
            </form>
            {d.signals.length > 0 && (
              <ul className="text-xs mt-4 pt-3 border-t border-line space-y-1.5">
                {d.signals.map((s) => (
                  <li key={s.id} className="flex items-center gap-1.5 min-w-0">
                    <Badge tone={s.signalType === "rejected" ? "bad" : "ok"}>{s.signalType.replace(/_/g, " ")}</Badge>
                    <span className="text-ink-muted truncate">{OPPORTUNITY_CATEGORIES[s.opportunityCategory as OpportunityCategory] ?? s.opportunityCategory}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="How it got here" description="Where this business came from and how it ranked before research.">
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
                      <Badge tone={s.provider === "demo" ? "demo" : "neutral"}>{s.provider === "google_maps" ? "Google Maps" : s.provider === "overture" ? "Overture Maps" : s.provider === "osm" ? "OpenStreetMap" : s.provider === "csv" ? "CSV / manual" : s.provider}</Badge>
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
            <div className="mt-3 pt-3 border-t border-line text-[11px] text-ink-faint flex flex-wrap gap-1.5 items-center">
              <StatusPill status={b.status} />
              {b.statusMessage && <span>{b.statusMessage}</span>}
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Step({ n, label, hint, children }: { n: number; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-5 h-5 rounded-full bg-accent-soft text-accent-text text-[11px] font-semibold grid place-items-center shrink-0 mt-0.5">{n}</span>
      <div className="min-w-0 flex-1">
        <div className="label">
          {label} {hint && <span className="normal-case font-normal text-ink-faint">({hint})</span>}
        </div>
        {children}
      </div>
    </div>
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
        <div className="text-[10.5px] uppercase tracking-wide text-ink-faint leading-tight">{label}</div>
        <div className="min-w-0 leading-snug">{children}</div>
      </div>
    </li>
  );
}
/** 5123122177 → (512) 312-2177 for 10-digit North American numbers; anything else as stored. */
function fmtPhone(p: string) {
  const d = p.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("1")) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return p;
}
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
