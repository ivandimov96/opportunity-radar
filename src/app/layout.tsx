import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = { title: "Opportunity Radar", description: "Software business opportunity intelligence" };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cfg = getConfig();
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen">
          <Nav aiEnabled={cfg.ai.enabled} />
          <main className="flex-1 min-w-0 px-6 py-5 max-w-[1400px]">{children}</main>
        </div>
      </body>
    </html>
  );
}
