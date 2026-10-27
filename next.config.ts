import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // SQL migrations are read from disk at runtime; include them in every serverless function bundle.
  outputFileTracingIncludes: { "/**": ["./drizzle/**"] },
};

export default nextConfig;
