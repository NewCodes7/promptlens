import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The three-line entry point only calls main(); CI's smoke test runs the built file instead.
      exclude: ["src/cli.ts"],
      reporter: ["text-summary", "text"],
      // CI fails if coverage drops below these. Raise them when coverage goes up; don't lower them to pass.
      thresholds: { lines: 95, statements: 93, functions: 94, branches: 82 },
    },
  },
});
