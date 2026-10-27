import { listProviders } from "@/lib/discovery";
import { listPlaybooks } from "@/lib/industries";
import { Card, PageHeader } from "@/components/ui";
import { createSearch } from "@/app/actions";

export default async function NewSearchPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const providers = listProviders();
  const playbooks = listPlaybooks();
  return (
    <>
      <PageHeader title="New search" subtitle="Discover businesses in an industry and area. Industry and location are configurable; the pilot playbook is automotive repair." />
      {error && <div className="rounded-md border border-bad/30 bg-bad-soft text-bad text-sm px-3 py-2 mb-4">{error}</div>}
      <form action={createSearch} className="grid md:grid-cols-2 gap-4 max-w-3xl">
        <Card title="What to find" className="md:col-span-2">
          <div className="grid md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="label">Search name (optional)</label>
              <input className="input" name="name" placeholder="Auto repair, Austin TX" />
            </div>
            <div>
              <label className="label">Industry playbook</label>
              <select className="select" name="industry" defaultValue="auto_repair">
                {playbooks.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-ink-faint mt-1">Drives OpenStreetMap tags, Google text query, and analysis context.</p>
            </div>
            <div>
              <label className="label">Keywords in business name (optional)</label>
              <input className="input" name="keywords" placeholder="e.g. transmission" />
            </div>
            <div>
              <label className="label">Category / query override (Google Places only)</label>
              <input className="input" name="categoryQuery" placeholder="e.g. European auto repair" />
            </div>
            <div>
              <label className="label">Maximum results</label>
              <input className="input" type="number" name="maxResults" defaultValue={50} min={1} max={500} />
            </div>
          </div>
        </Card>
        <Card title="Where">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">City</label>
              <input className="input" name="city" defaultValue="Austin" />
            </div>
            <div>
              <label className="label">Region / state</label>
              <input className="input" name="region" defaultValue="TX" />
            </div>
            <div>
              <label className="label">Country (ISO-2)</label>
              <input className="input" name="country" defaultValue="US" maxLength={2} />
            </div>
          </div>
        </Card>
        <Card title="Sources & options">
          <div className="space-y-2 text-sm">
            {providers.map((p) => (
              <label key={p.key} className={`flex items-start gap-2 ${p.available ? "" : "opacity-60"}`}>
                <input type="checkbox" name="providers" value={p.key} defaultChecked={p.key === "osm"} disabled={!p.available} className="mt-0.5" />
                <span>
                  {p.label}
                  {!p.available && <span className="text-xs text-warn"> — {p.reason}</span>}
                  {p.key === "demo" && <span className="text-xs text-demo"> — synthetic, not real businesses</span>}
                </span>
              </label>
            ))}
            <hr className="border-line" />
            <label className="flex items-center gap-2">
              <input type="checkbox" name="requireWebsite" defaultChecked /> Only keep businesses with a website (researchable)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="autoResearch" /> Automatically research and analyze every discovered business
            </label>
            <p className="text-[11px] text-ink-faint">Auto-research fetches each website and, when an API key is configured, runs AI extraction and analysis. Costs are bounded by the AI spend guard.</p>
          </div>
        </Card>
        <div className="md:col-span-2">
          <button className="btn btn-primary">Start discovery</button>
        </div>
      </form>
    </>
  );
}
