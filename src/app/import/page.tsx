import { Callout, Card, Icon, PageHeader } from "@/components/ui";
import { listPlaybooks } from "@/lib/industries";
import { importCsvAction } from "@/app/actions";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <PageHeader crumbs={[{ href: "/searches", label: "Discover" }, { label: "Import CSV" }]} title="Import businesses from CSV" subtitle="Bring your own list. Rows are normalized and merged with existing businesses by website domain, phone, or name + city." />
      {error && (
        <div className="mb-4">
          <Callout tone="bad" title="Import failed">{error}</Callout>
        </div>
      )}
      <div className="grid lg:grid-cols-[1fr_360px] gap-5 items-start">
        <Card title="Upload">
          <form action={importCsvAction} className="space-y-4" encType="multipart/form-data">
            <label className="block rounded-[var(--radius)] border-2 border-dashed border-line-strong hover:border-accent p-6 text-center cursor-pointer transition-colors">
              <Icon name="upload" className="w-6 h-6 mx-auto text-ink-faint mb-2" />
              <span className="text-sm font-medium">Choose a CSV file</span>
              <span className="block text-xs text-ink-faint">Up to 5 MB · header row required · only “name” is mandatory</span>
              <input className="block mx-auto mt-3 text-xs" type="file" name="file" accept=".csv,text/csv" required />
            </label>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="label">Industry playbook</label>
                <select className="select" name="industry" defaultValue="auto_repair">
                  {listPlaybooks().map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <label className="label">City</label>
                  <input className="input" name="city" placeholder="default" />
                </div>
                <div>
                  <label className="label">Region</label>
                  <input className="input" name="region" placeholder="TX" />
                </div>
                <div>
                  <label className="label">Country</label>
                  <input className="input" name="country" defaultValue="US" maxLength={2} />
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="hidden" name="autoInvestigate" value="off" />
              <input type="checkbox" name="autoInvestigate" value="on" defaultChecked className="accent-[var(--accent)]" /> Investigate imported businesses that have a website
            </label>
            <button className="btn btn-primary btn-lg">
              <Icon name="upload" /> Import
            </button>
          </form>
        </Card>
        <Card title="Recognized columns" description="Header names match loosely, case-insensitive.">
          <table className="table text-xs">
            <tbody>
              {[
                ["name", "business, company, company name"],
                ["website", "url, web, site, homepage, domain"],
                ["phone", "telephone, tel"],
                ["email", "e-mail"],
                ["street", "address, address1"],
                ["city", "town, locality"],
                ["region", "state, province"],
                ["zip", "postal code, postcode"],
                ["country", ""],
                ["category", "type, industry"],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td className="font-mono">{k}</td>
                  <td className="text-ink-muted">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <pre className="mt-3 text-[11px] bg-surface-2 border border-line rounded-[var(--radius-sm)] p-3 overflow-auto">{`name,website,phone,city,state\n"Acme Auto Repair",acmeauto.com,(512) 555-0100,Austin,TX`}</pre>
        </Card>
      </div>
    </>
  );
}
