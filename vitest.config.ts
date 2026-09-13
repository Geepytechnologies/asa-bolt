import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["server/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: false,
  },
});
