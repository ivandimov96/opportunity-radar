import { describe, expect, it } from "vitest";
import { addressProblems, formatAddress, postalCodeRule, tidyAddress, usesPostalCode } from "@/lib/address";

const COUNTRIES = ["GB", "DE", "US", "MK", "NL", "PL", "AE", "FR", "CA", "XK"];
const known = (code: string) => COUNTRIES.includes(code);
const problems = (a: Parameters<typeof tidyAddress>[0]) => addressProblems(tidyAddress(a), known);

describe("postal address in parts", () => {
  it("accepts real addresses of different countries, each with its own form of postal code", () => {
    for (const a of [
      { street: "12 Mill Lane", postalCode: "ls1 4ab", city: "Leeds", country: "gb" },
      { street: "Leopoldstraße 12", postalCode: "80802", city: "München", country: "DE" },
      { street: "410 Congress Ave", postalCode: "78701-1234", city: "Austin", country: "US" },
      { street: "Partizanska 15", postalCode: "1000", city: "Skopje", country: "MK" },
      { street: "Damrak 1", postalCode: "1012 LG", city: "Amsterdam", country: "NL" },
      { street: "ul. Marszałkowska 1", postalCode: "00-950", city: "Warszawa", country: "PL" },
      { street: "8 Rue de la Paix", postalCode: "69002", city: "Saint-Étienne", country: "FR" },
      { street: "24 Sussex Drive", postalCode: "K1A 0B1", city: "Ottawa", country: "CA" },
      // A country without a rule of its own takes any short code of letters and digits.
      { street: "Rruga Nënë Tereza 5", postalCode: "10000", city: "Prishtina", country: "XK" },
    ])
      expect(problems(a), JSON.stringify(a)).toEqual([]);
  });

  it("refuses what is not an address, part by part, and says what is wanted", () => {
    expect(problems({ street: "asdf", postalCode: "x", city: "123", country: "ZZ" })).toEqual(["Country: choose it from the list.", "Street: the street and number, as on a letter.", "Town or city: its name in letters."]);
    expect(problems({ street: "12 Mill Lane", postalCode: "12345", city: "Leeds", country: "GB" })).toEqual(["Postal code: as it is written in that country, for example LS1 4AB."]);
    expect(problems({ street: "Hauptstrasse 5", postalCode: "8080", city: "Berlin", country: "DE" })[0]).toMatch(/Postal code/);
    expect(problems({ street: "12 Mill Lane", postalCode: "", city: "Leeds", country: "GB" })[0]).toMatch(/Postal code/);
    expect(problems({ street: "www.mysite.example", postalCode: "78701", city: "Austin", country: "US" })[0]).toMatch(/Street/);
    expect(problems({ street: "AAAAAAAA BBBBBB", postalCode: "78701", city: "Austin", country: "US" })[0]).toMatch(/Street/);
    expect(problems({ street: "1 Main Street", postalCode: "78701", city: "Austin 2", country: "US" })[0]).toMatch(/Town or city/);
    expect(problems({ street: "", postalCode: "", city: "", country: "" }).length).toBe(3);
  });

  it("asks for no postal code where none is used", () => {
    expect(usesPostalCode("AE")).toBe(false);
    expect(problems({ street: "Sheikh Zayed Road 14", postalCode: "", city: "Dubai", country: "AE" })).toEqual([]);
    expect(postalCodeRule("US").example).toBe("78701");
  });

  it("writes the one line in the order the country writes it", () => {
    expect(formatAddress(tidyAddress({ street: "12 Mill Lane", postalCode: "ls1 4ab", city: "Leeds", country: "GB" }), "United Kingdom")).toBe("12 Mill Lane, Leeds LS1 4AB, United Kingdom");
    expect(formatAddress(tidyAddress({ street: "Leopoldstrasse 12", postalCode: "80802", city: "Munich", country: "DE" }), "Germany")).toBe("Leopoldstrasse 12, 80802 Munich, Germany");
    expect(formatAddress(tidyAddress({ street: "Sheikh Zayed Road 14", postalCode: "", city: "Dubai", country: "AE" }), "United Arab Emirates")).toBe("Sheikh Zayed Road 14, Dubai, United Arab Emirates");
  });
});
