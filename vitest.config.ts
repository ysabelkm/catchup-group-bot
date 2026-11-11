import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // Several files share one local Postgres; run them one at a time so they can't interfere.
    fileParallelism: false,
  },
});
