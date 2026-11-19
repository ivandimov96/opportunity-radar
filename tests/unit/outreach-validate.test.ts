import { describe, expect, it } from "vitest";
import { buildEvidencePack, renderEvidencePack } from "@/lib/outreach/evidence";
import { EMAIL_LENGTH, capitalizeSubject, checkEmailText, hasBlock, introLine, openingLine, similarity, stripSignoff, wordCount } from "@/lib/outreach/validate";
import { composeEmailBody, signatureBlock } from "@/lib/outreach/drafts";
import { greetingFor } from "@/lib/ai/outreach";

const facts = [
  { key: "services", status: "verified", value: "AC repair, furnace installation, duct cleaning", evidenceQuote: "AC repair · Furnace installation · Duct cleaning", sourceUrl: "https://x.example/services" },
  { key: "maintenance_plans", status: "verified", value: "Comfort Club membership", evidenceQuote: "Join our Comfort Club for two tune-ups a year", sourceUrl: "https://x.example/" },
  { key: "years_in_business", status: "verified", value: "Since 1998", evidenceQuote: "Family-owned since 1998", sourceUrl: "https://x.example/" },
  { key: "booking_method", status: "verified", value: "online_form", evidenceQuote: "Request service with the form below", sourceUrl: "https://x.example/contact" },
  { key: "shop_management_tool", status: "verified", value: "Housecall Pro", evidenceQuote: "Resource loaded from book.housecallpro.com", sourceUrl: "https://x.example/" },
  { key: "website_health", status: "verified", value: "HTTPS; mobile viewport; homepage 492 KB", evidenceQuote: "Measured", sourceUrl: "https://x.example/" },
  { key: "email", status: "verified", value: "office@x.example", evidenceQuote: "office@x.example", sourceUrl: "https://x.example/contact" },
  { key: "reviews_on_site", status: "verified", value: "no", evidenceQuote: null, sourceUrl: null },
  { key: "booking_tool", status: "not_found", value: null },
  { key: "chat_tool", status: "not_found", value: null },
];
const observations = [{ ref: "o1", kind: "process", statement: "Quotes for replacements are given after an in-home visit.", evidenceQuote: "We schedule a free in-home estimate for every system replacement", sourceUrl: "https://x.example/services" }];
const pack = buildEvidencePack(facts, observations, { supportingFactKeys: ["o1", "booking_method", "booking_tool"] });

const body = `Hi Northside Air team,

I was reading about your Comfort Club and noticed that every system replacement starts with a free in-home estimate.

I'm Ivan, and I build small software tools for service businesses. It made me wonder whether people could pick a visit time themselves, alongside the tools you already run.

Shall I send over a short mock-up of how that could look?`;
const email = { subject: "Booking your in-home estimates", body, claims: [{ text: "every system replacement starts with a free in-home estimate", factKeys: ["o1"] }] };
const ctx = { pack, bookingLink: "https://cal.example/ivan", step: 0, others: [] as { subject: string; body: string; label: string }[] };
const codes = (b: string, extra: Partial<typeof ctx> = {}, e: Partial<typeof email> = {}) => checkEmailText({ ...email, ...e, body: b }, { ...ctx, ...extra }).map((i) => `${i.severity}:${i.code}`);

describe("evidence pack", () => {
  it("offers only verified content, cited evidence first, and lists only the gaps the opportunity rests on", () => {
    expect(pack.verified.map((v) => v.ref)).toEqual(["o1", "booking_method", "services", "maintenance_plans", "years_in_business", "shop_management_tool"]);
    expect(pack.notSeen.map((v) => v.ref)).toEqual(["booking_tool"]);
    const text = renderEvidencePack(pack);
    expect(text).toContain('[maintenance_plans] Maintenance plans / memberships: Comfort Club membership — their words: "Join our Comfort Club for two tune-ups a year"');
    expect(text).not.toMatch(/492 KB|office@x\.example/); // measurements and contact details are never offered to the writer
    expect(text).toMatch(/NOT SEEN ON THEIR SITE[\s\S]*\[booking_tool\] Online booking tool/);
  });
});

