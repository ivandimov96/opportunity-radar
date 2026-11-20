import { describe, expect, it } from "vitest";
import { citiesFor, pickNextSearch } from "@/lib/discovery/auto-search";
import { senderDomainHealth } from "@/lib/email/domain-health";
import type { Place } from "@/lib/geo/world";
import { answerNeedsYou } from "@/lib/outreach/answers";
import { judgeHealth, releaseTime } from "@/lib/outreach/autopilot";
import { warmUpCap } from "@/lib/outreach/limits";
import { stepLabel, stepNoun } from "@/lib/outreach/steps";
import { checkAnswerText, lengthFor } from "@/lib/outreach/validate";
import { parseSearchTargets, searchTargetsText } from "@/lib/settings";

const place = (name: string, country: string, region: string | null, population: number): Place => ({ name, asciiName: name, country, region, population, lat: 0, lon: 0 });
const PLACES = [place("London", "GB", "ENG", 8_900_000), place("Birmingham", "GB", "ENG", 1_100_000), place("Glasgow", "GB", "SCT", 600_000), place("Ely", "GB", "ENG", 20_000), place("Houston", "US", "TX", 2_300_000)];

describe("search targets", () => {
  it("reads one target per line and drops lines without a business type or a country", () => {
    const t = parseSearchTargets("sign makers | gb\n roofers|US|tx \nno country here\n | GB\nsign makers | GB\n");
    expect(t).toEqual([{ what: "sign makers", country: "GB", region: "" }, { what: "roofers", country: "US", region: "TX" }]);
    expect(searchTargetsText(t)).toBe("sign makers | GB\nroofers | US | TX");
    expect(parseSearchTargets(t)).toEqual(t); // the stored form reads back unchanged
  });

  it("walks the cities of a target largest first, skips small towns and never repeats a city", () => {
    const gb = { what: "sign makers", country: "GB", region: "" };
    expect(citiesFor(gb, PLACES).map((p) => p.name)).toEqual(["London", "Birmingham", "Glasgow"]);
    expect(citiesFor({ ...gb, region: "SCT" }, PLACES).map((p) => p.name)).toEqual(["Glasgow"]);
    expect(pickNextSearch([gb], [], PLACES)!.place.name).toBe("London");
    expect(pickNextSearch([gb], [{ what: "Sign Makers", country: "GB", city: "london" }], PLACES)!.place.name).toBe("Birmingham");
    // Another kind of business in the same city does not count as searched.
    expect(pickNextSearch([gb], [{ what: "roofers", country: "GB", city: "London" }], PLACES)!.place.name).toBe("London");
    const all = ["London", "Birmingham", "Glasgow"].map((city) => ({ what: "sign makers", country: "GB", city }));
    expect(pickNextSearch([gb], all, PLACES)).toBeNull();
  });

  it("advances several targets side by side: the one searched least goes next", () => {
    const a = { what: "sign makers", country: "GB", region: "" };
    const b = { what: "roofers", country: "US", region: "TX" };
    expect(pickNextSearch([a, b], [], PLACES)!.target).toBe(a);
    const next = pickNextSearch([a, b], [{ what: "sign makers", country: "GB", city: "London" }], PLACES)!;
    expect([next.target.what, next.place.name]).toEqual(["roofers", "Houston"]);
    // A target with nothing left does not block the others.
    expect(pickNextSearch([b, a], [{ what: "roofers", country: "US", city: "Houston" }, { what: "sign makers", country: "GB", city: "London" }], PLACES)!.place.name).toBe("Birmingham");
  });
});

