/**
 * The loading state of the product: its own radar, small, turning in the
 * middle of the page. It is for arriving: the front page, signing in and up,
 * and the first page after that. Pages of the workspace show their own outline
 * while they load (components/page-skeleton.tsx).
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
