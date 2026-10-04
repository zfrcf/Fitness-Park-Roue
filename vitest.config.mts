import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000, // PGlite démarre lentement quand les fichiers tournent en parallèle
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
