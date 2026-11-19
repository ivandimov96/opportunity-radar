/**
 * The loading state of the product: its own radar, small, turning in the
 * middle of the page. Used wherever a whole page is on its way (the front
 * page, the dashboard, signing in and up), so waiting looks the same and looks
 * like this product everywhere.
 */
import { RadarArt } from "./radar-art";

export function BrandLoader({ full = false }: { full?: boolean }) {
  return (
    <div role="status" aria-label="Loading" className={`${full ? "min-h-screen" : "min-h-[62vh]"} grid place-items-center`}>
      <div className="flex flex-col items-center gap-4 loader-in">
        <RadarArt className="w-24" />
        <span className="text-sm font-semibold text-ink-muted">Loading</span>
      </div>
    </div>
  );
}
