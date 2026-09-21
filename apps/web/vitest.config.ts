import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    // Unit + integration tests run against a real SQLite file DB, so each
    // suite exercises actual Prisma queries rather than a mocked client.
    setupFiles: ["tests/setup.ts"],
    testTimeout: 30000,
    coverage: {
      reporter: ["text", "json-summary"],
      include: ["src/lib/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
