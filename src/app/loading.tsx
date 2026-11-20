/**
 * Shown while the page at "/" loads. The radar is for arriving: a visitor on
 * the front page, and the first page after signing in or up. Someone who is
 * already working sees the outline of the dashboard instead, like on every
 * other workspace page.
 */
import { cookies } from "next/headers";
import { BrandLoader } from "@/components/brand-loader";
import { DashboardSkeleton } from "@/components/page-skeleton";
import { SESSION_COOKIE, WELCOME_COOKIE } from "@/lib/auth/token";

export default async function Loading() {
  const jar = await cookies();
  const arriving = !jar.has(SESSION_COOKIE) || jar.has(WELCOME_COOKIE);
  return arriving ? <BrandLoader /> : <DashboardSkeleton />;
}
