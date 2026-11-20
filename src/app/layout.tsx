import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Inter, Manrope } from "next/font/google";
import { Suspense } from "react";
import { headers } from "next/headers";
import { AppShell } from "@/components/nav";
import { PendingForms } from "@/components/pending-forms";
import { KeepScroll } from "@/components/keep-scroll";
import { getConfig } from "@/lib/config";
import { navStatus } from "@/lib/queries";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getState } from "@/lib/settings";

/** Whether the signed-in account still has its first-run setup ahead of it. */
const onboardingPending = async () => (await getState<string>("onboarding")) === "pending";

/** One typeface for the whole product, served from the app itself (fetched once at build time, never from the visitor's browser). */
const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });
/** The typeface of titles and large figures: rounder and wider than the text face, so a heading reads as one. */
const display = Manrope({ subsets: ["latin", "latin-ext", "cyrillic"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = { title: { default: "Opportunity Radar", template: "%s · Opportunity Radar" }, description: "Find businesses, research them, write to them, and keep track of the conversation" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f5f8" }, { media: "(prefers-color-scheme: dark)", color: "#0f1218" }] };
export const dynamic = "force-dynamic";
/** Research and AI jobs run inside the request lifecycle on serverless hosts. */
export const maxDuration = 300;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cfg = getConfig();
  // The shell must render even when the database cannot be opened; the page itself reports that.
  const user = await currentUser().catch(() => null);
  const h = await headers();
  const path = h.get("x-pathname") ?? "";
  // A page being loaded whole (typed, reloaded, opened from a link elsewhere), as opposed to the app fetching
  // a part of itself while it is open.
  const wholePage = !h.get("rsc") && !h.get("next-router-state-tree");
  // A new account goes through the first-run setup before the app opens: every page leads there until it is finished.
  // Only a page loaded whole is sent there from here. A redirect issued while a page is already being drawn (from
  // this layout for one of the app's own partial fetches, or from the dashboard page) made the browser ask for the
  // setup without end. Signing in sends a new account to the setup itself (src/app/auth-actions.ts).
  const inSetup = path === "/setup";
  if (wholePage && user?.role === "owner" && !inSetup && !path.startsWith("/auth/") && !["/privacy", "/terms", "/acceptable-use"].includes(path) && (await onboardingPending().catch(() => false))) redirect("/setup");
  if (user?.role !== "owner" || inSetup || ["/privacy", "/terms", "/acceptable-use"].includes(path))
    return (
      <html lang="en" className={`${inter.variable} ${display.variable}`}>
        <body>
          <Suspense fallback={null}>
            <PendingForms />
          </Suspense>
          {children}
        </body>
      </html>
    );
  const nav = await navStatus().catch(() => null);
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body>
        {/* Every form: the pressed button shows it is working until the page answers. */}
        <Suspense fallback={null}>
          <PendingForms />
        </Suspense>
        {/* Filtering, searching and saving leave you where you were on the page. */}
        <KeepScroll />
        <AppShell user={{ name: user.name, email: user.email }} counts={nav?.counts} setup={nav?.setup} serverless={cfg.serverless && !cfg.TURSO_DATABASE_URL}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
