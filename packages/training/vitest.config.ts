import { defineConfig } from "vitest/config";

/**
 * These tests compile candidates for real: each one spawns `node --test` several
 * times over a temporary workspace, so a case is bounded by how fast this machine
 * starts processes rather than by anything in the assertion. Vitest's 5s default
 * is under the 8s a single run is already allowed to take, so the tests failed as
 * timeouts on a loaded machine while the code under test was behaving correctly.
 *
 * The budget is per case and generous on purpose: a compilation test that fails
 * for being slow says nothing about the compiler.
 */
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
