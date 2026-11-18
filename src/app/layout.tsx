import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/nav";
import { getConfig } from "@/lib/config";
import { navStatus } from "@/lib/queries";

export const metadata: Metadata = { title: { default: "Opportunity Radar", template: "%s · Opportunity Radar" }, description: "Find businesses, research them, write to them, and keep track of the conversation" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f5f8" }, { media: "(prefers-color-scheme: dark)", color: "#0f1218" }] };
export const dynamic = "force-dynamic";
/** Research and AI jobs run inside the request lifecycle on serverless hosts. */
export const maxDuration = 300;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cfg = getConfig();
  // The shell must render even when the database cannot be opened; the page itself reports that.
  const nav = await navStatus().catch(() => null);
  return (
    <html lang="en">
      <body>
        <AppShell counts={nav?.counts} setup={nav?.setup} serverless={cfg.serverless && !cfg.TURSO_DATABASE_URL}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
