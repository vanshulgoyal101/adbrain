import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // Default to node; component tests opt into jsdom via a
    // `// @vitest-environment jsdom` docblock at the top of the file.
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // jsdom component tests (render + userEvent) can exceed the 5s default when
    // the machine is under load; a longer ceiling avoids spurious CI failures
    // while still catching genuinely hung tests.
    testTimeout: 15000,
    hookTimeout: 15000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      // Measure the logic we own. Pages/layouts are thin composition over the
      // libraries below and are covered by the build + route-guard tests.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/lib/types.ts",
        "src/app/**/{page,layout,loading,error,not-found}.tsx",
        "src/app/{manifest,sitemap,robots,opengraph-image}.{ts,tsx}",
      ],
      thresholds: {
        // A ratchet, not a target: set just under the current numbers so coverage
        // can only go up. Raise these as suites land.
        lines: 48,
        functions: 48,
        statements: 48,
        branches: 43,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
