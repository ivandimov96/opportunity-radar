import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import { headers } from "next/headers";
import { AppShell } from "@/components/nav";
import { PendingForms } from "@/components/pending-forms";
import { KeepScroll } from "@/components/keep-scroll";
import { getConfig } from "@/lib/config";
import { navStatus } from "@/lib/queries";
import { currentUser } from "@/lib/auth";

/** One typeface for the whole product, served from the app itself (fetched once at build time, never from the visitor's browser). */
const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = { title: { default: "Opportunity Radar", template: "%s · Opportunity Radar" }, description: "Find businesses, research them, write to them, and keep track of the conversation" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f5f8" }, { media: "(prefers-color-scheme: dark)", color: "#0f1218" }] };
export const dynamic = "force-dynamic";
/** Research and AI jobs run inside the request lifecycle on serverless hosts. */
export const maxDuration = 300;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cfg = getConfig();
  // The shell must render even when the database cannot be opened; the page itself reports that.
  const user = await currentUser().catch(() => null);
  const path = (await headers()).get("x-pathname") ?? "";
  if (user?.role !== "owner" || ["/privacy", "/terms", "/acceptable-use"].includes(path))
    return (
      <html lang="en" className={inter.variable}>
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
    <html lang="en" className={inter.variable}>
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
