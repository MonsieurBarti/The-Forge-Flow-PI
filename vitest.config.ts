import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@kernel": resolve(import.meta.dirname, "src/kernel"),
      "@hexagons": resolve(import.meta.dirname, "src/hexagons"),
      "@infrastructure": resolve(import.meta.dirname, "src/infrastructure"),
    },
  },
  test: {
    include: ["src/**/*.spec.ts"],
    globals: false,
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/**/*.builder.ts"],
    },
  },
});
