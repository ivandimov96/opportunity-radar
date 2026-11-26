/**
 * The seller's postal address, in parts. Every email ends with it, so it is asked for as an address is
 * written (street, postal code, town, country) and each part is checked: a country from the list, a postal
 * code in that country's own form, a street and a town that read as one. The single line shown under the
 * name is put together from the parts in the order that country writes it.
 * Pure: no database, safe to import anywhere.
 */

export interface AddressParts {
  street: string;
  postalCode: string;
  city: string;
  /** ISO country code. */
  country: string;
}

const D = (n: number) => `\\d{${n}}`;
/** A country's postal code, the whole value. Countries not listed take any short code of letters and digits. */
const POSTAL: Record<string, { pattern: string; example: string }> = {
  US: { pattern: `${D(5)}(-${D(4)})?`, example: "78701" },
  CA: { pattern: "[A-Za-z]\\d[A-Za-z] ?\\d[A-Za-z]\\d", example: "K1A 0B1" },
  GB: { pattern: "[A-Za-z]{1,2}\\d[A-Za-z\\d]? ?\\d[A-Za-z]{2}", example: "LS1 4AB" },
  IE: { pattern: "[A-Za-z]\\d[\\dWw] ?[A-Za-z\\d]{4}", example: "D02 X285" },
  NL: { pattern: `${D(4)} ?[A-Za-z]{2}`, example: "1012 AB" },
  PL: { pattern: `${D(2)}-${D(3)}`, example: "00-950" },
  PT: { pattern: `${D(4)}-${D(3)}`, example: "1000-205" },
  BR: { pattern: `${D(5)}-?${D(3)}`, example: "01310-100" },
  JP: { pattern: `${D(3)}-?${D(4)}`, example: "100-0001" },
  ...Object.fromEntries(["CZ", "SK", "SE", "GR"].map((c) => [c, { pattern: `${D(3)} ?${D(2)}`, example: "110 00" }])),
  ...Object.fromEntries(["DE", "FR", "IT", "ES", "FI", "TR", "RS", "HR", "MX", "UA", "EE", "KR", "TH", "MY", "SA", "BA", "ME", "ID", "PK"].map((c) => [c, { pattern: D(5), example: "80802" }])),
  ...Object.fromEntries(["AT", "CH", "BE", "DK", "NO", "AU", "NZ", "HU", "BG", "MK", "SI", "LU", "ZA", "CY", "AL", "GE", "PH", "BD"].map((c) => [c, { pattern: D(4), example: "1000" }])),
  ...Object.fromEntries(["IN", "RO", "RU", "SG", "CN", "KZ", "VN", "BY"].map((c) => [c, { pattern: D(6), example: "110001" }])),
};
/** Countries that do not use postal codes: none is asked for. */
const NO_POSTAL_CODE = new Set(["AE", "HK", "QA", "PA", "BS", "JM", "FJ", "AO", "GH", "UG", "ZW", "BW", "CI", "CM"]);
/** Where the town is written before the postal code. */
const TOWN_FIRST = new Set(["US", "CA", "GB", "IE", "AU", "NZ", "IN", "ZA", "SG"]);
const ANY_POSTAL = "[A-Za-z0-9][A-Za-z0-9 \\-]{1,9}";

export const usesPostalCode = (country: string) => !NO_POSTAL_CODE.has(country.toUpperCase());
/** What a postal code of the country looks like: the pattern for the form, and an example to show. */
export function postalCodeRule(country: string): { pattern: string; example: string } {
  return POSTAL[country.toUpperCase()] ?? { pattern: ANY_POSTAL, example: "" };
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const hasLink = (text: string) => /https?:\/\/|www\.|\S+@\S+\.\S+/i.test(text);
const padded = (text: string) => /(\p{L})\1{3,}/iu.test(text) || /[!?]{2,}/.test(text);
const shouts = (text: string) => {
  const letters = text.replace(/[^\p{L}]/gu, "");
  return letters.length >= 8 && letters.replace(/[^\p{Lu}]/gu, "").length / letters.length > 0.7;
};

/** The parts as they are stored: single spaces, the postal code in capitals, the country as its code. */
export function tidyAddress(a: Partial<AddressParts>): AddressParts {
  return { street: oneLine(a.street ?? "").slice(0, 100), postalCode: oneLine(a.postalCode ?? "").toUpperCase().slice(0, 12), city: oneLine(a.city ?? "").slice(0, 80), country: oneLine(a.country ?? "").toUpperCase().slice(0, 2) };
}

export const addressGiven = (a: AddressParts) => Boolean(a.street || a.postalCode || a.city || a.country);

/**
 * What is wrong with a (tidied) address, in plain words; empty when it can be used. `isCountry` says whether a
 * code is a country of the list.
 */
export function addressProblems(a: AddressParts, isCountry: (code: string) => boolean): string[] {
  const out: string[] = [];
  if (!a.country || !isCountry(a.country)) out.push("Country: choose it from the list.");
  // A street is at least two words or a word and a number ("Mill Lane", "Damrak 1"): one word alone is not an address.
  if (a.street.length < 4 || (a.street.match(/\p{L}/gu) ?? []).length < 3 || a.street.split(/[\s,]+/).filter(Boolean).length < 2 || hasLink(a.street) || padded(a.street) || shouts(a.street)) out.push("Street: the street and number, as on a letter.");
  if (!/^\p{L}[\p{L}\p{M} .'’\-]{0,78}\p{L}\.?$/u.test(a.city) || padded(a.city)) out.push("Town or city: its name in letters.");
  if (a.country && isCountry(a.country)) {
    const rule = postalCodeRule(a.country);
    if (!usesPostalCode(a.country)) {
      if (a.postalCode && !new RegExp(`^(?:${ANY_POSTAL})$`).test(a.postalCode)) out.push("Postal code: leave it empty, or give a short code of letters and digits.");
    } else if (!new RegExp(`^(?:${rule.pattern})$`).test(a.postalCode) || !/\d/.test(a.postalCode)) out.push(`Postal code: as it is written in that country${rule.example ? `, for example ${rule.example}` : ""}.`);
  }
  return out;
}

/** The address on one line, in the order its country writes it: "12 Mill Lane, Leeds LS1 4AB, United Kingdom" or "Leopoldstrasse 12, 80802 Munich, Germany". */
export function formatAddress(a: AddressParts, countryName: string): string {
  const town = TOWN_FIRST.has(a.country) ? [a.city, a.postalCode] : [a.postalCode, a.city];
  return [a.street, town.filter(Boolean).join(" "), countryName].filter(Boolean).join(", ");
}
