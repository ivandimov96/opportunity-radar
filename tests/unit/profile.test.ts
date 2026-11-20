import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseTargetPlaces, profileGaps, saysEnough, searchTargetsOf } from "@/lib/settings";

describe("the profile: what is sold, to whom, and what the search takes from it", () => {
  it("reads places a person typed: a country, or a country and one region; anything else is dropped", () => {
    expect(parseTargetPlaces("gb\nUS | tx\n\nnot a place\nGB\n| ENG")).toEqual([{ country: "GB", region: "" }, { country: "US", region: "TX" }]);
    expect(parseTargetPlaces([{ country: "de", region: "by" }, { country: "", region: "X" }, null])).toEqual([{ country: "DE", region: "BY" }]);
    expect(parseTargetPlaces(undefined)).toEqual([]);
  });

  it("makes the automatic search from the profile: every kind in every place, place by place", () => {
    const profile = { ...DEFAULT_SETTINGS, targetKinds: ["sign makers", "roofers"], targetPlaces: [{ country: "GB", region: "ENG" }, { country: "US", region: "" }] };
    expect(searchTargetsOf(profile)).toEqual([
      { what: "sign makers", country: "GB", region: "ENG" },
      { what: "roofers", country: "GB", region: "ENG" },
      { what: "sign makers", country: "US", region: "" },
      { what: "roofers", country: "US", region: "" },
    ]);
    // Half a profile searches nothing by itself; the older hand-kept list keeps working until the profile is filled in.
    const old = [{ what: "printers", country: "GB", region: "" }];
    expect(searchTargetsOf({ ...DEFAULT_SETTINGS, targetKinds: ["roofers"], searchTargets: old })).toEqual(old);
    expect(searchTargetsOf({ ...DEFAULT_SETTINGS, targetPlaces: [{ country: "GB", region: "" }], searchTargets: [] })).toEqual([]);
    expect(searchTargetsOf(DEFAULT_SETTINGS)).toEqual([]);
  });

  it("says in plain words what is missing for sending and for searching, each on its own", () => {
    expect(profileGaps(DEFAULT_SETTINGS)).toEqual({
      send: ["your name", "a postal address (required in commercial email)"],
      search: ["what you offer", "what your customer gets out of it", "the kinds of business you sell to", "where you sell"],
    });
    const filled = { ...DEFAULT_SETTINGS, senderName: "Nell Harbour", postalAddress: "1 Quay Street, Leeds", offer: "I build booking tools.", offerResult: "Fewer missed calls and no-shows.", targetKinds: ["dentists"], targetPlaces: [{ country: "GB", region: "" }] };
    expect(profileGaps(filled)).toEqual({ send: [], search: [] });
    // Being able to send says nothing about being able to search, and the other way round.
    expect(profileGaps({ ...filled, targetKinds: [] })).toEqual({ send: [], search: ["the kinds of business you sell to"] });
    expect(profileGaps({ ...filled, senderName: " ".trim() }).search).toEqual([]);
  });

  it("does not take a letter or a word for a description of what is sold", () => {
    for (const thin of ["", "a", "software", "aaaaaaaaaaaaaaaaaaaaaaaaaaaa", "a b c d e f g h i j k l m n", "   x          y          z   ", "12345 67890 12345 67890"]) expect(saysEnough(thin), thin).toBe(false);
    expect(saysEnough("I build booking tools.")).toBe(true);
    expect(saysEnough("Сайтове за малки фирми и магазини")).toBe(true);
    const filled = { ...DEFAULT_SETTINGS, offer: "a", offerResult: "Fewer missed calls and no-shows." };
    expect(profileGaps(filled).search).toContain("what you offer");
    expect(profileGaps(filled).search).not.toContain("what your customer gets out of it");
  });
});
