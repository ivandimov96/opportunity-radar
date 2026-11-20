import { describe, expect, it } from "vitest";
import { applyProfileRules, fieldLimits, PROFILE_RULES, refusal, tidy, tidyKind, type ProfileField } from "@/lib/profile-rules";

const takes = (field: ProfileField, value: string) => refusal(field, tidy(field, value)) === null;

describe("what the profile fields accept", () => {
  it("takes real names, addresses and links, in any alphabet", () => {
    for (const v of ["Nell Harbour", "Anne-Marie O'Neil", "J. R. Smith", "Иван Димов", "José Álvarez", "Li"]) expect(takes("senderName", v), v).toBe(true);
    for (const v of ["Harbour & Co", "3M", "Studio 54 Ltd."]) expect(takes("senderCompany", v), v).toBe(true);
    for (const v of ["Founder", "Head of Sales & Marketing", "CEO/Founder"]) expect(takes("senderTitle", v), v).toBe(true);
    for (const v of ["harbour.example", "https://www.harbour.example/about", "sub.harbour.co.uk"]) expect(takes("senderWebsite", v), v).toBe(true);
    for (const v of ["1 Quay Street, Leeds LS1 1AA, United Kingdom", "ul. Vitosha 15, Sofia 1000, Bulgaria", "PO Box 22222, Arlington, VA 22222, USA"]) expect(takes("postalAddress", v), v).toBe(true);
    expect(takes("bookingLink", "https://cal.example/nell/intro")).toBe(true);
    expect(takes("offer", "I build booking tools for small clinics.")).toBe(true);
    expect(takes("proofPoints", "Built the booking system of a dental practice in Leeds: calls down by a third.")).toBe(true);
  });

  it("refuses what would make an email look careless or fake", () => {
    for (const v of ["a", "12345", "Nell123", "nell@harbour.example", "NELL HARBOUR THE GREAT", "Nelllll", "<b>Nell</b>", "x".repeat(61)]) expect(takes("senderName", v), v).toBe(false);
    for (const v of ["-", "www.harbour.example", "!!!"]) expect(takes("senderCompany", v), v).toBe(false);
    for (const v of ["harbour", "not a site", "http://", "harbour .example"]) expect(takes("senderWebsite", v), v).toBe(false);
    for (const v of ["Leeds", "somewhere nice", "aaaaaaaaaaaaaaaa, 1", "1, 2, 3, 4, 5, 6, 7", "see harbour.com, 1"]) expect(takes("postalAddress", v), v).toBe(false);
    for (const v of ["cal.example/nell", "http://cal.example/nell", "https://nodot", "https://cal.example/a b"]) expect(takes("bookingLink", v), v).toBe(false);
    for (const v of ["a", "software", "WE BUILD THE BEST SOFTWARE IN THE WORLD", "Great tools, see https://harbour.example now", "Best tools ever!!! Buy them now", "a b c d e f g h i j k l m n o"]) expect(takes("offer", v), v).toBe(false);
    expect(takes("signature", Array(9).fill("line").join("\n"))).toBe(false);
    expect(takes("voiceSamples", "Hi.")).toBe(false);
  });

  it("leaves an empty field alone: what must be filled in is decided elsewhere", () => {
    for (const field of Object.keys(PROFILE_RULES) as ProfileField[]) expect(refusal(field, ""), field).toBeNull();
  });

  it("tidies what is saved and keeps the old value of what it refuses", () => {
    const patch: Record<string, unknown> = { senderName: "  Nell ​  Harbour ", senderWebsite: "not a site", offer: "I build   booking tools.\n\n\n\nFor clinics.  ", autoDraft: true };
    const refused = applyProfileRules(patch);
    expect(patch).toEqual({ senderName: "Nell Harbour", offer: "I build booking tools.\n\nFor clinics.", autoDraft: true });
    expect(refused).toEqual(["Website: an address like yourcompany.com."]);
  });

  it("gives the form the same limits, so the browser stops a wrong value first", () => {
    expect(fieldLimits("senderName")).toMatchObject({ minLength: 2, maxLength: 60, title: "Your own name in letters, without numbers or symbols" });
    // Every pattern is one the browser can compile (it uses the same flag).
    for (const field of Object.keys(PROFILE_RULES) as ProfileField[]) {
      const { pattern } = fieldLimits(field);
      if (pattern) expect(() => new RegExp(`^(?:${pattern})$`, "v"), field).not.toThrow();
    }
  });

  it("takes a kind of business only when it reads as one", () => {
    expect(tidyKind("  sign   makers, ")).toBe("sign makers");
    expect(tidyKind("Dentists")).toBe("Dentists");
    for (const v of ["a", "12", "!!!", "dentists@leeds", "www.dentists.com", "aaaaaaa", "x".repeat(61), "call 0888123456"]) expect(tidyKind(v), v).toBe("");
  });
});