describe("fixed email checks", () => {
  it("passes a specific, grounded, friendly email", () => {
    const issues = checkEmailText(email, ctx);
    expect(issues).toEqual([]);
    // A first email is a short, friendly note.
    expect(wordCount(body)).toBeGreaterThanOrEqual(EMAIL_LENGTH.first.softMin);
    expect(wordCount(body)).toBeLessThanOrEqual(EMAIL_LENGTH.first.softMax);
  });
  it("blocks statements of absence, stock phrases, placeholders and an email without a question", () => {
    expect(codes(body.replace("It made me wonder", "You don't have online booking. It made me wonder"))).toContain("block:absence_stated");
    expect(codes(body.replace("I was reading", "I hope this email finds you well. I was reading"))).toContain("block:stock_phrase");
    expect(codes(body.replace("Northside Air team", "[Company] team"))).toContain("block:placeholder");
    expect(codes(body.replace("Shall I send over a short mock-up of how that could look?", "I could send over a short mock-up."))).toContain("block:no_question");
    expect(codes(body.replace("It made me wonder", "I didn't see a booking tool. It made me wonder"))).toContain("warn:not_seen");
  });
  it("blocks numbers and product names that are not in the research, but allows a length in minutes and verified ones", () => {
    expect(codes(body.replace("pick a visit time themselves", "pick a time themselves and save 30% of calls"))).toContain("block:number_not_in_evidence");
    expect(codes(body.replace("a short mock-up", "a 2-minute mock-up"))).not.toContain("block:number_not_in_evidence");
    expect(codes(body.replace("I was reading about your Comfort Club", "Reading about your Comfort Club (since 1998),"))).toEqual([]);
    expect(codes(body.replace("the tools you already run", "ServiceTitan"))).toContain("block:tool_not_verified");
    expect(codes(body.replace("the tools you already run", "Housecall Pro"))).not.toContain("block:tool_not_verified");
  });
  it("asks for one small thing: remarks on a second question, a proposed call and a long opening", () => {
    expect(codes(body.replace("already run.", "already run?"))).toEqual(["warn:several_questions"]);
    expect(codes(body.replace("Shall I send over a short mock-up of how that could look?", "Would a 15-minute call next week be useful?"))).toEqual(["warn:call_offer"]);
    expect(codes(body.replace("Shall I send over a short mock-up of how that could look?", "Shall I send a mock-up, or have a quick chat?"))).toEqual(["warn:call_offer"]);
    expect(codes(body.replace("starts with a free in-home estimate.", "starts with a free in-home estimate, which is a lovely way to begin.").replace(", alongside the tools you already run", ""))).toEqual(["warn:long_opening"]);
    // A follow-up may offer a call and need not end on a question.
    expect(codes("Hi Northside Air team,\n\nOne more thought on the in-home estimates: customers could pick the visit slot themselves. Happy to have a short call about it, and if this isn't a priority, no worries at all.", { step: 1 }, { claims: [] })).toEqual([]);
  });
  it("allows only the booking link and no email addresses", () => {
    expect(codes(`${body} https://cal.example/ivan`)).toEqual([]);
    expect(codes(`${body} https://bit.ly/abc`)).toContain("block:link");
    expect(codes(`${body} https://cal.example/ivan`, { bookingLink: "" })).toContain("block:link");
    expect(codes(`${body} Write to me@me.example.`)).toContain("block:email_address");
  });
  it("checks length, the subject and claims", () => {
    expect(codes("Hi team,\n\nWould a short call be useful?")).toContain("block:too_short");
    expect(codes(`${body}\n\n${body}`)).toContain("block:too_long");
    expect(checkEmailText({ ...email, subject: " " }, ctx).map((i) => i.code)).toContain("subject_missing");
    expect(checkEmailText({ ...email, claims: [{ text: "every system replacement starts with a free in-home estimate", factKeys: ["made_up"] }] }, ctx).map((i) => i.code)).toContain("claim_unsupported");
    expect(checkEmailText({ ...email, claims: [{ text: "this is not in the email", factKeys: ["o1"] }] }, ctx).map((i) => `${i.severity}:${i.code}`)).toEqual(["warn:claim_text"]);
  });
  it("holds back subjects that read like an advert or fake a reply, and remarks on long ones", () => {
    const subj = (subject: string) => checkEmailText({ ...email, subject }, ctx).map((i) => `${i.severity}:${i.code}`);
    expect(subj("An idea for your estimates")).toEqual([]);
    expect(subj("Fewer calls about estimates?")).toEqual([]);
    // A subject starts with a capital letter: written that way by code, remarked on when typed otherwise.
    expect(subj("an idea for your estimates")).toEqual(["warn:subject_lowercase"]);
    expect(capitalizeSubject("an idea for your estimates")).toBe("An idea for your estimates");
    expect(capitalizeSubject(" “your proofs, approved faster?”")).toBe("“Your proofs, approved faster?”");
    expect(capitalizeSubject("Northgate's delivery notes")).toBe("Northgate's delivery notes");
    expect(capitalizeSubject("3 ideas for your proofs")).toBe("3 ideas for your proofs"); // starts with a figure: left alone
    expect(subj("Free estimates at Northside Air")).toContain("block:subject_adword");
    expect(subj("Save 20% on scheduling")).toContain("block:subject_adword");
    expect(subj("Re: your estimates")).toContain("block:subject_fake_thread");
    expect(subj("An idea about how you could book your in-home estimate visits")).toContain("warn:subject_long");
    expect(subj("Booking your visits!")).toContain("warn:subject_exclamation");
    expect(subj("Booking? Visits?")).toContain("warn:subject_questions");
  });
  it("never lets an email call the recipient, or the sender's customers, small or local", () => {
    for (const phrase of ["small software tools for local service businesses", "software for small businesses like yours", "tools for small fabrication firms", "help for local shops"]) expect(codes(body.replace("small software tools for service businesses", phrase))).toContain("block:size_remark");
    expect(codes(body)).not.toContain("block:size_remark"); // "small software tools" describes the tool, not them
    // Their own words may be echoed.
    const own = buildEvidencePack([...facts, { key: "years_in_business", status: "verified", value: "Since 1998", evidenceQuote: "We are a small family business", sourceUrl: "https://x.example/" }], observations, { supportingFactKeys: ["o1"] });
    expect(codes(body.replace("It made me wonder", "A small family business with that kind of care made me wonder"), { pack: own })).not.toContain("block:size_remark");
  });
  it("notices a sentence repeated word for word in another email of the batch, such as the same self-introduction", () => {
    expect(introLine(body)).toBe("I'm Ivan, and I build small software tools for service businesses.");
    const other = { subject: "Something else", label: "Other Co", body: "Hi Other Co team,\n\nYour workshop page was a good read. I'm Ivan, and I build small software tools for service businesses. Would a short call be useful?" };
    const issues = checkEmailText(email, { ...ctx, others: [other] }).map((i) => `${i.severity}:${i.code}`);
    expect(issues).toEqual(["warn:same_sentence"]);
    expect(checkEmailText(email, { ...ctx, others: [{ ...other, body: other.body.replace("I'm Ivan, and I build small software tools for service businesses.", "Ivan here; I write small programs for small firms.") }] })).toEqual([]);
  });
  it("keeps emails in a batch from repeating each other", () => {
    const others = [{ subject: "booking your in-home estimates", body, label: "Other Co" }];
    const dup = checkEmailText(email, { ...ctx, others });
    expect(dup.map((i) => `${i.severity}:${i.code}`)).toEqual(["block:subject_duplicate", "warn:same_opening"]);
    expect(hasBlock(dup)).toBe(true);
    expect(similarity(body, body)).toBe(1);
    expect(similarity(body, "Something completely different about plumbing and drains in another city")).toBe(0);
    // A follow-up keeps the first subject and is short.
    expect(checkEmailText({ ...email, body: "Hi Northside Air team,\n\nOne more thought on the in-home estimates: would it help if customers could pick the visit slot themselves? If this isn't a priority, no worries at all." }, { ...ctx, step: 1, others }).filter((i) => i.severity === "block")).toEqual([]);
  });
});

