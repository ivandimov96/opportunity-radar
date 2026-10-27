import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/nav";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = { title: { default: "Opportunity Radar", template: "%s · Opportunity Radar" }, description: "Evidence-first software opportunity intelligence" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f5f8" }, { media: "(prefers-color-scheme: dark)", color: "#0f1218" }] };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cfg = getConfig();
  return (
    <html lang="en">
      <body>
        <AppShell aiEnabled={cfg.ai.enabled}>{children}</AppShell>
      </body>
    </html>
  );
}
