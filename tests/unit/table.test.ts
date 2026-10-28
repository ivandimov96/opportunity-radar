import { describe, expect, it } from "vitest";
import { buildQuery, dateBounds, pageCount, paginate, parseTableParams } from "@/lib/table";

describe("table model", () => {
  const opts = { defaultSort: "priority", sortable: ["priority", "name", "updated"], pageSize: 50, dateFields: ["createdAt", "investigatedAt"] };
  it("validates sort, direction, page and date range from URL params", () => {
    expect(parseTableParams({}, opts)).toMatchObject({ q: "", sort: "priority", dir: "desc", page: 1, pageSize: 50, from: null, to: null, dateField: "createdAt" });
    expect(parseTableParams({ sort: "name", dir: "asc", page: "3", pageSize: "20", from: "2026-10-01", to: "2026-10-31", dateField: "investigatedAt", q: "  swedish " }, opts)).toMatchObject({ q: "swedish", sort: "name", dir: "asc", page: 3, pageSize: 20, from: "2026-10-01", to: "2026-10-31", dateField: "investigatedAt" });
    expect(parseTableParams({ sort: "bogus", dir: "sideways", page: "-4", pageSize: "9999", from: "yesterday", dateField: "nope" }, opts)).toMatchObject({ sort: "priority", dir: "desc", page: 1, pageSize: 200, from: null, dateField: "createdAt" });
  });
  it("turns calendar days into inclusive ISO bounds", () => {
    expect(dateBounds("2026-10-01", "2026-10-31")).toEqual({ fromIso: "2026-10-01T00:00:00.000Z", toIso: "2026-10-31T23:59:59.999Z" });
    expect(dateBounds(null, null)).toEqual({ fromIso: null, toIso: null });
  });
  it("builds query strings that keep other filters and reset the page on a filter change", () => {
    const sp = { q: "x", sort: "name", page: "3", industry: "auto_repair" };
    expect(buildQuery(sp, { sort: "updated", dir: "desc" })).toBe("?q=x&sort=updated&industry=auto_repair&dir=desc");
    expect(buildQuery(sp, { page: 4 })).toBe("?q=x&sort=name&page=4&industry=auto_repair");
    expect(buildQuery(sp, { q: "" })).toBe("?sort=name&industry=auto_repair");
    expect(buildQuery({}, {})).toBe("");
  });
  it("paginates", () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(101, 50)).toBe(3);
    expect(paginate([1, 2, 3, 4, 5], { q: "", sort: "", dir: "asc", page: 2, pageSize: 2, from: null, to: null, dateField: null })).toEqual({ rows: [3, 4], total: 5 });
  });
});
