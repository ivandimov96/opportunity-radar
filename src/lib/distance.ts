/**
 * Distances as people of a country say them. Everything is kept in kilometres; only what is shown
 * and typed follows the country: miles where road distances are given in miles, kilometres elsewhere.
 * Pure: safe to import anywhere.
 */
export const KM_PER_MILE = 1.609344;

/** Countries where everyday distances are in miles. */
const MILE_COUNTRIES = new Set(["US", "GB", "LR", "MM"]);
export const usesMiles = (country: string | null | undefined) => MILE_COUNTRIES.has((country ?? "").toUpperCase());

/** "km" or "miles", as shown beside a number. */
export const distanceUnit = (country: string | null | undefined) => (usesMiles(country) ? "miles" : "km");

/** A distance in kilometres as the whole number shown in the country's unit. */
export const kmToShown = (km: number, country: string | null | undefined) => Math.max(1, Math.round(usesMiles(country) ? km / KM_PER_MILE : km));
/** A number typed in the country's unit, as whole kilometres. */
export const shownToKm = (n: number, country: string | null | undefined) => Math.max(1, Math.round(usesMiles(country) ? n * KM_PER_MILE : n));

/** "25 km" or "15 miles" ("1 mile"). */
export function distanceText(km: number, country: string | null | undefined): string {
  const n = kmToShown(km, country);
  return usesMiles(country) ? `${n} ${n === 1 ? "mile" : "miles"}` : `${n} km`;
}

/** The distances offered around a town: round numbers in the country's own unit, each with what it is in kilometres. */
export function distanceChoices(country: string | null | undefined): { km: number; label: string }[] {
  return (usesMiles(country) ? [5, 15, 30, 60] : [10, 25, 50, 100]).map((n) => {
    const km = shownToKm(n, country);
    return { km, label: distanceText(km, country) };
  });
}

/** The offered distance closest to `km` (a distance saved under another unit lands on its neighbour). */
export function nearestChoiceKm(km: number, country: string | null | undefined): number {
  return distanceChoices(country).reduce((best, c) => (Math.abs(c.km - km) < Math.abs(best - km) ? c.km : best), distanceChoices(country)[0].km);
}
