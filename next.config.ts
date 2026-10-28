import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql", "@duckdb/node-api", "@duckdb/node-bindings"],
  // SQL migrations are read from disk at runtime; include them in every serverless function bundle.
  outputFileTracingIncludes: { "/**": ["./drizzle/**"] },
};

export default nextConfig;
