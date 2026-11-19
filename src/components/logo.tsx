/**
 * The logo of Opportunity Radar, redrawn from the founder's artwork in the
 * colours of the app: the airmail blue of every button as the tile, white for
 * the radar ring, the app's light blue for the inner ring and the sweep, and
 * its amber for the dot the sweep has found. A vector, so it is sharp at any
 * size; the browser tab icon (src/app/icon.svg) is the same drawing.
 */
export function Logo({ size = "w-9 h-9" }: { size?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={`${size} shrink-0`} role="img" aria-label="Opportunity Radar">
      <rect width="100" height="100" rx="22" fill="#1d4fa3" />
      <path d="M50 50L70.75 14.1A41.5 41.5 0 0 1 90.3 40Z" fill="#8db2f5" opacity="0.6" />
      <path d="M68.2 15.8A38.7 38.7 0 1 0 88.6 46.6" fill="none" stroke="#ffffff" strokeWidth="5.5" strokeLinecap="round" />
      <path d="M58.6 28.7A23 23 0 1 0 71.6 57.9" fill="none" stroke="#8db2f5" strokeWidth="4.8" strokeLinecap="round" />
      <circle cx="75.4" cy="35.9" r="5.2" fill="#f5b942" />
      <circle cx="50" cy="50" r="5.4" fill="#ffffff" />
    </svg>
  );
}
