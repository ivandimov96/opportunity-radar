import { Card, PageHeader } from "@/components/ui";
import { listPlaybooks } from "@/lib/industries";
import { importCsvAction } from "@/app/actions";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <PageHeader title="Import businesses from CSV" subtitle="Bring your own list. Rows are normalized and merged with existing businesses by website domain, phone, or name + city." />
      {error && <div className="rounded-md border border-bad/30 bg-bad-soft text-bad text-sm px-3 py-2 mb-4">{error}</div>}
      <div className="grid md:grid-cols-2 gap-4 max-w-3xl">
        <Card title="Upload">
          <form action={importCsvAction} className="space-y-3" encType="multipart/form-data">
            <div>
              <label className="label">CSV file (max 5 MB)</label>
              <input className="input" type="file" name="file" accept=".csv,text/csv" required />
            </div>
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
              <div>
                <label className="label">Default city</label>
                <input className="input" name="city" />
              </div>
              <div>
                <label className="label">Default region</label>
                <input className="input" name="region" />
              </div>
              <div>
                <label className="label">Country</label>
                <input className="input" name="country" defaultValue="US" maxLength={2} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="autoResearch" /> Research and analyze imported businesses with websites
            </label>
            <button className="btn btn-primary">Import</button>
          </form>
        </Card>
        <Card title="Expected columns">
          <p className="text-sm text-ink-muted mb-2">Header names are matched loosely (case-insensitive). Only <code>name</code> is required.</p>
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
          <pre className="mt-3 text-[11px] bg-canvas border border-line rounded p-2 overflow-auto">{`name,website,phone,city,state\n"Acme Auto Repair",acmeauto.com,(512) 555-0100,Austin,TX`}</pre>
        </Card>
      </div>
    </>
  );
}
