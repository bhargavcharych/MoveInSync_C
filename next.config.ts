import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/moveinsync.duckdb"],
  },
  serverExternalPackages: ["@duckdb/node-api"],
};

export default nextConfig;
