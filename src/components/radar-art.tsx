/**
 * The radar, as moving artwork: range rings, a sweep that turns, and dots that
 * light up as the sweep passes them. Pure CSS; it stands still for people who
 * ask for less motion. Used on the front page and beside the sign-in form.
 */
const DOTS = [
  { top: "24%", left: "62%", delay: "0.5s" },
  { top: "40%", left: "24%", delay: "1.9s" },
  { top: "66%", left: "70%", delay: "1.1s" },
  { top: "74%", left: "38%", delay: "2.6s" },
  { top: "30%", left: "80%", delay: "0.2s" },
];

export function RadarArt({ className = "" }: { className?: string }) {
  return (
    <div className={`radar-art ${className}`} aria-hidden>
      <span className="radar-ring" style={{ inset: "0" }} />
      <span className="radar-ring" style={{ inset: "17%" }} />
      <span className="radar-ring" style={{ inset: "34%" }} />
      <span className="radar-sweep" />
      <span className="radar-core" />
      {DOTS.map((d) => (
        <span key={d.delay} className="radar-blip" style={{ top: d.top, left: d.left, animationDelay: d.delay }} />
      ))}
    </div>
  );
}
