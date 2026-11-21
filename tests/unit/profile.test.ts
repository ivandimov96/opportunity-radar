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

describe("the seller: what the research and the writer are told about the operator", () => {
  it("is the built-in software consultancy while there is no profile, with the mock-up as the ask", async () => {
    const { sellerOf } = await import("@/lib/seller");
    const seller = sellerOf(DEFAULT_SETTINGS);
    expect(seller).toMatchObject({ isDefault: true, buildsSoftware: true, firstStep: "example", result: "", proof: "" });
    expect(seller.offer).toMatch(/custom software/);
  });

  it("is made of the profile, word for word, and of nothing else", async () => {
    const { sellerOf, sellerForResearch } = await import("@/lib/seller");
    const cleaner = sellerOf({ ...DEFAULT_SETTINGS, senderName: "Nell Harbour", offer: "Daily office cleaning for clinics, done after closing time.", offerResult: "A spotless practice every morning without managing cleaners.", targetKinds: ["dentists", "vets"], excludeKinds: ["hospitals"], targetSizes: ["small", "medium"], fitSigns: "Several treatment rooms.", proofPoints: "Clean 14 practices in Leeds." });
    expect(cleaner).toMatchObject({ isDefault: false, buildsSoftware: false, firstStep: "details" });
    const text = sellerForResearch(cleaner);
    for (const part of ["Daily office cleaning for clinics", "A spotless practice every morning", "dentists, vets", "hospitals", "small teams (2 to 10 people); medium companies (11 to 50 people)", "Several treatment rooms.", "Clean 14 practices in Leeds."]) expect(text).toContain(part);
    // What the profile leaves empty is not said.
    expect(sellerForResearch(sellerOf({ ...DEFAULT_SETTINGS, offer: "Bookkeeping for trades." }))).toBe("- What the seller offers: Bookkeeping for trades.");
    // A seller of software keeps the catalogue of software ideas; the chosen ask wins over the default.
    expect(sellerOf({ ...DEFAULT_SETTINGS, offer: "I build booking tools and websites.", firstStep: "quote" })).toMatchObject({ buildsSoftware: true, firstStep: "quote" });
  });

  it("writes the research prompt for the seller: the catalogue only for software, the seller's limits always", async () => {
    const { sellerOf } = await import("@/lib/seller");
    const { investigateSystem } = await import("@/lib/ai/prompts");
    const { getPlaybook } = await import("@/lib/industries");
    const cleaner = investigateSystem(getPlaybook("generic"), sellerOf({ ...DEFAULT_SETTINGS, offer: "Daily office cleaning for clinics, done after closing time.", excludeKinds: ["hospitals"], fitSigns: "Several treatment rooms." }));
    expect(cleaner).toContain("- What the seller offers: Daily office cleaning for clinics");
    expect(cleaner).toContain('Use category "other" for every opportunity');
    expect(cleaner).not.toContain("job_tracking (Job and production tracking)");
    expect(cleaner).toContain("each of the signs the seller named");
    expect(cleaner).toMatch(/no_opportunity[\s\S]*a business that sells the same thing as the seller/);
    expect(cleaner).not.toMatch(/software consultancy|one developer/);
    const builder = investigateSystem(getPlaybook("generic"));
    expect(builder).toContain("job_tracking (Job and production tracking)");
    expect(builder).toContain("custom software, integrations, automation and AI tools");
  });

  it("tells the writer what the sender offers, what their customers get, and what to ask for", async () => {
    const { buildOutreachInput } = await import("@/lib/ai/outreach");
    const base = { business: { id: "b1", name: "Idea Air" }, greeting: "Hi Idea Air team,", opportunity: { title: "T", problemHypothesis: "P", proposedSolution: "S", whyRelevant: null, components: [], validationQuestions: [] }, pack: { verified: [], notSeen: [], haystack: "" } as never, others: [] };
    const sender = { name: "Nell", company: "", offer: "Daily office cleaning for clinics.", result: "A spotless practice every morning.", proof: "Clean 14 practices in Leeds.", firstStep: "quote" as const, bookingLink: "", voiceSamples: "" };
    const first = buildOutreachInput({ ...base, sender, step: 0 });
    expect(first).toContain("What the sender offers, in the sender's own words: Daily office cleaning for clinics.");
    expect(first).toContain("What the sender's customers get out of it: A spotless practice every morning.");
    expect(first).toContain("What to ask for (the one question that ends this email): whether you may send them a rough idea of what it would cost");
    // A first email stays short: the result the sender can back up is kept for the follow-up.
    expect(first).not.toContain("Clean 14 practices");
    const followUp = buildOutreachInput({ ...base, sender, step: 1, firstEmail: { subject: "S", body: "Hi Idea Air team,\n\nBody." } });
    expect(followUp).toContain("A result the sender can back up (use at most one, in the sender's terms, adding nothing): Clean 14 practices in Leeds.");
    expect(followUp).toContain("What the first email asked for: whether you may send them a rough idea");
    // Without a profile the ask is the mock-up, as before.
    expect(buildOutreachInput({ ...base, sender: { name: "Ivan", company: "", offer: "", bookingLink: "", voiceSamples: "" }, step: 0 })).toContain("a short example (a mock-up, a sample or a draft");
  });

  it("offers a call or a free review as the ask for an adviser, and then a proposed call is not a fault", async () => {
    const { FIRST_STEPS, sellerOf } = await import("@/lib/seller");
    const { checkEmailText } = await import("@/lib/outreach/validate");
    expect(Object.keys(FIRST_STEPS)).toEqual(["example", "details", "quote", "trial", "review", "call"]);
    expect(sellerOf({ ...DEFAULT_SETTINGS, offer: "I advise family firms on pricing.", firstStep: "call" }).firstStep).toBe("call");
    const email = { subject: "Pricing for your trade accounts", body: "Hi Idea Air team,\n\nYour site lists separate prices for trade accounts and the public. I'm Nell; I advise family firms on how they set prices, and I'd look at where yours leave money behind. I can't see from outside how you set them today.\n\nWould you be open to a short call?", claims: [] };
    const ctx = { pack: { verified: [], notSeen: [], haystack: "" } as never, step: 0, others: [] };
    expect(checkEmailText(email, ctx).map((i) => i.code)).toContain("call_offer");
    expect(checkEmailText(email, { ...ctx, callIsTheAsk: true }).map((i) => i.code)).not.toContain("call_offer");
  });

  it("shows the writer the sender's recent emails in full, so the new one resembles none of them", async () => {
    const { buildOutreachInput, FULL_PEERS } = await import("@/lib/ai/outreach");
    const { OUTREACH_SYSTEM } = await import("@/lib/ai/prompts");
    const others = Array.from({ length: 8 }, (_, i) => ({ subject: `Subject ${i}`, body: `Hi Company ${i} team,\n\nOpening fact ${i}.\n\nMiddle sentence number ${i} of the email.\n\nClosing question ${i}?`, label: `Company ${i}` }));
    const input = buildOutreachInput({ business: { id: "b1", name: "Idea Air" }, greeting: "Hi Idea Air team,", sender: { name: "Nell", company: "", offer: "Daily office cleaning.", bookingLink: "", voiceSamples: "" }, opportunity: { title: "T", problemHypothesis: "P", proposedSolution: "S", whyRelevant: null, components: [], validationQuestions: [] }, pack: { verified: [], notSeen: [], haystack: "" } as never, step: 0, others });
    expect(input.match(/<other_email /g)).toHaveLength(FULL_PEERS);
    expect(input).toContain("Middle sentence number 0 of the email.");
    expect(input).not.toContain("Middle sentence number 7 of the email."); // older ones are shown by subject and opening only
    expect(input).toContain("Subject: Subject 7");
    expect(OUTREACH_SYSTEM).toMatch(/should not recognise a template/);
    expect(OUTREACH_SYSTEM).toMatch(/could not be pasted unchanged into an email to another company/);
    expect(OUTREACH_SYSTEM).toMatch(/never the wording/);
  });

  it("lets an email use a figure the sender gave about themselves, and no other", async () => {
    const { checkEmailText } = await import("@/lib/outreach/validate");
    const email = { subject: "Cleaner mornings?", body: "Hi Idea Air team,\n\nYour new treatment rooms caught my eye. I'm Nell, and we clean 14 practices in Leeds after closing time, so mornings start spotless without anyone managing cleaners.\n\nMay I send you a rough price for your practice?", claims: [] };
    const ctx = { pack: { verified: [], notSeen: [], haystack: "" } as never, step: 1, others: [] };
    expect(checkEmailText(email, ctx).map((i) => i.code)).toContain("number_not_in_evidence");
    expect(checkEmailText(email, { ...ctx, senderSays: "Clean 14 practices in Leeds." }).map((i) => i.code)).not.toContain("number_not_in_evidence");
  });
});