describe("email text helpers", () => {
  it("strips a sign-off the writer added, finds the opening line, greets by a verified name only", () => {
    expect(stripSignoff("Hello,\n\nBody text.\n\nBest regards,\nIvan Dimov\n", "Ivan Dimov")).toBe("Hello,\n\nBody text.");
    expect(stripSignoff("Hello,\n\nBody text.\n\nCheers,\nIvan", "Ivan Dimov")).toBe("Hello,\n\nBody text.");
    expect(stripSignoff("Hello,\n\nThanks for reading this far.", "Ivan")).toBe("Hello,\n\nThanks for reading this far.");
    expect(openingLine(body)).toBe("I was reading about your Comfort Club and noticed that every system replacement starts with a free in-home estimate.");
    // Always the company, never a person's name found on a website.
    expect(greetingFor("Brightside A/C & Electrical")).toBe("Hi Brightside A/C & Electrical team,");
    expect(greetingFor("Riverbend Mechanical Services LLC")).toBe("Hi Riverbend Mechanical Services team,");
    expect(greetingFor("J. T. Harbour Steel Ltd.")).toBe("Hi J. T. Harbour Steel team,");
    expect(greetingFor("Northgate Metalworks Limited")).toBe("Hi Northgate Metalworks team,");
    expect(greetingFor("The Harbour Sign Co.")).toBe("Hi The Harbour Sign Co. team,"); // "Co." is part of the name, not a legal form
    expect(greetingFor("Allstar Electrical, Plumbing and Air Conditioning Services")).toBe("Hi Allstar Electrical, Plumbing and Air Conditioning Services team,");
    expect(greetingFor("An Extraordinarily Long Registered Company Name That Nobody Would Ever Say Aloud")).toBe("Hello,");
  });
  it("appends the sender's identity, postal address and an opt-out line in code", () => {
    const s = { senderName: "Ivan Dimov", senderTitle: "Founder", senderCompany: "Dimov Software", senderWebsite: "dimov.example", postalAddress: "1 Main St, Austin, TX 78701" };
    expect(signatureBlock(s)).toBe('Ivan Dimov\nFounder, Dimov Software\ndimov.example\n1 Main St, Austin, TX 78701\n\nIf this isn\'t relevant, just reply "no thanks" and I won\'t write again.');
    expect(composeEmailBody("Hello,\n\nBody.\n", s).startsWith("Hello,\n\nBody.\n\nIvan Dimov\n")).toBe(true);
  });
});
