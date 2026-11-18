import { describe, expect, it } from "vitest";
import { DEFAULT_RANGE, describeRange, presetDays, rangeBounds, rangeParams, resolveRange } from "@/lib/date-range";

const now = new Date(2026, 10, 18, 15, 30); // 18 Nov 2026, local time

describe("date ranges", () => {
  it("is the last 7 days when nothing is chosen, today included", () => {
    expect(DEFAULT_RANGE).toBe("7d");
    expect(resolveRange({}, now)).toEqual({ key: "7d", from: "2026-11-12", to: "2026-11-18" });
    expect(resolveRange({ range: "nonsense" }, now)).toEqual({ key: "7d", from: "2026-11-12", to: "2026-11-18" });
  });
  it("turns each choice into whole calendar days", () => {
    expect(presetDays("today", now)).toEqual({ from: "2026-11-18", to: "2026-11-18" });
    expect(presetDays("yesterday", now)).toEqual({ from: "2026-11-17", to: "2026-11-17" });
    expect(presetDays("30d", now)).toEqual({ from: "2026-10-20", to: "2026-11-18" });
    expect(presetDays("month", now)).toEqual({ from: "2026-11-01", to: "2026-11-18" });
    expect(presetDays("last_month", now)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetDays("year", now)).toEqual({ from: "2026-01-01", to: "2026-11-18" });
    expect(presetDays("all", now)).toEqual({ from: null, to: null });
    expect(presetDays("last_month", new Date(2026, 0, 10))).toEqual({ from: "2025-12-01", to: "2025-12-31" }); // across a year end
  });
  it("accepts custom dates only when they are real days, and puts them in order", () => {
    expect(resolveRange({ range: "custom", from: "2026-11-18", to: "2026-11-01" }, now)).toEqual({ key: "custom", from: "2026-11-01", to: "2026-11-18" });
    expect(resolveRange({ from: "2026-11-03" }, now)).toEqual({ key: "custom", from: "2026-11-03", to: null });
    expect(resolveRange({ range: "custom", from: "yesterday", to: "2026-13-45" }, now).key).toBe("7d");
  });
  it("describes the period in words and reproduces it in a link", () => {
    expect(describeRange(resolveRange({}, now))).toBe("last 7 days");
    expect(describeRange(resolveRange({ range: "all" }, now))).toBe("all time");
    expect(describeRange({ key: "custom", from: "2026-11-03", to: "2026-11-05" })).toBe("Nov 3, 2026 to Nov 5, 2026");
    expect(rangeParams(resolveRange({}, now))).toEqual({});
    expect(rangeParams(resolveRange({ range: "month" }, now))).toEqual({ range: "month" });
    expect(rangeParams({ key: "custom", from: "2026-11-03", to: null })).toEqual({ range: "custom", from: "2026-11-03" });
  });
  it("covers whole days: the first moment of the first day to the last moment of the last", () => {
    const b = rangeBounds({ from: "2026-11-18", to: "2026-11-18" });
    expect(new Date(b.fromIso!).getTime()).toBe(new Date(2026, 10, 18, 0, 0, 0, 0).getTime());
    expect(new Date(b.toIso!).getTime()).toBe(new Date(2026, 10, 18, 23, 59, 59, 999).getTime());
    expect(rangeBounds({ from: null, to: null })).toEqual({ fromIso: null, toIso: null });
  });
});