describe("sending limits and safety", () => {
  it("starts at 10 a day and adds 5 for each full week since the first email", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
    expect([warmUpCap(null, now), warmUpCap(ago(0), now), warmUpCap(ago(6), now), warmUpCap(ago(7), now), warmUpCap(ago(15), now), warmUpCap(ago(70), now)]).toEqual([10, 10, 10, 15, 20, 60]);
  });

  it("pauses on a real pattern, not on a single case", () => {
    const ok = { sent: 40, bounced: 0, optOuts: 0, failedToday: 0 };
    expect(judgeHealth(ok)).toBeNull();
    expect(judgeHealth({ ...ok, bounced: 1 })).toBeNull(); // one bounce is not a trend
    expect(judgeHealth({ ...ok, sent: 50, bounced: 2 })).toBeNull(); // 4%
    expect(judgeHealth({ ...ok, bounced: 2 })).toMatch(/2 of the last 40 emails bounced/);
    expect(judgeHealth({ ...ok, optOuts: 3 })).toMatch(/3 of the last 40 recipients asked not to be contacted/);
    expect(judgeHealth({ ...ok, failedToday: 3 })).toMatch(/could not be sent/);
  });

  it("releases a held email after the waiting time, an automatic one at once, a manual one never", () => {
    const at = "2026-11-20T10:00:00.000Z";
    expect(releaseTime(at, { sendMode: "manual", holdHours: 4 })).toBeNull();
    expect(releaseTime(at, { sendMode: "hold", holdHours: 4 })!.toISOString()).toBe("2026-11-20T14:00:00.000Z");
    expect(releaseTime(at, { sendMode: "auto", holdHours: 4 })!.toISOString()).toBe(at);
  });

  it("reads a domain's sending records and says plainly what is missing", async () => {
    const dns = (records: Record<string, string[][]>) => async (name: string) => {
      if (name in records) return records[name];
      throw Object.assign(new Error("no data"), { code: "ENODATA" });
    };
    const good = await senderDomainHealth("ivan@studio.example", dns({ "studio.example": [["v=spf1 include:_spf.google.com ~all"]], "_dmarc.studio.example": [["v=DMARC1; ", "p=none"]] }));
    expect(good).toMatchObject({ domain: "studio.example", freeMailbox: false, spf: true, dmarc: true, advice: [] });
    const bare = await senderDomainHealth("ivan@studio.example", dns({ "studio.example": [["google-site-verification=abc"]] }));
    expect(bare).toMatchObject({ spf: false, dmarc: false });
    expect(bare!.advice.join(" ")).toMatch(/no SPF record.*no DMARC record/);
    const free = await senderDomainHealth("someone@gmail.com", async () => { throw new Error("must not be looked up"); });
    expect(free).toMatchObject({ freeMailbox: true, spf: null });
    expect(free!.advice[0]).toMatch(/free gmail\.com address/);
    const offline = await senderDomainHealth("ivan@studio.example", async () => { throw Object.assign(new Error("net"), { code: "ECONNREFUSED" }); });
    expect(offline).toMatchObject({ spf: null, dmarc: null });
    expect(offline!.advice[0]).toMatch(/could not be looked up/);
  });
});

describe("answers and sequence steps", () => {
  it("lets only the answers that need no decision go on their own", () => {
    const base = { confidence: 0.95, matchedBy: "thread", answersSent: 0 };
    expect(answerNeedsYou({ ...base, category: "wants_meeting" })).toEqual([]);
    expect(answerNeedsYou({ ...base, category: "not_now" })).toEqual([]);
    expect(answerNeedsYou({ ...base, category: "interested" })[0]).toMatch(/They said yes/);
    expect(answerNeedsYou({ ...base, category: "wants_info" })[0]).toMatch(/asked a question/);
    expect(answerNeedsYou({ ...base, category: "wrong_person" })[0]).toMatch(/someone else/);
    expect(answerNeedsYou({ ...base, category: "wants_meeting", confidence: 0.6 })[0]).toMatch(/not sure/);
    expect(answerNeedsYou({ ...base, category: "wants_meeting", confidence: null })[0]).toMatch(/not sure/);
    expect(answerNeedsYou({ ...base, category: "wants_meeting", matchedBy: "address" })[0]).toMatch(/sender address only/);
    expect(answerNeedsYou({ ...base, category: "not_now", answersSent: 2 })[0]).toMatch(/2 answers have already gone out/);
    // The operator's own rule for a kind of reply: told to send it, the standing "only you can" reason no longer holds it back...
    expect(answerNeedsYou({ ...base, category: "interested", action: "send" })).toEqual([]);
    expect(answerNeedsYou({ ...base, category: "wants_info", action: "review" })[0]).toMatch(/asked a question/);
    // ...but an unsure reading or a long conversation still does.
    expect(answerNeedsYou({ ...base, category: "interested", action: "send", confidence: 0.5 })[0]).toMatch(/not sure/);
    expect(answerNeedsYou({ ...base, category: "interested", action: "send", answersSent: 2 })[0]).toMatch(/2 answers have already gone out/);
  });

  it("holds back an answer with a gap, a foreign link or no text", () => {
    const codes = (body: string, bookingLink = "https://cal.example/ivan") => checkAnswerText(body, { bookingLink }).filter((i) => i.severity === "block").map((i) => i.code);
    expect(codes("Hi Maria,\n\nGlad to. Pick any slot here: https://cal.example/ivan")).toEqual([]);
    expect(codes("Hi Maria,\n\nThursday works. Would [time] suit you?")).toEqual(["placeholder"]);
    expect(codes("Hi Maria,\n\nHave a look at https://other.example/page first.")).toEqual(["link"]);
    expect(codes("Hi Maria,\n\nPick a slot: https://cal.example/ivan", "")).toEqual(["link"]);
    expect(codes("Ok")).toEqual(["too_short"]);
  });

  it("names every step and gives each its own length", () => {
    expect([0, 1, 2, 3, 9].map(stepLabel)).toEqual(["First email", "Follow-up", "Last note", "Check-back", "Answer"]);
    expect([0, 1, 2, 3, 9].map(stepNoun)).toEqual(["email", "follow-up", "last note", "check-back", "answer"]);
    expect([lengthFor(0).softMax, lengthFor(1).softMax, lengthFor(2).softMax, lengthFor(3).softMax, lengthFor(9).softMax]).toEqual([65, 60, 40, 60, 110]);
  });
});
