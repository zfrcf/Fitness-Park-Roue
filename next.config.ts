import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
  // PGlite (base locale) embarque un binaire WebAssembly : ne pas le regrouper.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Atelier local (« atelier ui ») : serveur autonome, lancé avec Node seul, sans node_modules complet.
  // Sans effet sur Vercel.
  ...(process.env.NEXT_PUBLIC_ATELIER_LOCAL === "1" ? { output: "standalone" as const, images: { unoptimized: true } } : {}),
};

export default nextConfig;
