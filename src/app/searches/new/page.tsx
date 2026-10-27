import Link from "next/link";
import { listProviders } from "@/lib/discovery";
import { listPlaybooks } from "@/lib/industries";
import { getConfig } from "@/lib/config";
import { Callout, Card, Icon, PageHeader } from "@/components/ui";
import { createSearch } from "@/app/actions";

export default async function NewSearchPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const providers = listProviders();
  const playbooks = listPlaybooks();
  const cfg = getConfig();
  return (
    <>
      <PageHeader crumbs={[{ href: "/searches", label: "Discover" }, { label: "New search" }]} title="New search" subtitle="Tell Radar what kind of businesses to find and where. Everything else is optional." />
      {error && (
        <div className="mb-4">
          <Callout tone="bad" title="Please fix the form">{error}</Callout>
        </div>
      )}
      <form action={createSearch} className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="space-y-5">
          <Card title="1 · What to find">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="label">Industry playbook</label>
                <select className="select" name="industry" defaultValue="auto_repair">
                  {playbooks.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <p className="hint">Sets the map tags, search query, typical workflows and known software used in the analysis.</p>
              </div>
              <div>
                <label className="label">Search name <span className="normal-case font-normal text-ink-faint">(optional)</span></label>
                <input className="input" name="name" placeholder="e.g. Auto repair · Austin · October" />
              </div>
              <div>
                <label className="label">Keyword in business name <span className="normal-case font-normal text-ink-faint">(optional)</span></label>
                <input className="input" name="keywords" placeholder="e.g. transmission" />
              </div>
              <div>
                <label className="label">Google query override <span className="normal-case font-normal text-ink-faint">(optional)</span></label>
                <input className="input" name="categoryQuery" placeholder="e.g. European auto repair" />
              </div>
            </div>
          </Card>
          <Card title="2 · Where">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">City</label>
                <input className="input" name="city" defaultValue="Austin" />
              </div>
              <div>
                <label className="label">State / region</label>
                <input className="input" name="region" defaultValue="TX" />
              </div>
              <div>
                <label className="label">Country</label>
                <input className="input" name="country" defaultValue="US" maxLength={2} />
                <p className="hint">ISO-2 code</p>
              </div>
            </div>
          </Card>
          <Card title="3 · Sources & limits">
            <div className="space-y-3">
              {providers.map((p) => (
                <label key={p.key} className={`flex items-start gap-3 rounded-[var(--radius-sm)] border border-line p-3 cursor-pointer hover:bg-surface-2 ${p.available ? "" : "opacity-60 cursor-not-allowed"}`}>
                  <input type="checkbox" name="providers" value={p.key} defaultChecked={p.key === "osm"} disabled={!p.available} className="mt-1 accent-[var(--accent)]" />
                  <span className="text-sm">
                    <span className="font-medium">{p.label}</span>
                    <span className="block text-xs text-ink-muted">
                      {p.key === "osm" && "Free, no credentials. Data © OpenStreetMap contributors. Coverage varies by city."}
                      {p.key === "google_places" && (p.available ? "Enabled. Only place IDs are stored indefinitely per Google's policies." : `Needs a key — ${p.reason}.`)}
                      {p.key === "demo" && "Synthetic businesses to demonstrate the workflow. Never real companies."}
                    </span>
                  </span>
                </label>
              ))}
              <div className="grid md:grid-cols-3 gap-4 pt-2">
                <div>
                  <label className="label">Maximum results</label>
                  <input className="input" type="number" name="maxResults" defaultValue={25} min={1} max={500} />
                </div>
                <label className="flex items-center gap-2 text-sm md:pt-6">
                  <input type="hidden" name="requireWebsite" value="off" />
                  <input type="checkbox" name="requireWebsite" value="on" defaultChecked className="accent-[var(--accent)]" /> Only businesses with a website
                </label>
                <label className="flex items-center gap-2 text-sm md:pt-6">
                  <input type="hidden" name="autoInvestigate" value="off" />
                  <input type="checkbox" name="autoInvestigate" value="on" defaultChecked className="accent-[var(--accent)]" /> Investigate every result automatically
                </label>
              </div>
            </div>
          </Card>
          <div className="flex items-center gap-3">
            <button className="btn btn-primary btn-lg">
              <Icon name="play" /> Start discovery
            </button>
            <Link href="/searches" className="btn btn-ghost">
              Cancel
            </Link>
          </div>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-6">
          <Card title="What happens next">
            <ol className="space-y-3 text-sm">
              {[
                ["Discover", "Businesses are fetched from the selected sources, normalized, and merged with anything you already have."],
                ["Investigate", "Each website is fetched (homepage + key pages in parallel), a structured profile is built with evidence, and opportunities are analyzed and scored, all in one step per business."],
                ["Decide", cfg.ai.enabled ? "Every business ends with a verdict: opportunity hypotheses with scores, or an explicit no-opportunity." : "Without an Anthropic API key you get detected facts and contacts; the verdict waits for AI."],
                ["Reach out", "Generate an evidence-mapped draft, review it, and send it yourself."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-accent-soft text-accent-text text-[11px] font-semibold grid place-items-center shrink-0 mt-0.5">{i + 1}</span>
                  <span>
                    <span className="font-medium">{t}</span>
                    <span className="block text-xs text-ink-muted">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
          <Callout tone="neutral" icon="shield" title="Polite by design">
            robots.txt is respected, requests are rate-limited, private networks are blocked, and nothing is ever sent to the businesses automatically.
          </Callout>
        </aside>
      </form>
    </>
  );
}
