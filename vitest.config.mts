import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    // Default to node; component tests opt into jsdom via a
    // `// @vitest-environment jsdom` docblock at the top of the file.
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // `vitest --changed` (PR CI, #2386) runs every test when one of these changed.
    // Root-anchored: src/lib/supabase must not match supabase/.
    forceRerunTriggers: [
      "**/package.json",
      "**/{vitest,vite}.config.*",
      `${root}package-lock.json`,
      `${root}tsconfig*.json`,
      `${root}tests/setup.ts`,
      `${root}.github/**`,
      `${root}supabase/**`,
    ],
    // jsdom component tests (render + userEvent) can exceed the 5s default when
    // the machine is under load; a longer ceiling avoids spurious CI failures
    // while still catching genuinely hung tests.
    testTimeout: 15000,
    hookTimeout: 15000,
    // #618: the CI unit shards set FLAKY_REPORT. There a failed test gets one retry; one that passes on it is flaky,
    // recorded for its issue, not a red job. A real failure fails both tries. Other runs (core, local) never retry.
    retry: process.env.FLAKY_REPORT ? 1 : 0,
    reporters: [
      "default",
      ...(process.env.GITHUB_ACTIONS === "true" ? ["github-actions"] : []),
      ...(process.env.FLAKY_REPORT ? ["./scripts/flaky-reporter.mjs"] : []),
    ],
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
        lines: 56,
        functions: 59,
        statements: 56,
        branches: 52,
      },
    },
  },
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: fileURLToPath(new URL("./scripts/server-only-cli-stub.cjs", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
});
