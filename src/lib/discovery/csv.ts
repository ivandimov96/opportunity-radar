/**
 * CSV import. Minimal RFC-4180-ish parser (quotes, escaped quotes, newlines in
 * quotes) so we avoid a dependency. Header names are matched loosely.
 */
import { createHash } from "node:crypto";
import type { BusinessCandidate } from "./types";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Record<string, string[]> = {
  name: ["name", "business", "business name", "company", "company name"],
  website: ["website", "url", "web", "site", "homepage", "domain"],
  phone: ["phone", "telephone", "phone number", "tel"],
  email: ["email", "e-mail", "contact email"],
  street: ["street", "address", "address1", "street address"],
  city: ["city", "town", "locality"],
  region: ["region", "state", "province"],
  postalCode: ["zip", "zipcode", "postal", "postal code", "postcode"],
  country: ["country"],
  category: ["category", "type", "industry"],
};

export function mapHeaders(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key) && map[field] === undefined) map[field] = i;
    }
  });
  return map;
}

export function csvToCandidates(text: string, defaults: { country: string; city?: string | null; region?: string | null }) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { candidates: [] as BusinessCandidate[], errors: ["CSV needs a header row and at least one data row"] };
  const map = mapHeaders(rows[0]);
  if (map.name === undefined) return { candidates: [] as BusinessCandidate[], errors: ["CSV must have a 'name' column"] };
  const errors: string[] = [];
  const candidates: BusinessCandidate[] = [];
  const get = (r: string[], f: string) => (map[f] !== undefined ? r[map[f]]?.trim() || null : null);
  rows.slice(1).forEach((r, idx) => {
    const name = get(r, "name");
    if (!name) {
      errors.push(`Row ${idx + 2}: missing name`);
      return;
    }
    const website = get(r, "website");
    const city = get(r, "city") ?? defaults.city ?? null;
    const fingerprint = createHash("sha1").update([name, website, city, get(r, "phone")].join("|").toLowerCase()).digest("hex").slice(0, 16);
    candidates.push({
      provider: "csv",
      providerId: fingerprint,
      name,
      website,
      phone: get(r, "phone"),
      email: get(r, "email"),
      street: get(r, "street"),
      city,
      region: get(r, "region") ?? defaults.region ?? null,
      postalCode: get(r, "postalCode"),
      country: get(r, "country") ?? defaults.country,
      category: get(r, "category"),
      attribution: "Operator-supplied CSV import",
      raw: { row: idx + 2 },
    });
  });
  return { candidates, errors };
}
