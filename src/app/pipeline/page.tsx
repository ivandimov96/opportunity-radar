import { pipelineBoard } from "@/lib/queries";
import { PageHeader } from "@/components/ui";
import { FilterBar } from "@/components/table";
import { parseTableParams } from "@/lib/table";
import { listPlaybooks } from "@/lib/industries";
import type { PipelineStage } from "@/lib/pipeline/stages";
import { PipelineBoard, type BoardItem } from "./board";

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const t = parseTableParams(sp, { defaultSort: "priority", sortable: ["priority"] });
  const board = await pipelineBoard({ q: t.q || undefined, industry: sp.industry || undefined, demo: (sp.demo as "hide" | "only") || undefined });
  const items: BoardItem[] = Object.values(board)
    .flat()
    .map((r) => ({
      id: r.business.id,
      name: r.business.name,
      city: r.business.city,
      domain: r.business.websiteDomain,
      priority: r.business.priority,
      isDemo: r.business.isDemo,
      highPriority: r.prospect.priority === "high",
      draftCount: r.draftCount ?? 0,
      nextAction: r.prospect.nextAction,
      nextActionAt: r.prospect.nextActionAt,
      stage: r.prospect.stage as PipelineStage,
    }));
  return (
    <>
      <PageHeader title="Pipeline" subtitle="Prospects by stage. Research advances businesses automatically up to “outreach ready”; from there drag a card to the stage a real conversation puts it in." actions={<span className="text-xs text-ink-muted">{items.length} prospects</span>} />
      <FilterBar basePath="/pipeline" sp={sp} params={t} placeholder="Search prospects by name, city or domain">
        <select className="select w-auto" name="industry" defaultValue={sp.industry ?? ""}>
          <option value="">Any industry</option>
          {listPlaybooks().map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <select className="select w-auto" name="demo" defaultValue={sp.demo ?? ""}>
          <option value="">Real + demo</option>
          <option value="hide">Hide demo</option>
          <option value="only">Demo only</option>
        </select>
      </FilterBar>
      <PipelineBoard key={items.map((i) => `${i.id}:${i.stage}`).join("|")} items={items} />
    </>
  );
}
