import { describe, expect, it } from "vitest";
import { companyNameFor, companyNamesOnSite, domainLabel, withoutBranch } from "@/lib/outreach/company-name";
import { greetingFor } from "@/lib/ai/outreach";

describe("the name an email addresses the company by", () => {
  it("drops a branch or tagline from a map listing", () => {
    expect(withoutBranch("Harbour Training - Leeds North")).toBe("Harbour Training");
    expect(withoutBranch("Harbour Training | Forklift Courses")).toBe("Harbour Training");
    expect(withoutBranch("A - Z Training")).toBe("A - Z Training"); // too short to be a name on its own
    expect(domainLabel("https://www.harbour-training.example/centres/leeds/")).toBe("harbourtraining");
    expect(greetingFor(companyNameFor("Harbour Training - Leeds North", "https://harbourtraining.example"))).toBe("Hi Harbour Training team,");
    // A place added after the legal form is not part of the name.
    expect(withoutBranch("Delta Fire and Security Ltd Leeds")).toBe("Delta Fire and Security Ltd");
    expect(greetingFor(companyNameFor("Delta Fire and Security Ltd Leeds", "http://www.deltafireandsecurity.example"))).toBe("Hi Delta Fire and Security team,");
  });
  it("uses the registered name the site states when the listing is only a search phrase and the web address confirms it", () => {
    const pages = ["To take part in our courses at QV Training Ltd in Leeds, you must be 18.", "Home Courses Contact QV Training Ltd Terms"];
    expect(companyNamesOnSite(pages)[0]).toBe("QV Training Ltd");
    expect(companyNameFor("Forklift Training", "https://www.qvtraining.example", pages)).toBe("QV Training Ltd");
    expect(greetingFor(companyNameFor("Forklift Training", "https://www.qvtraining.example", pages))).toBe("Hi QV Training team,");
  });
  it("reads names with '&' and takes a name from a page title only when it is exactly the web address", () => {
    expect(companyNamesOnSite(["Welcome to QVS Fire & Security Ltd, installers since 1990."])[0]).toBe("QVS Fire & Security Ltd");
    const titles = ["QVS Fire & Security | Security Installer Leeds", "Contact us"];
    expect(companyNameFor("Allround Fire & Security Limited", "http://www.qvsfireandsecurity.example", [], titles)).toBe("QVS Fire & Security");
    expect(companyNameFor("Allround Fire & Security Limited", "http://www.qvsfireandsecurity.example", [], ["Security Installer Leeds | Alarms"])).toBe("Allround Fire & Security Limited");
  });
  it("keeps the listing name when the site's name does not match the web address, or nothing is stated", () => {
    const pages = ["Training Courses Apex Lift Truck Training Ltd About Us", "Apex Lift Truck Training Ltd has trained operators for years.", "© Apex Lift Truck Training Ltd"];
    expect(companyNamesOnSite(pages)[0]).toBe("Apex Lift Truck Training Ltd"); // not "Courses Apex …", which navigation text produced once
    // "Training Ltd" must never win because the address contains "training".
    expect(companyNameFor("Apex Lift Truck Training Ltd", "https://www.apextraining.example", pages)).toBe("Apex Lift Truck Training Ltd");
    expect(companyNameFor("Forklift Training", "https://www.qvtraining.example", [])).toBe("Forklift Training");
    expect(companyNameFor("Forklift Training", null, ["QV Training Ltd"])).toBe("Forklift Training");
  });
});
