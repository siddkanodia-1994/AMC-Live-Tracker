import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for pure logic only (no DB, no network): local dev shares the
// production database, so nothing under test may open a connection.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
