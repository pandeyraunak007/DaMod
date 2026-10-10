import { defineConfig } from "vitest/config";

// Mostly pure-logic unit tests run in the default `node` environment (file
// format, type mapping, DDL export, validation — NFR-9). A few component render
// smoke tests (`*.render.test.tsx`) opt into jsdom per-file via the
// `// @vitest-environment jsdom` pragma, so they can mount a dialog and catch
// render-time regressions (e.g. the Zustand selector infinite loop).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
