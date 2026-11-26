import { describe, expect, it } from "vitest";
import { MAX_BENEFITS, MAX_SERVICES, PROFESSIONS, START_BENEFITS, START_SERVICES, offerText, professionOf, resultText } from "@/lib/professions";
import { MAX_KINDS, refusal, saysEnough, tidy, tidyKind } from "@/lib/profile-rules";
import { FIRST_STEP_KEYS } from "@/lib/seller";

const accepted = (field: "offer" | "offerResult", text: string) => saysEnough(text) && refusal(field, tidy(field, text)) === null && tidy(field, text) === text;

describe("profession head starts", () => {
  it("writes a description from the services ticked, and the benefit from what customers value", () => {
    const cleaning = professionOf("cleaning")!;
    expect(offerText(cleaning, ["daily office cleaning"])).toBe("We do daily office cleaning in the evening or early morning, with our own trained staff.");
    expect(offerText(cleaning, ["daily office cleaning", "deep cleans", "window cleaning"])).toBe("We do daily office cleaning, deep cleans and window cleaning in the evening or early morning, with our own trained staff.");
    expect(offerText(cleaning, [])).toBe("");
    expect(resultText(["a clean workplace every morning"])).toBe("A clean workplace every morning.");
    expect(resultText(["a clean workplace every morning", "one invoice for everything"])).toBe("A clean workplace every morning, and one invoice for everything.");
    expect(resultText(["books that are always up to date", "no surprises at tax time", "someone who answers the phone"])).toBe("Books that are always up to date, no surprises at tax time, and someone who answers the phone.");
    expect(resultText([])).toBe("");
  });

  it("every text it can write would be accepted by the profile rules exactly as written", () => {
    expect(PROFESSIONS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(PROFESSIONS.map((p) => p.key)).size).toBe(PROFESSIONS.length);
    for (const p of PROFESSIONS) {
      expect(p.services.length, p.key).toBeGreaterThanOrEqual(6);
      expect(p.benefits.length, p.key).toBeGreaterThanOrEqual(4);
      // What a person sees first, the shortest it can be, and the longest.
      expect(accepted("offer", offerText(p, p.services.slice(0, START_SERVICES))), `${p.key} start`).toBe(true);
      for (const one of p.services) expect(accepted("offer", offerText(p, [one])), `${p.key}: ${one}`).toBe(true);
      const longest = [...p.services].sort((a, b) => b.length - a.length).slice(0, MAX_SERVICES);
      expect(accepted("offer", offerText(p, longest)), `${p.key} longest`).toBe(true);
      expect(accepted("offerResult", resultText(p.benefits.slice(0, START_BENEFITS))), `${p.key} start`).toBe(true);
      for (const one of p.benefits) expect(accepted("offerResult", resultText([one])), `${p.key}: ${one}`).toBe(true);
      const most = [...p.benefits].sort((a, b) => b.length - a.length).slice(0, MAX_BENEFITS);
      expect(accepted("offerResult", resultText(most)), `${p.key} longest`).toBe(true);
      expect(refusal("fitSigns", tidy("fitSigns", p.fitSigns)), p.key).toBeNull();
      expect(FIRST_STEP_KEYS).toContain(p.firstStep);
      expect(p.kinds.length).toBeGreaterThanOrEqual(4);
      expect(p.kinds.length).toBeLessThanOrEqual(MAX_KINDS);
      for (const k of p.kinds) expect(tidyKind(k), `${p.key}: ${k}`).toBe(k);
    }
  });

  it("finds one by its key and nothing for anything else", () => {
    expect(professionOf("cleaning")?.label).toBe("Commercial cleaning");
    expect(professionOf("")).toBeNull();
    expect(professionOf("nonsense")).toBeNull();
  });
});
