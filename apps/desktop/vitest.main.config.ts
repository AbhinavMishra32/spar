import { defineConfig } from "vitest/config";

/**
 * The C++ build tests invoke a real `clang++`, which on a developer machine is
 * seconds per translation unit — well past Vitest's 5s default, and past it by
 * more when the rest of the suite is running beside them. A build test that fails
 * for being slower than the test runner's patience says nothing about the build,
 * so the budget is sized on the toolchain.
 */
export default defineConfig({
  test: {
    include: ["src/main/**/*.test.ts", "src/workers/**/*.test.ts", "src/shared/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
