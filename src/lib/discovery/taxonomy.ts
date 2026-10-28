/**
 * Category mapping layer: translates an industry (and optional sub-types or a
 * free-text category) into what each source understands, and records which
 * mapping matched a result.
 *
 * Overture: the places taxonomy is a tree; every record carries
 * `taxonomy.primary` plus `taxonomy.hierarchy` (root → primary). A spec names
 * hierarchy nodes (any descendant matches), exact primaries, and exclusions for
 * neighbours that share a parent but are not the target (car washes, detailing
 * and towing live under automotive_service). Names were verified against the
 * 2026-10-21.0 release (Austin box) — see docs/SEARCH.md for the method.
 *
 * OpenStreetMap: tag selectors from the industry playbooks (`["shop"="car_repair"]`,
 * name-pattern nets for mis-tagged entries). The selector syntax is parsed here
 * so stored OSM records can be re-matched locally without another Overpass call.
 */
import { getPlaybook, selectorsFor, type IndustryPlaybook } from "@/lib/industries";

export interface OvertureSpec {
  /** Hierarchy nodes: a place matches when its taxonomy path contains any of these. */
  hierarchy: string[];
  /** Exact primary categories. */
  primary: string[];
  /** Primary categories never wanted even when a hierarchy node matches. */
  exclude: string[];
  /** Optional case-insensitive name pattern (sub-types the taxonomy cannot express). */
  nameRegex?: string;
}

const AUTO_EXCLUDE = ["car_wash", "auto_detailing", "auto_customization", "car_window_tinting", "towing_service", "vehicle_wrap", "car_stereo_installation", "auto_security", "car_buyer", "automobile_registration_service", "emissions_inspection", "car_inspection", "emergency_roadside_service", "auto_restoration_service", "auto_upholstery", "automotive_consultant", "truck_repair", "aircraft_service", "boat_service"];

/** Overture specs per industry and per sub-type. A sub-type without a spec is name-based only. */
const OVERTURE: Record<string, { all: OvertureSpec; segments: Record<string, OvertureSpec> }> = {
  auto_repair: {
    all: { hierarchy: ["automotive_repair"], primary: ["automotive_service", "auto_body_shop", "auto_glass_service", "windshield_installation_and_repair", "tire_shop", "oil_change_station"], exclude: AUTO_EXCLUDE },
    segments: {
      general_repair: { hierarchy: ["automotive_repair"], primary: ["automotive_service"], exclude: [...AUTO_EXCLUDE, "tire_dealer_and_repair", "transmission_repair"] },
      body_collision: { hierarchy: [], primary: ["auto_body_shop", "auto_glass_service", "windshield_installation_and_repair"], exclude: ["car_window_tinting"] },
      tires: { hierarchy: [], primary: ["tire_shop", "tire_dealer_and_repair", "wheel_and_rim_repair"], exclude: [] },
      transmission: { hierarchy: [], primary: ["transmission_repair"], exclude: [] },
      european_import: { hierarchy: ["automotive_repair"], primary: ["automotive_service"], exclude: AUTO_EXCLUDE, nameRegex: "european|euro\\b|import|bmw|mercedes|audi|volvo|porsche|honda|toyota|subaru|lexus|\\bvw\\b|volkswagen|saab|mini\\b|jaguar|land rover" },
      quick_lube: { hierarchy: [], primary: ["oil_change_station"], exclude: [] },
    },
  },
  home_services: {
    all: { hierarchy: [], primary: ["hvac_service", "plumbing", "electrician", "roofing", "garage_door_service", "pest_control_service", "painting", "home_cleaning", "carpet_cleaning", "handyman", "pool_and_hot_tub_service", "pool_cleaning"], exclude: [] },
    segments: {
      hvac: { hierarchy: [], primary: ["hvac_service"], exclude: [] },
      plumbing: { hierarchy: [], primary: ["plumbing"], exclude: [] },
      electrical: { hierarchy: [], primary: ["electrician"], exclude: [] },
      roofing: { hierarchy: ["ceiling_and_roofing_repair_and_service"], primary: [], exclude: [] },
      garage_doors: { hierarchy: [], primary: ["garage_door_service"], exclude: [] },
      pest_control: { hierarchy: [], primary: ["pest_control_service"], exclude: [] },
      painting: { hierarchy: [], primary: ["painting"], exclude: [] },
      cleaning: { hierarchy: [], primary: ["home_cleaning", "carpet_cleaning"], exclude: [] },
      handyman: { hierarchy: [], primary: ["handyman"], exclude: [] },
      pools: { hierarchy: [], primary: ["pool_and_hot_tub_service", "pool_cleaning"], exclude: [] },
    },
  },
  dental: {
    all: { hierarchy: ["dental_clinic"], primary: [], exclude: ["b2b_dental_lab", "dentistry_school", "dental_supply_store"] },
    segments: {
      general: { hierarchy: [], primary: ["dental_clinic", "general_dentistry", "cosmetic_dentistry", "pediatric_dentistry"], exclude: [] },
      orthodontics: { hierarchy: [], primary: ["orthodontics"], exclude: [] },
    },
  },
  landscaping: {
    all: { hierarchy: ["landscaping"], primary: ["irrigation_service"], exclude: ["nursery_and_gardening_store", "lawn_mower_store", "lawn_mower_repair_service"] },
    segments: {
      landscaping: { hierarchy: [], primary: ["landscaping", "landscape_architect"], exclude: [] },
      lawn_care: { hierarchy: [], primary: ["lawn_service", "gardener"], exclude: [] },
      tree_service: { hierarchy: [], primary: ["tree_service"], exclude: [] },
      irrigation: { hierarchy: [], primary: ["irrigation_service"], exclude: [] },
    },
  },
};

