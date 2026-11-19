/**
 * Shown while the page at "/" loads: the front page for a visitor, the
 * dashboard for the owner. The radar suits both. The workspace sections show
 * the outline of a page instead (components/page-skeleton.tsx).
 */
import { BrandLoader } from "@/components/brand-loader";

export default function Loading() {
  return <BrandLoader />;
}
