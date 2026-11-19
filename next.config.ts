import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The framework's own development badge sits in the bottom left corner, on top of the sidebar's status line.
  devIndicators: false,
  serverExternalPackages: ["@libsql/client", "libsql", "nodemailer", "imapflow", "postal-mime"],
  // SQL migrations are read from disk at runtime; include them in every serverless function bundle.
  // The optional data snapshot (data/snapshot/radar.db) seeds serverless instances that have no hosted database.
  outputFileTracingIncludes: { "/**": ["./drizzle/**", "./data/snapshot/**"] },
};

export default nextConfig;
