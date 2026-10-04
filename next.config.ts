import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
  // PGlite (base locale) embarque un binaire WebAssembly : ne pas le regrouper.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