/** Words people type → industry key (suggestions on the form; never an automatic switch). */
export const INDUSTRY_SYNONYMS: Record<string, string[]> = {
  auto_repair: ["auto repair", "car repair", "mechanic", "garage", "body shop", "collision", "tire", "tyre", "transmission", "oil change", "lube", "brake", "muffler", "automotive", "werkstatt", "taller mecanico", "autowerkstatt"],
  home_services: ["hvac", "heating", "cooling", "air conditioning", "plumber", "plumbing", "electrician", "electrical", "roofer", "roofing", "garage door", "pest control", "exterminator", "painter", "cleaning", "maid", "handyman", "pool service", "contractor"],
  dental: ["dentist", "dental", "orthodontist", "braces", "teeth", "zahnarzt", "dentista"],
  landscaping: ["landscaping", "landscaper", "lawn", "lawn care", "mowing", "tree service", "arborist", "irrigation", "sprinkler", "gardener", "garden maintenance"],
};

export function suggestIndustries(text: string): { key: string; label: string; matched: string }[] {
  const q = text.toLowerCase().trim();
  if (q.length < 3) return [];
  const out: { key: string; label: string; matched: string }[] = [];
  for (const [key, words] of Object.entries(INDUSTRY_SYNONYMS)) {
    const hit = words.find((w) => w.includes(q) || q.includes(w));
    if (hit) out.push({ key, label: getPlaybook(key).label, matched: hit });
  }
  return out;
}

export interface ResolvedCategories {
  industry: IndustryPlaybook;
  /** Spec sent to Overture (hierarchy nodes, primaries, exclusions, name pattern). */
  overture: OvertureSpec;
  /** All Overture categories the industry covers (fetched into the local cache so sub-type narrowing is local). */
  overtureAll: OvertureSpec;
  osmSelectors: string[];
  osmNameRegex: string | null;
  /** Sub-types that have no category of their own on Overture (name pattern applies instead). */
  overtureNameOnly: string[];
  /** Free-text category when the industry is generic. */
  custom: string | null;
}

const safeToken = (s: string) => s.toLowerCase().replace(/[^a-z0-9_ ]/g, "").trim().replace(/\s+/g, "_");

