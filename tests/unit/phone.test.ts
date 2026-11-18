import { describe, expect, it } from "vitest";
import { formatPhone } from "@/lib/phone";

describe("formatPhone", () => {
  it("formats North American numbers with and without the country code", () => {
    expect(formatPhone("5124477801", "US")).toBe("(512) 447-7801");
    expect(formatPhone("15124477801", "US")).toBe("(512) 447-7801"); // a US business shows its number nationally
    expect(formatPhone("+15124477801", "CA")).toBe("+1 (512) 447-7801");
    expect(formatPhone("5124477801", null)).toBe("(512) 447-7801"); // 10 digits and no country: assume NANP
  });
  it("formats European numbers in international form with the trunk zero dropped", () => {
    expect(formatPhone("02079460958", "GB")).toBe("+44 20 7946 0958");
    expect(formatPhone("+442079460958", "GB")).toBe("+44 20 7946 0958");
    expect(formatPhone("030123456", "DE")).toBe("+49 30 123 456");
    expect(formatPhone("0612345678", "FR")).toBe("+33 6 12 34 56 78");
    expect(formatPhone("0888123456", "BG")).toBe("+359 888 123 456");
    expect(formatPhone("0034912345678", "ES")).toBe("+34 912 345 678");
  });
  it("keeps unknown shapes readable", () => {
    expect(formatPhone("+61298765432", null)).toBe("+61 298 765 432");
    expect(formatPhone("123456789", null)).toBe("123 456 789");
    expect(formatPhone("", "US")).toBe("");
    expect(formatPhone(null, "US")).toBe("");
  });
});
