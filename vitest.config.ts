import { defineConfig } from "vitest/config";

// Unit tests only for now (file format, type mapping, DDL export, validation
// rules per NFR-9). These are pure-logic modules, so the default node
// environment is enough — no DOM needed.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
