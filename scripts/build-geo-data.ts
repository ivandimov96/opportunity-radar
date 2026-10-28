/**
 * Builds the bundled location reference data from GeoNames exports (CC BY 4.0):
 *   countries.json     [code, name, continent]                      from countryInfo.txt
 *   regions.json       [countryCode, regionCode, name, asciiName]    from admin1CodesASCII.txt
 *   world-places.json  [name, asciiName, country, region, population, lat, lon]
 *                      from cities15000.txt (every place with ≥ 15,000 inhabitants, worldwide;
 *                      US places come from us-places.json, which goes down to 1,000)
 * Usage: pnpm exec tsx scripts/build-geo-data.ts <dir with countryInfo.txt, admin1CodesASCII.txt, cities15000.txt>
 */
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: build-geo-data.ts <geonames dir>");
const out = path.join(process.cwd(), "src", "data");
const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));

const countries = read("countryInfo.txt")
  .map((l) => l.split("\t"))
  .filter((c) => c[0] && c[4])
  .map((c) => [c[0], c[4], c[8]] as [string, string, string])
  .sort((a, b) => a[1].localeCompare(b[1]));
fs.writeFileSync(path.join(out, "countries.json"), JSON.stringify(countries));

const regions = read("admin1CodesASCII.txt")
  .map((l) => l.split("\t"))
  .map((r) => {
    const [cc, code] = r[0].split(".");
    return [cc, code, r[1], r[2]] as [string, string, string, string];
  })
  .sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]));
fs.writeFileSync(path.join(out, "regions.json"), JSON.stringify(regions));

// cities15000 columns: geonameid, name, asciiname, alternatenames, lat, lon, fclass, fcode, country, cc2, admin1, admin2, admin3, admin4, population, ...
const seen = new Set<string>();
const places = read("cities15000.txt")
  .map((l) => l.split("\t"))
  .filter((c) => c[6] === "P" && c[7] !== "PPLX" && c[8] !== "US")
  .map((c) => [c[1], c[2], c[8], c[10], Number(c[14]), Number(Number(c[4]).toFixed(4)), Number(Number(c[5]).toFixed(4))] as [string, string, string, string, number, number, number])
  .filter((p) => {
    const k = `${p[2]}|${p[3]}|${p[0].toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  })
  .sort((a, b) => b[4] - a[4]);
fs.writeFileSync(path.join(out, "world-places.json"), JSON.stringify(places));
console.log(`countries ${countries.length}, regions ${regions.length}, world places ${places.length}`);
