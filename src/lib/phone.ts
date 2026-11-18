/**
 * Display formatting for stored phone numbers. Numbers are stored as digits
 * (US numbers without the leading 1, see normalizePhone); the business's
 * country decides how they are shown:
 *   US/CA (NANP)   5124477801      → (512) 447-7801
 *   GB             02079460958     → 020 7946 0958,  +442079460958 → +44 20 7946 0958
 *   DE, FR, …      030123456       → +49 30 123 456 (national trunk 0 dropped, groups of 3–4; FR in pairs)
 *   unknown        kept as stored, lightly grouped when it starts with +
 */

/** Country calling codes for the countries the app targets; others fall back to generic grouping. */
const CALLING_CODES: Record<string, string> = {
  US: "1", CA: "1", GB: "44", IE: "353", DE: "49", AT: "43", CH: "41", FR: "33", BE: "32", NL: "31", LU: "352",
  ES: "34", PT: "351", IT: "39", DK: "45", SE: "46", NO: "47", FI: "358", PL: "48", CZ: "420", SK: "421", HU: "36",
  RO: "40", BG: "359", GR: "30", HR: "385", SI: "386", RS: "381", UA: "380", TR: "90", AU: "61", NZ: "64", MX: "52",
  BR: "55", AR: "54", CL: "56", CO: "57", ZA: "27", IN: "91", SG: "65", AE: "971", IL: "972", JP: "81", KR: "82",
};

const NANP = new Set(["US", "CA"]);

function groupDigits(d: string): string {
  // Split from the right into groups of 3, keeping a 4-digit head when the count is 4 or 7 etc.
  const groups: string[] = [];
  let rest = d;
  while (rest.length > 4) {
    groups.unshift(rest.slice(-3));
    rest = rest.slice(0, -3);
  }
  groups.unshift(rest);
  return groups.join(" ");
}

export function formatPhone(phone: string | null | undefined, country?: string | null): string {
  if (!phone) return "";
  const raw = phone.trim();
  const plus = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("00")) digits = digits.slice(2);
  if (!digits) return raw;
  const cc = country ? CALLING_CODES[country.toUpperCase()] : undefined;

  // North America: 10 national digits, optionally with the country code.
  if ((cc === "1" || (!country && digits.length === 10)) && !plus) {
    const n = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (n.length === 10) return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1") && plus) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;

  // International form: +CC then the national number in groups.
  if (plus) {
    const code = cc && digits.startsWith(cc) ? cc : Object.values(CALLING_CODES).filter((c) => digits.startsWith(c)).sort((a, b) => b.length - a.length)[0];
    if (code) return `+${code} ${nationalGroups(digits.slice(code.length), code)}`;
    return `+${digits}`;
  }

  // National form with a known country: drop the trunk 0 and show the international form.
  if (cc && cc !== "1") {
    const national = digits.replace(/^0/, "");
    return `+${cc} ${nationalGroups(national, cc)}`;
  }
  return groupDigits(digits);
}

/** UK numbers read best as area code + two groups; everything else as groups of 3–4. */
function nationalGroups(n: string, cc: string): string {
  if (cc === "44" && n.length === 10) return `${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6)}`;
  if (cc === "33" && n.length === 9) return `${n[0]} ${n.slice(1, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
  return groupDigits(n);
}