/** What to look for on each source, given the operator's choices. */
export function resolveCategories(industryKey: string, segmentKeys: string[] = [], customCategory?: string | null): ResolvedCategories {
  const industry = getPlaybook(industryKey);
  const sel = selectorsFor(industry, segmentKeys);
  const spec = OVERTURE[industry.key];
  const custom = customCategory?.trim() ? safeToken(customCategory) : null;
  if (!spec) {
    // Generic industry: the free-text category is matched against the taxonomy path and the name.
    const token = custom ?? "";
    return {
      industry,
      overture: { hierarchy: token ? [token] : [], primary: [], exclude: [], nameRegex: token ? token.replace(/_/g, " ") : undefined },
      overtureAll: { hierarchy: token ? [token] : [], primary: [], exclude: [] },
      osmSelectors: sel.osmSelectors,
      osmNameRegex: token ? token.replace(/_/g, " ") : null,
      overtureNameOnly: [],
      custom,
    };
  }
  const segs = industry.segments.filter((s) => segmentKeys.includes(s.key));
  let overture: OvertureSpec = spec.all;
  const nameOnly: string[] = [];
  if (segs.length) {
    const parts = segs.map((s) => spec.segments[s.key]).filter((x): x is OvertureSpec => Boolean(x));
    for (const s of segs) if (!spec.segments[s.key]) nameOnly.push(s.label);
    const nameRegexes = parts.map((p) => p.nameRegex).filter((x): x is string => Boolean(x));
    overture = {
      hierarchy: [...new Set(parts.flatMap((p) => p.hierarchy))],
      primary: [...new Set(parts.flatMap((p) => p.primary))],
      // An exclusion only holds when every chosen sub-type excludes it (one sub-type may want what another drops).
      exclude: [...new Set(parts.flatMap((p) => p.exclude))].filter((e) => parts.every((p) => p.exclude.includes(e))),
      nameRegex: nameRegexes.length === parts.length && nameRegexes.length ? nameRegexes.join("|") : undefined,
    };
  }
  return { industry, overture, overtureAll: spec.all, osmSelectors: sel.osmSelectors, osmNameRegex: segs.length ? null : (industry.osmNameRegex ?? null), overtureNameOnly: nameOnly, custom };
}

/** Does an Overture record match the spec? Returns what matched (for provenance) or null. */
export function matchOverture(spec: OvertureSpec, primary: string | null, hierarchy: string[] | null, name: string): string | null {
  if (!primary) return null;
  if (spec.exclude.includes(primary)) return null;
  let by: string | null = null;
  if (spec.primary.includes(primary)) by = `category ${primary}`;
  else {
    const node = spec.hierarchy.find((h) => hierarchy?.includes(h) || primary === h);
    if (node) by = node === primary ? `category ${primary}` : `category ${primary} under ${node}`;
  }
  if (!by) return null;
  if (spec.nameRegex && !new RegExp(spec.nameRegex, "i").test(name)) return null;
  return spec.nameRegex ? `${by} + name` : by;
}

// ------------------------------------------------------------------ OSM selectors
export interface OsmSelector {
  /** Tag conditions in order; `value` exact or `regex` (case-insensitive when `ci`). `present` = key must exist. */
  conds: { key: string; value?: string; regex?: RegExp; present?: boolean }[];
  source: string;
}

/** Parses our Overpass selector syntax: `["shop"="car_repair"]["name"~"body|collision",i]`. */
export function parseOsmSelector(sel: string): OsmSelector {
  const conds: OsmSelector["conds"] = [];
  const re = /\["([^"]+)"(?:(=|~|!~)"([^"]*)"(,i)?)?\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sel))) {
    const [, key, op, val, ci] = m;
    if (!op) conds.push({ key, present: true });
    else if (op === "=") conds.push({ key, value: val });
    else conds.push({ key, regex: new RegExp(op === "!~" ? `^(?!.*(${val}))` : val, ci ? "i" : "") });
  }
  return { conds, source: sel };
}

/** Which selector an OSM tag set matches, or null. */
export function matchOsm(selectors: string[], tags: Record<string, string>, nameRegex?: string | null): string | null {
  for (const s of selectors) {
    const p = parseOsmSelector(s);
    if (p.conds.length && p.conds.every((c) => (c.present ? c.key in tags : c.value != null ? tags[c.key] === c.value : c.regex ? c.regex.test(tags[c.key] ?? "") : false))) return `tags ${p.source}`;
  }
  if (nameRegex && tags.name && new RegExp(nameRegex, "i").test(tags.name) && (tags.shop || tags.craft || tags.office)) return "name pattern";
  return null;
}
